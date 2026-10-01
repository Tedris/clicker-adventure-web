// src/systems/daily.ts
// Daily login streak system (Story 4.3). Pure logic: `now` is injected like
// Offline.apply so tests never touch the wall clock for rollover math.
// Days are UTC indexes (floor(now / DAILY_LOGIN_DAY_SECONDS)): a claim pays
// the ladder tier for the consecutive-day streak, resets to tier 1 after a
// missed day, repeats the top tier on day 8+, and a clock rolled backwards
// (day < last_login_day) neither pays nor breaks the streak.

import Config from "../config";
import type { GameState } from "../state";

export interface DailyReport {
  day: number;
  tokens: number;
}

export class Daily {
  // Claims today's reward. Returns { day, tokens } or null when today is
  // already claimed / the clock went backwards. Applies the token gain to
  // state (tokens + total_tokens_earned) so the save fingerprint sees it
  // and the autosave picks the streak up (Story 4.4).
  static check(state: GameState, now: number): DailyReport | null {
    const day = Math.floor(now / Config.DAILY_LOGIN_DAY_SECONDS);
    const prev = state.last_login_day ?? 0;
    if (day <= prev) {
      return null;
    }

    let streak: number;
    if (prev > 0 && day === prev + 1) {
      streak = (state.login_streak ?? 0) + 1;
    } else {
      streak = 1;
    }

    const ladder = Config.DAILY_LOGIN_REWARDS;
    const tokens = ladder[Math.min(streak, ladder.length) - 1];

    state.login_streak = streak;
    state.last_login_day = day;
    state.tokens = (state.tokens ?? 0) + tokens;
    state.total_tokens_earned = (state.total_tokens_earned ?? 0) + tokens;

    if (Config.DEBUG_MODE) {
      console.log(`[DEBUG] [DAILY] Day ${streak} login: +${tokens} tokens`);
    }

    return { day: streak, tokens };
  }
}

export default Daily;
