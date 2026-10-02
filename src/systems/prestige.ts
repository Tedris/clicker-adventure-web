// src/systems/prestige.ts
// Prestige/rebirth system. Pure logic: rebirth points are earned
// sub-linearly from gold accumulated since the last rebirth (sqrt shape —
// 1 point at base, 2 at 4x base, 10 at 100x base; anti-hoarding) and drive
// a persistent GOLD-ONLY multiplier derived from the point total at each
// gain site, never stored as its own state field.

import Config from "../config";
import type { GameState } from "../state";
import Stats from "./stats";

// The live Upgrades instance shape rebirth re-aliases through.
export interface LiveUpgrades {
  upgrades: Record<string, number>;
  set_state(next: Record<string, number>): void;
}

export class Prestige {
  // The declarative keep/reset boundary of a rebirth. Every persisted key
  // appears in exactly one of these two lists (machine-checked by the
  // coverage test). KEEP survives; RESET returns to fresh-start defaults.
  // last_save_time is a wall-clock reference — resetting it would make the
  // next boot read as "first launch". prestige_gold_since_rebirth is the
  // progress counter a fresh rebirth explicitly zeroes.
  static readonly KEEP_SET: string[] = [
    "waifus",
    "equipped",
    "tokens",
    "last_login_day",
    "login_streak",
    "prestige_points",
    "prestige_rebirths",
    "last_save_time",
    "total_gold_earned",
    "total_exp_earned",
    "total_tokens_earned",
    // Lifetime counters and the unlocked-achievement set are LIFETIME by
    // definition — a rebirth restarts progression, not the record of
    // everything ever done. The areas ladder is lifetime for the same reason:
    // the area multiplier is the long-term backbone a rebirth builds on.
    "stats",
    "achievements",
    "area_index",
    "area_kills",
    "highest_area",
  ];

  static readonly RESET_SET: string[] = [
    "gold",
    "exp",
    "pity_counter",
    "passive_unlocked",
    "upgrades",
    "exp_thresholds_unlocked",
    "prestige_gold_since_rebirth",
  ];

  // Points earnable from gold accumulated since the last rebirth. Sub-linear
  // (exponent < 1). floor() clamps negative/dirty counters to 0.
  static earnable_points(
    state: Partial<Pick<GameState, "prestige_gold_since_rebirth">>,
  ): number {
    const since = state.prestige_gold_since_rebirth ?? 0;
    if (since <= 0) return 0;
    return Math.floor(
      Math.pow(since / Config.PRESTIGE_GOLD_BASE, Config.PRESTIGE_EXPONENT),
    );
  }

  // Persistent gold-only multiplier, DERIVED from the current point total at
  // each gain site (never stored on state). 0 points -> exactly 1.0.
  static gold_multiplier(
    state: Partial<Pick<GameState, "prestige_points">>,
  ): number {
    return 1 + Config.PRESTIGE_MULTIPLIER_PER_POINT * (state.prestige_points ?? 0);
  }

  // Perform the rebirth. Mutates the SAME state table in place so systems
  // holding a live reference keep their handle. No-op returning [false, 0]
  // when fewer than 1 point is earnable. Upgrade levels reset through the
  // live Upgrades instance's set_state({}) + re-alias so the UI never reads
  // a stale level copy.
  static rebirth(
    state: GameState,
    upgrades?: LiveUpgrades | null,
  ): [boolean, number] {
    const gain = Prestige.earnable_points(state);
    if (gain < 1) {
      return [false, 0];
    }

    // Keep block: prestige currency accumulates; roster, tokens, streaks,
    // and lifetime totals survive untouched.
    state.prestige_points = (state.prestige_points ?? 0) + gain;
    state.prestige_rebirths = (state.prestige_rebirths ?? 0) + 1;

    // Reset block: progression returns to fresh-start values.
    state.gold = 0;
    state.exp = 0;
    state.pity_counter = 0;
    state.passive_unlocked = false;
    state.exp_thresholds_unlocked = {};
    state.prestige_gold_since_rebirth = 0;
    // The badge-award sub-keys are "since-rebirth" counters even though
    // they live in the KEEP_SET `stats` table — the table itself survives,
    // so they are zeroed here, not by the top-level RESET_SET wipe.
    if (state.stats) {
      state.stats.badge_reward_gold = 0;
      state.stats.badge_reward_tokens = 0;
    }

    // Upgrades: zero every track through the live instance, then re-alias
    // so state.upgrades, the instance table, and the UI all see one zeroed
    // table.
    if (upgrades && typeof upgrades.set_state === "function") {
      upgrades.set_state({});
      state.upgrades = upgrades.upgrades;
    } else {
      state.upgrades = {};
    }

    // Only the success branch records the lifetime rebirth — the gain < 1
    // no-op returned before ever reaching this point.
    Stats.record_rebirth(state);

    return [true, gain];
  }
}

export default Prestige;
