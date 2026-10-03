// src/systems/gacha.ts
// Summon system with PS99-style guaranteed hatches: every paid pull yields a
// waifu; rarity is a weighted roll that luck buffs tilt toward the top.
// Common/rare hires come from the CURRENT area's pool (area flavor); epic
// and legendary hires come from the shared cross-area pool.

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

export class Gacha {
  private random: RandomFn;

  constructor(random: RandomFn = defaultRandom) {
    this.random = random;
    console.log(
      `[INFO] [GACHA] Module loaded (guaranteed hatch, batch=${Config.BATCH_PULL_COUNT})`,
    );
  }

  // Guaranteed hatch (PS99): paying always yields a waifu. The rarity walk
  // decides HOW good; luck buffs tilt the walk toward the top tiers instead
  // of gating the drop itself. A null return now only means "cannot pay".
  pull(state: GameState): PullResult | null {
    if (!state) throw new Error("Gacha:pull requires state table");
    if (typeof state.tokens !== "number" || state.tokens < Config.PULL_COST) {
      return null;
    }
    state.tokens = state.tokens - Config.PULL_COST;
    const luck = Mastery.luck_multiplier(state);
    const rarity = this.roll_rarity(luck);
    const def = this.pick_hire(state.area_index ?? 0, rarity);
    if (!def) {
      if (Config.DEBUG_MODE) {
        console.log("[WARN] [GACHA] Pull found no hire in the pools");
      }
      return { success: false, waifu: null };
    }
    if (!state.waifus) state.waifus = [];
    // The pool entry is a shared config def; the roster must own its copy
    // with the rolled rarity baked into bonus_value (per-pull rarity tiers).
    const instance = this.make_instance(def, rarity);
    const first_time = !state.waifus.some((w) => w.name === instance.name);
    state.waifus.push(instance);
    if (Config.DEBUG_MODE) {
      console.log(
        `[DEBUG] [GACHA] Summon! Got: ${instance.name} [${instance.rarity}] (luck: ${luck.toFixed(2)})`,
      );
    }
    // Record keyed off the rolled rarity; every hatch feeds the mastery
    // counters, which is what makes batch summoning a progression loop.
    this.record_pull(state, instance.rarity, first_time);
    return { success: true, waifu: instance };
  }

  // Name source per tier: commons/rares come from the CURRENT area's own
  // hires so each area reads as its own hiring town; epics/legendaries come
  // from the small shared pool that shows up everywhere.
  pick_hire(area_index: number, rarity: Rarity): WaifuDef | null {
    if (rarity.key === "epic" || rarity.key === "legendary") {
      const shared = Config.WAIFU_POOL as WaifuDef[] | null;
      if (!shared || shared.length === 0) return null;
      return shared[this.random(shared.length) - 1] ?? null;
    }
    const idx = Math.max(0, Math.min(area_index, Config.AREAS.length - 1));
    const names = Config.AREAS[idx].pool;
    if (!names || names.length === 0) return null;
    const name = names[this.random(names.length) - 1];
    const bonus = Config.WAIFU_BONUS_BY_NAME[name];
    if (!bonus) return null;
    return { name, bonus_type: bonus.bonus_type, bonus_value: bonus.bonus_value };
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

  // Cumulative-weight walk over Config.WAIFU_RARITIES. Luck squeezes the
  // COMMON band (the freed share is re-split across the ladder), so the same
  // roll lands higher with buffs on — luck tilts quality, not the drop.
  // Two random() calls per summon in a fixed order: rarity walk, hire pick.
  roll_rarity(luck = 1): Rarity {
    const rarities = Config.WAIFU_RARITIES;
    const weights = rarities.map((r, i) =>
      i === 0 ? Math.max(1, r.weight / Math.max(1, luck)) : r.weight,
    );
    let total = 0;
    for (const w of weights) total += w;
    let roll = this.random() * total;
    for (let i = 0; i < rarities.length; i++) {
      if (roll < weights[i]) return rarities[i];
      roll -= weights[i];
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

}

export default Gacha;

