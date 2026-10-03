// src/systems/gacha.ts
// Gacha/pull system with pity logic for waifu summoning.

import Config, { type Rarity } from "../config";
import type { GameState, WaifuInstance } from "../state";
import Mastery from "./mastery";

// RNG seam mirroring Lua's math.random: no-arg call -> float in [0,1);
// call with max -> integer in 1..max. Tests inject positional stubs so a
// success-path pull consumes the RNG in a fixed order: drop roll, pool
// index, rarity roll.
export type RandomFn = (max?: number) => number;

function defaultRandom(max?: number): number {
  if (max === undefined) return Math.random();
  return Math.floor(Math.random() * max) + 1;
}

export interface WaifuDef {
  name: string;
  bonus_type: string;
  bonus_value: number;
}

export interface PullResult {
  success: boolean;
  waifu: WaifuInstance | null;
}

export interface DisplayInfo {
  counter: number;
  max: number;
  threshold: "soft" | "hard" | null;
  warning: boolean;
}

export class Gacha {
  private random: RandomFn;

  constructor(random: RandomFn = defaultRandom) {
    this.random = random;
    console.log(
      `[INFO] [GACHA] Module loaded (soft pity=${Config.PITY_SOFT}, hard pity=${Config.PITY_HARD}, base rate=${Config.BASE_DROP_RATE})`,
    );
  }

  pull(state: GameState): PullResult | null {
    if (!state) throw new Error("Gacha:pull requires state table");
    if (typeof state.tokens !== "number" || state.tokens < Config.PULL_COST) {
      return null;
    }
    state.tokens = state.tokens - Config.PULL_COST;
    // PS99 luck stack: earn-only buffs (rebirth tiers + mastery levels) bump
    // the drop probability before the pity ladder. Rolls stay independent —
    // luck raises the odds, it never makes a roll "due".
    const probability = Math.min(
      1,
      this.get_probability(state.pity_counter ?? 0) * Mastery.luck_multiplier(state),
    );
    if (this.random() < probability) {
      state.pity_counter = 0;
      const def = this.get_random_waifu(state.area_index ?? 0);
      if (!def) {
        if (Config.DEBUG_MODE) {
          console.log("[WARN] [GACHA] Pull succeeded but waifu pool returned nil");
        }
        return { success: false, waifu: null };
      }
      if (!state.waifus) state.waifus = [];
      // The pool entry is a shared config def; the roster must own its copy
      // with the rolled rarity baked into bonus_value (per-pull rarity tiers).
      const instance = this.make_instance(def);
      const first_time = !state.waifus.some((w) => w.name === instance.name);
      state.waifus.push(instance);
      if (Config.DEBUG_MODE) {
        console.log(
          `[DEBUG] [GACHA] Pull success! Got: ${instance.name} [${instance.rarity}] (pity: ${state.pity_counter ?? 0}/100)`,
        );
      }
      // Record on the success path only, keyed off the rolled rarity; the
      // miss branch and the empty-pool bail above never reach this line.
      this.record_pull(state, instance.rarity, first_time);
      return { success: true, waifu: instance };
    }
    state.pity_counter = Math.min((state.pity_counter ?? 0) + 1, Config.PITY_HARD);
    if (Config.DEBUG_MODE) {
      console.log(
        `[DEBUG] [GACHA] Pull failed (pity: ${state.pity_counter}/100, rate: ${probability})`,
      );
    }
    return { success: false, waifu: null };
  }

  // Batch summons (PS99 hatch rhythm): run `count` sequential pulls in one
  // tap. Every pull pays PULL_COST, rides the shared pity counter, and lands
  // in the mastery counters through pull() itself. Stops early when tokens
  // run out; returns the successful instances.
  pull_many(state: GameState, count?: number): WaifuInstance[] {
    if (!state) throw new Error("Gacha:pull_many requires state table");
    const n = Math.max(1, count ?? Config.BATCH_PULL_COUNT);
    const found: WaifuInstance[] = [];
    for (let i = 0; i < n; i++) {
      const result = this.pull(state);
      if (!result) break;
      if (result.success && result.waifu) found.push(result.waifu);
    }
    return found;
  }

