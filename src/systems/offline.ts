// src/systems/offline.ts
// Offline progress system: awards capped resources for time away (Story 3.4).
// Pure, testable, and the single offline code path.

import Config from "../config";
import Prestige from "./prestige";
import type { GameState } from "../state";
import type { UpgradesLike } from "./passive";

export interface OfflineReport {
  seconds: number;
  tokens: number;
  gold: number;
  exp: number;
}

export class Offline {
  // Computes and applies offline gains to state, returning a report
  // { seconds, tokens, gold, exp } or null when:
  //   - last_save_time is null/0 (first launch), or
  //   - passive_unlocked is false, or
  //   - elapsed time is below OFFLINE_SKIP_SECONDS. A future-dated
  //     last_save_time yields negative elapsed, which fails the same check:
  //     the clock-manipulation defense from project-context.
  // `now` is injected by the caller so tests stay deterministic.
  // Waifu bonus sums are inline on purpose: this runs during boot before
  // the waifu system instance exists (Story 3.2 review decision).
  static apply(
    state: GameState,
    now: number,
    upgrades?: UpgradesLike | null
  ): OfflineReport | null {
    if (!(state.last_save_time && state.last_save_time > 0 && state.passive_unlocked)) {
      return null;
    }

    const offline_seconds = now - state.last_save_time;
    if (offline_seconds < Config.OFFLINE_SKIP_SECONDS) {
      return null;
    }

    let idle_mult = 1;
    if (upgrades && typeof upgrades.get_passive_multiplier === "function") {
      try {
        const mult = upgrades.get_passive_multiplier();
        if (typeof mult === "number") {
          idle_mult = mult;
        }
      } catch {
        // fall back to idle_mult = 1
      }
    }

    let token_mult = 0;
    let gold_mult = 0;
    let exp_mult = 0;
    for (const w of state.waifus ?? []) {
      if (w.bonus_type === "tokens") {
        token_mult = token_mult + (w.bonus_value ?? 0);
      } else if (w.bonus_type === "gold") {
        gold_mult = gold_mult + (w.bonus_value ?? 0);
      } else if (w.bonus_type === "exp") {
        exp_mult = exp_mult + (w.bonus_value ?? 0);
      }
    }

    const capped = Math.min(offline_seconds, Config.OFFLINE_TOKEN_CAP_SECONDS);
    // Parity with passive.ts per-tick formulas: idle_mult applies to gold/exp
    // but NOT tokens (Story 3.2 verified; do not "unify").
    const offline_tokens = capped * Config.PASSIVE_TOKEN_RATE * (1 + token_mult);
    // D-02 (PREST-01): prestige multiplier amplifies gold ONLY.
    const offline_gold =
      capped * Config.PASSIVE_GOLD_RATE * idle_mult * (1 + gold_mult) *
      Prestige.gold_multiplier(state);
    const offline_exp = capped * Config.PASSIVE_EXP_RATE * idle_mult * (1 + exp_mult);

    state.tokens = (state.tokens ?? 0) + offline_tokens;
    state.gold = (state.gold ?? 0) + offline_gold;
    state.exp = (state.exp ?? 0) + offline_exp;
    state.total_tokens_earned = (state.total_tokens_earned ?? 0) + offline_tokens;
    state.total_gold_earned = (state.total_gold_earned ?? 0) + offline_gold;
    state.prestige_gold_since_rebirth =
      (state.prestige_gold_since_rebirth ?? 0) + offline_gold;
    state.total_exp_earned = (state.total_exp_earned ?? 0) + offline_exp;

    if (Config.DEBUG_MODE) {
      console.log(
        `[DEBUG] [OFFLINE] Offline generation: ${offline_tokens} tokens, ${offline_gold} gold, ${offline_exp} exp over ${capped}s (idle_mult=${idle_mult}, token_mult=${token_mult}, gold_mult=${gold_mult}, exp_mult=${exp_mult})`
      );
    }

    return { seconds: capped, tokens: offline_tokens, gold: offline_gold, exp: offline_exp };
  }
}

export default Offline;
