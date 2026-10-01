// src/systems/upgrades.ts
// Upgrade system: purchase upgrades, calculate costs, apply multipliers.
// Ported from src/systems/upgrades.lua (Phase B game-feel pass included:
// linear rails cap at 100, exponential lines at 50, crit saturates at 100%).

import Config from "../config";
import type { GameState } from "../state";
import Stats from "./stats";

export interface UpgradeDefinition {
  name: string;
  icon: string;
  color: number[];
  base_cost: number;
  cost_scaling: "linear" | "exponential" | "fixed";
  linear_step: number;
  exponential_base: number;
  max_level: number;
  effect_per_level: (level: number) => number;
  description: (level: number) => string;
}

// Upgrade definitions: id -> config
export const Definitions: Record<string, UpgradeDefinition> = {
  click_multiplier: {
    name: "Click Multiplier",
    icon: "C",
    color: [240, 200, 80, 255],
    base_cost: 10,
    cost_scaling: "linear",
    linear_step: 15,
    exponential_base: 1.5,
    max_level: 100,
    effect_per_level: (level) => 1 + level,
    description: (level) => `+${1 + level} per click`,
  },
  idle_rate: {
    name: "Idle Rate",
    icon: "I",
    color: [155, 89, 182, 255],
    base_cost: 20,
    cost_scaling: "linear",
    linear_step: 25,
    exponential_base: 1.5,
    max_level: 100,
    effect_per_level: (level) => 1 + level * 0.5,
    description: (level) => `${(1 + level * 0.5).toFixed(1)}x idle rate`,
  },
  gold_multiplier: {
    name: "Gold Multiplier",
    icon: "G",
    color: [240, 200, 80, 255],
    base_cost: 50,
    cost_scaling: "exponential",
    linear_step: 15,
    exponential_base: 1.5,
    max_level: 50,
    effect_per_level: (level) => 1 + level * 0.1,
    description: (level) => `+${level * 10}% gold`,
  },
  exp_multiplier: {
    name: "EXP Multiplier",
    icon: "E",
    color: [155, 89, 182, 255],
    base_cost: 50,
    cost_scaling: "exponential",
    linear_step: 15,
    exponential_base: 1.5,
    max_level: 50,
    effect_per_level: (level) => 1 + level * 0.1,
    description: (level) => `+${level * 10}% exp`,
  },
  crit_chance: {
    name: "Crit Chance",
    icon: "X",
    color: [255, 215, 0, 255],
    base_cost: 100,
    cost_scaling: "exponential",
    linear_step: 15,
    exponential_base: 1.5,
    max_level: 50,
    // Effect is capped at 100% so a maxed line is a legible "always crit".
    effect_per_level: (level) => Math.min(100, 5 + level * 2),
    description: (level) => `${Math.min(100, 5 + level * 2)}% crit chance`,
  },
  unlock_passive: {
    name: "Idle Generation",
    icon: "P",
    color: [155, 89, 182, 255],
    base_cost: Config.PASSIVE_UNLOCK_COST,
    cost_scaling: "fixed",
    linear_step: 0,
    exponential_base: 1.0,
    max_level: 1,
    effect_per_level: (level) => (level > 0 ? 1 : 0),
    description: (level) =>
      level > 0 ? "Passive gen active" : "Unlock idle generation",
  },
};

// D-09 pacing order, mirrored from the loop sim PRIORITY. The UI consumes
// the results and never materializes a second copy.
export const PRIORITY: string[] = [
  "click_multiplier",
  "unlock_passive",
  "idle_rate",
  "gold_multiplier",
  "exp_multiplier",
  "crit_chance",
];

function log(...args: unknown[]): void {
  if (Config.DEBUG_MODE) console.log(...args);
}

export class Upgrades {
  Definitions: Record<string, UpgradeDefinition> = Definitions;
  upgrades: Record<string, number> = {};

  constructor() {
    for (const key of Object.keys(this.Definitions)) {
      this.upgrades[key] = 0;
    }
    log(
      `[INFO] [UPGRADES] Module loaded with ${Object.keys(this.Definitions).length} upgrades`,
    );
  }

