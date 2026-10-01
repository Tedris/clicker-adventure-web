// src/systems/achievements.ts
// Pure achievement evaluator. Contract:
//   * evaluate(state) is side-effect-free: it reports the IDs whose stat has
//     reached the curated Config.ACHIEVEMENTS goal AND that are absent from
//     the persisted state.achievements set. It never writes to state.
//   * mark_unlocked(state, ids) is the SOLE write path — the caller consumes
//     evaluate's output first.
//   * Dedup rides the persisted set alone: no cache fields exist on this
//     module; idempotence is keyed by stable IDs.
//   * Purity: no engine calls, no clock, no RNG. Progress rows expose the
//     raw numeric counter — float play_time included, uncapped, unrounded.

import Config from "../config";
import type { GameState } from "../state";
import Prestige from "./prestige";

export interface AchievementProgress {
  id: string;
  label: string;
  metric: string;
  current: number;
  goal: number;
}

type AchvState = Pick<GameState, "stats" | "achievements"> | null | undefined;

export class Achievements {
  // Side-effect-free detection. Iterates the curated roster in
  // Config.ACHIEVEMENTS array order so the result is deterministic. The
  // comparison is direct numeric >= — no rounding, no epsilon. Nil-safe on
  // every field; a missing stat metric evaluates as 0.
  static evaluate(state: AchvState): string[] {
    const s = state?.stats ?? {};
    const unlocked = state?.achievements ?? {};
    const newly: string[] = [];
    for (const def of Config.ACHIEVEMENTS) {
      if (!unlocked[def.id] && (s[def.metric] ?? 0) >= def.goal) {
        newly.push(def.id);
      }
    }
    return newly;
  }

  // Persisted-set membership only: a counter past goal but never marked is
  // "in progress", never "unlocked".
  static is_unlocked(state: AchvState, id: string): boolean {
    return state != null && state.achievements != null && state.achievements[id] === true;
  }

  // Render-time mastery count: roster-order membership read over
  // Config.ACHIEVEMENTS, so N can never overshoot the paired
  // #ACHIEVEMENTS denominator even when mark_unlocked marked unknown ids
  // true. Nil-safe (nil state -> 0), zero cache fields.
  static count_unlocked(state: AchvState): number {
    let n = 0;
    for (const def of Config.ACHIEVEMENTS) {
      if (Achievements.is_unlocked(state, def.id)) n += 1;
    }
    return n;
  }

  // Fresh read-only struct per call: recomputed each time, never cached,
  // never mutating. A missing stat key yields current 0, not undefined.
  // Unknown IDs return null so a stale row fails loudly rather than
  // fabricating a badge.
  static get_progress(state: AchvState, id: string): AchievementProgress | null {
    for (const def of Config.ACHIEVEMENTS) {
      if (def.id === id) {
        const s = state?.stats ?? {};
        return {
          id: def.id,
          label: def.label,
          metric: def.metric,
          current: s[def.metric] ?? 0,
          goal: def.goal,
        };
      }
    }
    return null;
  }

  // Shared payout helper: the single arithmetic source every caller reads.
  // Prestige multiplier is derived here at the payment site (never stored),
  // gold only; lifetime totals and the since-rebirth counter ride the SAME
  // single credit. Tokens stay raw — the multiplier never touches them.
  static _credit(state: GameState, gold: number, tokens: number): void {
    const mult = Prestige.gold_multiplier(state);
    const paid = gold * mult;
    state.gold = Math.max(0, (state.gold ?? 0) + paid);
    state.total_gold_earned = (state.total_gold_earned ?? 0) + paid;
    state.prestige_gold_since_rebirth =
      (state.prestige_gold_since_rebirth ?? 0) + paid;
    state.tokens = (state.tokens ?? 0) + tokens;
    state.total_tokens_earned = (state.total_tokens_earned ?? 0) + tokens;
    // The per-badge-award accumulators land at the single credit site: the
    // post-multiplier gold and the raw tokens, so the stats panel shows the
    // actual credited amounts. `stats` is KEEP-side, so the sub-keys are
    // zeroed on rebirth by Prestige.rebirth, never here.
    state.stats = state.stats ?? {};
    state.stats.badge_reward_gold = (state.stats.badge_reward_gold ?? 0) + paid;
    state.stats.badge_reward_tokens =
      (state.stats.badge_reward_tokens ?? 0) + tokens;
  }

  // The SOLE write path: call only AFTER consuming evaluate's output.
  // Idempotent by construction — the false-to-true flip inside the guard is
  // the pay trigger, so re-marking an ID already true is a pure no-op. A
  // batch sums its per-badge amounts into ONE combined credit; an unknown
  // id marks true and pays nothing.
  static mark_unlocked(
    state: GameState | null | undefined,
    ids: string[] | null | undefined,
  ): void {
    if (!state || !ids) return;
    state.achievements = state.achievements ?? {};
    let gold = 0;
    let tokens = 0;
    for (const id of ids) {
      if (!state.achievements[id]) {
        state.achievements[id] = true;
        for (const def of Config.ACHIEVEMENTS) {
          if (def.id === id) {
            const amounts =
              Config.ACHV_REWARDS[def.tier as keyof typeof Config.ACHV_REWARDS];
            if (!amounts) {
              throw new Error(
                `ACHV_REWARDS row missing for tier: ${String(def.tier)}`,
              );
            }
            gold += amounts.gold;
            tokens += amounts.tokens;
            break;
          }
        }
      }
    }
    if (gold > 0 || tokens > 0) {
      Achievements._credit(state, gold, tokens);
    }
  }

  // Convenience: the curated roster without requiring config directly.
  static all_definitions(): typeof Config.ACHIEVEMENTS {
    return Config.ACHIEVEMENTS;
  }

  // Ordered panel rows: one progress struct per definition, in
  // Config.ACHIEVEMENTS array order — deterministic across runs.
  static progress_all(state: AchvState): AchievementProgress[] {
    const rows: AchievementProgress[] = [];
    for (const def of Config.ACHIEVEMENTS) {
      const row = Achievements.get_progress(state, def.id);
      if (row) rows.push(row);
    }
    return rows;
  }
}

export default Achievements;
