import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { createState, type GameState } from "../src/state";
import Daily from "../src/systems/daily";

// Exact UTC day boundary so day arithmetic is literal in these tests.
const DAY = Config.DAILY_LOGIN_DAY_SECONDS;
const T0 = 1700006400;
const D0 = Math.floor(T0 / DAY); // 19676

function fresh_state(overrides: Partial<GameState> = {}): GameState {
  return { ...createState(), last_save_time: 0, ...overrides };
}

describe("Daily Login - config contract", () => {
  it("DAILY_LOGIN_REWARDS is a strictly increasing ladder over 7 tiers", () => {
    const r = Config.DAILY_LOGIN_REWARDS;
    expect(r.length).toBe(7);
    r.forEach((v, i) => {
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThan(0);
      if (i > 0) expect(v).toBeGreaterThan(r[i - 1]);
    });
  });

  it("DAILY_LOGIN_DAY_SECONDS is one UTC day", () => {
    expect(DAY).toBe(86400);
  });
});

describe("Daily Login - first claim", () => {
  it("first boot claims day 1 and awards the first ladder tier", () => {
    const state = fresh_state();
    const report = Daily.check(state, T0);
    expect(report).not.toBeNull();
    expect(report!.day).toBe(1);
    expect(report!.tokens).toBe(Config.DAILY_LOGIN_REWARDS[0]);
    expect(state.login_streak).toBe(1);
    expect(state.last_login_day).toBe(D0);
    expect(state.tokens).toBe(Config.DAILY_LOGIN_REWARDS[0]);
    expect(state.total_tokens_earned).toBe(Config.DAILY_LOGIN_REWARDS[0]);
  });

  it("report carries exactly {day, tokens}", () => {
    const report = Daily.check(fresh_state(), T0)!;
    expect(Object.keys(report).sort()).toEqual(["day", "tokens"]);
    expect(typeof report.day).toBe("number");
    expect(typeof report.tokens).toBe("number");
  });
});

describe("Daily Login - same day and consecutive days", () => {
  it("a second check the same day awards nothing", () => {
    const state = fresh_state();
    Daily.check(state, T0);
    const report = Daily.check(state, T0 + DAY - 1);
    expect(report).toBeNull();
    expect(state.login_streak).toBe(1);
    expect(state.tokens).toBe(Config.DAILY_LOGIN_REWARDS[0]);
  });

  it("each consecutive day walks the ladder up to tier 7", () => {
    const state = fresh_state();
    for (let d = 1; d <= 7; d++) {
      const report = Daily.check(state, T0 + (d - 1) * DAY);
      expect(report).not.toBeNull();
      expect(report!.day).toBe(d);
      expect(report!.tokens).toBe(Config.DAILY_LOGIN_REWARDS[d - 1]);
      expect(state.login_streak).toBe(d);
    }
  });

  it("day 8+ keeps the streak counting and repeats the top tier", () => {
    const state = fresh_state();
    for (let d = 1; d <= 7; d++) Daily.check(state, T0 + (d - 1) * DAY);
    const report = Daily.check(state, T0 + 7 * DAY);
    expect(report!.day).toBe(8);
    expect(Config.DAILY_LOGIN_REWARDS.length).toBe(7);
    expect(report!.tokens).toBe(Config.DAILY_LOGIN_REWARDS[6]);
    expect(state.login_streak).toBe(8);
  });
});

describe("Daily Login - streak break", () => {
  it("missing a day resets the streak to 1 and recomputes the ladder", () => {
    const state = fresh_state();
    Daily.check(state, T0);
    Daily.check(state, T0 + DAY);
    expect(state.login_streak).toBe(2);
    const report = Daily.check(state, T0 + 3 * DAY);
    expect(report!.day).toBe(1);
    expect(report!.tokens).toBe(Config.DAILY_LOGIN_REWARDS[0]);
    expect(state.login_streak).toBe(1);
  });

  it("a long absence also resets to 1", () => {
    const state = fresh_state();
    Daily.check(state, T0);
    state.login_streak = 6;
    const report = Daily.check(state, T0 + 30 * DAY);
    expect(report!.day).toBe(1);
    expect(report!.tokens).toBe(Config.DAILY_LOGIN_REWARDS[0]);
  });
});

describe("Daily Login - clock-rollback defense", () => {
  it("a future-dated last_login_day awards nothing and keeps the streak", () => {
    const state = fresh_state({ last_login_day: D0 + 1, login_streak: 4 });
    const report = Daily.check(state, T0);
    expect(report).toBeNull();
    expect(state.login_streak).toBe(4);
    expect(state.last_login_day).toBe(D0 + 1);
    expect(state.tokens).toBe(0);
  });
});

describe("Daily Login - persistence shape", () => {
  it("claimed streak lives on persisted state fields (streak + last_login_day)", () => {
    const state = fresh_state();
    for (let d = 1; d <= 3; d++) Daily.check(state, T0 + (d - 1) * DAY);
    // These are exactly the fields the save scheme carries; login_report is
    // session-only. Reload simulates rehydrating them into a fresh state.
    const fresh = fresh_state({
      login_streak: state.login_streak,
      last_login_day: state.last_login_day,
      tokens: state.tokens,
    });
    expect(fresh.login_streak).toBe(3);
    expect(fresh.last_login_day).toBe(D0 + 2);
    expect(fresh.login_report).toBeNull();
    // Same-day re-claim stays blocked after reload.
    expect(Daily.check(fresh, T0 + 2 * DAY + 10)).toBeNull();
  });
});