  get_cost(upgrade_key: string, current_level: number): number {
    const def = this.Definitions[upgrade_key];
    if (!def) throw new Error(`Unknown upgrade key: ${upgrade_key}`);
    if (def.cost_scaling === "fixed") {
      return def.base_cost;
    } else if (def.cost_scaling === "linear") {
      return def.base_cost + current_level * def.linear_step;
    } else {
      return Math.floor(
        def.base_cost * Math.pow(def.exponential_base, current_level),
      );
    }
  }

  can_afford(upgrade_key: string, state: GameState): boolean {
    const cost = this.get_cost(upgrade_key, this.upgrades[upgrade_key] || 0);
    return state.gold >= cost;
  }

  purchase(upgrade_key: string, state: GameState): number {
    const level = this.upgrades[upgrade_key] || 0;
    const def = this.Definitions[upgrade_key];
    if (!def) throw new Error(`Unknown upgrade key: ${upgrade_key}`);
    if (!(level < def.max_level)) {
      throw new Error(`Upgrade at max level: ${upgrade_key}`);
    }
    const cost = this.get_cost(upgrade_key, level);
    if (!(state.gold >= cost)) {
      throw new Error(`Insufficient gold: need ${cost} have ${state.gold}`);
    }
    state.gold = state.gold - cost;
    this.upgrades[upgrade_key] = level + 1;
    // STATS-02: the level actually landed — record after the increment,
    // behind both guards, so a refused purchase can never reach this line.
    Stats.record_upgrade(state);
    if (upgrade_key === "unlock_passive") {
      state.passive_unlocked = true;
    }
    log(
      `[INFO] [UPGRADES] Purchased ${def.name} level ${level + 1} for ${cost} gold`,
    );
    return level + 1;
  }

  is_maxed(upgrade_key: string): boolean {
    const level = this.upgrades[upgrade_key] || 0;
    return level >= this.Definitions[upgrade_key].max_level;
  }

  // FEEL-02: the next upgrade the player can actually buy. Walks PRIORITY so
  // exact-cost ties resolve to the pacing model's preferred track; returns
  // [key, cost], or [null, null] when nothing is affordable. Pure.
  next_affordable(state: GameState): [string | null, number | null] {
    let best_key: string | null = null;
    let best_cost: number | null = null;
    for (const key of PRIORITY) {
      if (!this.is_maxed(key) && this.can_afford(key, state)) {
        const cost = this.get_cost(key, this.upgrades[key] || 0);
        if (best_cost === null || cost < best_cost) {
          best_cost = cost;
          best_key = key;
        }
      }
    }
    return [best_key, best_cost];
  }

  // FEEL-02 fallback: cheapest not-yet-maxed track to bank gold toward.
  // Null when every track is maxed — the all-maxed no-cue contract.
  save_toward(
    state: GameState,
  ): { key: string; cost: number; deficit: number } | null {
    let best_key: string | null = null;
    let best_cost: number | null = null;
    for (const key of PRIORITY) {
      if (!this.is_maxed(key)) {
        const cost = this.get_cost(key, this.upgrades[key] || 0);
        if (best_cost === null || cost < best_cost) {
          best_cost = cost;
          best_key = key;
        }
      }
    }
    if (!best_key || best_cost === null) return null;
    return {
      key: best_key,
      cost: best_cost,
      deficit: Math.max(0, best_cost - (state.gold || 0)),
    };
  }

  get_click_multiplier(): number {
    let mult = 1;
    const level = this.upgrades.click_multiplier || 0;
    mult = mult * this.Definitions.click_multiplier.effect_per_level(level);
    const gold_mult = this.upgrades.gold_multiplier || 0;
    mult = mult * this.Definitions.gold_multiplier.effect_per_level(gold_mult);
    return mult;
  }

  get_passive_multiplier(): number {
    const level = this.upgrades.idle_rate || 0;
    return this.Definitions.idle_rate.effect_per_level(level);
  }

  get_crit_chance(): number {
    const level = this.upgrades.crit_chance || 0;
    return this.Definitions.crit_chance.effect_per_level(level);
  }

  get_state(): Record<string, number> {
    return { ...this.upgrades };
  }

  set_state(upgrades_table?: Record<string, number>): void {
    this.upgrades = upgrades_table || {};
    for (const key of Object.keys(this.Definitions)) {
      if (this.upgrades[key] == null) {
        this.upgrades[key] = 0;
      }
    }
  }
}

export default Upgrades;