  get_probability(pity_counter?: number): number {
    const counter = pity_counter ?? 0;
    if (counter >= Config.PITY_HARD) return 1.0;
    if (counter >= Config.PITY_SOFT) return Config.SOFT_PITY_RATE;
    return Config.BASE_DROP_RATE;
  }

  // Cumulative-weight walk over Config.WAIFU_RARITIES (weights sum to 100).
  // One random() call per roll so pull success consumes drop/pool/rarity
  // in a fixed order (tests stub them positionally).
  roll_rarity(): Rarity {
    const rarities = Config.WAIFU_RARITIES;
    let total = 0;
    for (const r of rarities) total += r.weight;
    let roll = this.random() * total;
    for (const r of rarities) {
      if (roll < r.weight) return r;
      roll -= r.weight;
    }
    return rarities[rarities.length - 1];
  }

  // A pulled waifu is an INSTANCE: its own object, own rarity, bonus already
  // scaled by the rarity multiplier (rounded to 3 decimals for clean saves).
  make_instance(def: WaifuDef, rarity?: Rarity): WaifuInstance {
    const r = rarity ?? this.roll_rarity();
    return {
      name: def.name,
      bonus_type: def.bonus_type,
      bonus_value: Math.floor(def.bonus_value * r.bonus_mult * 1000 + 0.5) / 1000,
      rarity: r.key,
    };
  }

  // Returns the shared Config.WAIFU_POOL definition (+ hires from every area
  // unlocked so far), NOT an instance: do not mutate it and do not store it in
  // state (pull() copies via make_instance). Current-area hires are listed
  // twice so the newest area reads as the active hiring pool.
  get_random_waifu(area_index?: number): WaifuDef | null {
    const base = Config.WAIFU_POOL as WaifuDef[] | null;
    if (!base || base.length === 0) {
      console.log("[ERROR] [GACHA] Waifu pool is empty!");
      return null;
    }
    const pool: WaifuDef[] = base.slice();
    const idx = Math.max(0, Math.min(area_index ?? 0, Config.AREAS.length - 1));
    for (let a = 1; a <= idx; a++) {
      for (const name of Config.AREAS[a].pool) {
        const def = Config.WAIFU_BONUS_BY_NAME[name];
        if (!def) continue;
        pool.push({ name, bonus_type: def.bonus_type, bonus_value: def.bonus_value });
      }
      if (a === idx) {
        for (const name of Config.AREAS[a].pool) {
          const def = Config.WAIFU_BONUS_BY_NAME[name];
          if (!def) continue;
          pool.push({ name, bonus_type: def.bonus_type, bonus_value: def.bonus_value });
        }
      }
    }
    return pool[this.random(pool.length) - 1];
  }

  // Inlined Stats:record_pull (the LÖVE project keeps it in stats.lua; the
  // web port folds the pull counters here). Ladder membership is checked via
  // Config.WAIFU_RARITY_BY_KEY so a typo'd rarity never mints a bogus key in
  // the flat string->number stats map the save validator expects.
  record_pull(state: GameState, rarity: string, first_time = false): void {
    const s = state.stats;
    if (!s) return;
    s.pulls_total = (s.pulls_total ?? 0) + 1;
    if (first_time) {
      s.unique_hires = (s.unique_hires ?? 0) + 1;
    }
    if (typeof rarity === "string" && Config.WAIFU_RARITY_BY_KEY[rarity]) {
      const key = `pulls_${rarity}`;
      s[key] = (s[key] ?? 0) + 1;
    }
  }

  get_next_threshold(pity_counter?: number): "soft" | "hard" | null {
    const counter = pity_counter ?? 0;
    if (counter >= Config.PITY_HARD) return "hard";
    if (counter >= Config.PITY_SOFT) return "soft";
    return null;
  }

  get_display_info(pity_counter?: number): DisplayInfo {
    const counter = pity_counter ?? 0;
    return {
      counter,
      max: Config.PITY_HARD,
      threshold: this.get_next_threshold(counter),
      warning: counter >= 80,
    };
  }
}

export default Gacha;

