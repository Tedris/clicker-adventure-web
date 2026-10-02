import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { createState, type GameState, type WaifuInstance } from "../src/state";
import Offline from "../src/systems/offline";

// Fixed clock base so injected `now` values are deterministic literals.
const T0 = 1700000000;

function unlocked_state(overrides: Partial<GameState> = {}): GameState {
  return { ...createState(), last_save_time: T0, passive_unlocked: true, ...overrides };
}

function waifu(name: string, bonus_type: string, bonus_value: number): WaifuInstance {
  return { name, bonus_type, bonus_value, rarity: "common" };
}

// Mirrors the real Upgrades:get_passive_multiplier() formula: 1 + level * 0.5.
function upgrades_at_idle_level(level: number) {
  return { get_passive_multiplier: () => 1 + level * 0.5 };
}

describe("Offline System - skip window", () => {
  it("away 59s: no gains, no report", () => {
    const state = unlocked_state();
    const report = Offline.apply(state, T0 + 59, null);
    expect(report).toBeNull();
    expect(state.gold).toBe(0);
    expect(state.exp).toBe(0);
    expect(state.tokens).toBe(0);
    expect(state.total_gold_earned).toBe(0);
    expect(state.total_exp_earned).toBe(0);
    expect(state.total_tokens_earned).toBe(0);
  });

  it("away exactly 60s (boundary): gains awarded", () => {
    const state = unlocked_state();
    const report = Offline.apply(state, T0 + 60, null);
    expect(report).not.toBeNull();
    expect(report!.seconds).toBe(60);
    expect(state.tokens).toBeGreaterThan(0);
    expect(state.gold).toBeGreaterThan(0);
    expect(state.exp).toBeGreaterThan(0);
  });
});

describe("Offline System - 8-hour cap", () => {
  it("away 3 days: capped at exactly 28800s", () => {
    const state = unlocked_state();
    const report = Offline.apply(state, T0 + 259200, null);
    expect(report!.seconds).toBe(28800);
    expect(state.tokens).toBe(28800 * Config.PASSIVE_TOKEN_RATE);
    expect(state.total_tokens_earned).toBe(28800 * Config.PASSIVE_TOKEN_RATE);
  });

  it("fractional over-cap input still caps at 28800 exactly", () => {
    const state = unlocked_state();
    const report = Offline.apply(state, T0 + 28800.5, null);
    expect(report!.seconds).toBe(28800);
    expect(state.tokens).toBeCloseTo(28800 * Config.PASSIVE_TOKEN_RATE);
  });

  it("away exactly 28800s is not clipped below", () => {
    const state = unlocked_state();
    const report = Offline.apply(state, T0 + 28800, null);
    expect(report!.seconds).toBe(28800);
  });
});

describe("Offline System - formula parity", () => {
  const waifus = [
    waifu("Karen", "tokens", 0.1),
    waifu("Steve", "gold", 0.05),
    waifu("Linda", "exp", 0.07),
  ];

  it("3600s @ idle level 5: idle_mult scales gold/exp but NOT tokens", () => {
    const state = unlocked_state({ waifus });
    const report = Offline.apply(state, T0 + 3600, upgrades_at_idle_level(5))!;
    // idle_mult = 1 + 5 * 0.5 = 3.5
    expect(report.tokens).toBeCloseTo(3600 * Config.PASSIVE_TOKEN_RATE * 1.1);
    expect(report.gold).toBeCloseTo(3600 * Config.PASSIVE_GOLD_RATE * 3.5 * 1.05);
    expect(report.exp).toBeCloseTo(3600 * Config.PASSIVE_EXP_RATE * 3.5 * 1.07);
    expect(state.tokens).toBeCloseTo(report.tokens);
    expect(state.gold).toBeCloseTo(report.gold);
    expect(state.exp).toBeCloseTo(report.exp);
  });

  it("totals increase by the same amounts as the currency fields", () => {
    const state = unlocked_state({
      waifus,
      gold: 100,
      exp: 50,
      tokens: 10,
      total_gold_earned: 100,
      total_exp_earned: 50,
      total_tokens_earned: 10,
    });
    const report = Offline.apply(state, T0 + 3600, upgrades_at_idle_level(5))!;
    expect(state.total_gold_earned).toBeCloseTo(100 + report.gold);
    expect(state.total_exp_earned).toBeCloseTo(50 + report.exp);
    expect(state.total_tokens_earned).toBeCloseTo(10 + report.tokens);
    expect(state.gold).toBeCloseTo(100 + report.gold);
    expect(state.exp).toBeCloseTo(50 + report.exp);
    expect(state.tokens).toBeCloseTo(10 + report.tokens);
  });

  it("idle_mult scales gold/exp but leaves tokens unmultiplied", () => {
    const m1 = unlocked_state();
    const m5 = unlocked_state();
    const r1 = Offline.apply(m1, T0 + 3600, upgrades_at_idle_level(1))!;
    const r5 = Offline.apply(m5, T0 + 3600, upgrades_at_idle_level(5))!;
    expect(r5.tokens).toBeCloseTo(r1.tokens);
    expect(r5.gold).toBeCloseTo(r1.gold * (3.5 / 1.5));
    expect(r5.exp).toBeCloseTo(r1.exp * (3.5 / 1.5));
  });
});

describe("Offline System - gates and defensive shapes", () => {
  it("first run (last_save_time = 0): null report, no gains", () => {
    const state = unlocked_state({ last_save_time: 0 });
    expect(Offline.apply(state, T0 + 86400, null)).toBeNull();
    expect(state.tokens).toBe(0);
  });

  it("passive_unlocked = false: null report even after 2 hours", () => {
    const state = unlocked_state({ passive_unlocked: false });
    expect(Offline.apply(state, T0 + 7200, null)).toBeNull();
    expect(state.tokens).toBe(0);
    expect(state.gold).toBe(0);
    expect(state.exp).toBe(0);
  });

  it("future last_save_time (negative elapsed): null report, no negative gains", () => {
    const state = unlocked_state({ last_save_time: T0 + 3600 });
    expect(Offline.apply(state, T0, null)).toBeNull();
    expect(state.tokens).toBe(0);
    expect(state.gold).toBe(0);
    expect(state.exp).toBe(0);
    expect(state.total_tokens_earned).toBe(0);
  });

  it("empty waifus: treated as zero multipliers", () => {
    const state = unlocked_state({ waifus: [] });
    const report = Offline.apply(state, T0 + 600, null)!;
    expect(report.tokens).toBeCloseTo(600 * Config.PASSIVE_TOKEN_RATE);
    expect(report.gold).toBeCloseTo(600 * Config.PASSIVE_GOLD_RATE);
    expect(report.exp).toBeCloseTo(600 * Config.PASSIVE_EXP_RATE);
  });

  it("missing upgrades object: idle_mult falls back to 1", () => {
    const state = unlocked_state();
    const report = Offline.apply(state, T0 + 600, null)!;
    expect(report.gold).toBeCloseTo(600 * Config.PASSIVE_GOLD_RATE);
    expect(report.exp).toBeCloseTo(600 * Config.PASSIVE_EXP_RATE);
  });

  it("throwing upgrades.get_passive_multiplier falls back to idle_mult = 1", () => {
    const thrower = {
      get_passive_multiplier: () => {
        throw new Error("boom");
      },
    };
    const state = unlocked_state();
    const report = Offline.apply(state, T0 + 600, thrower)!;
    expect(report.gold).toBeCloseTo(600 * Config.PASSIVE_GOLD_RATE);
  });
});

describe("Offline System - report contract", () => {
  it("report has exactly {seconds, tokens, gold, exp} with seconds = capped", () => {
    const state = unlocked_state();
    const report = Offline.apply(state, T0 + 99999, null)!;
    expect(report.seconds).toBe(28800);
    expect(Object.keys(report).sort()).toEqual(["exp", "gold", "seconds", "tokens"]);
    expect(typeof report.tokens).toBe("number");
    expect(typeof report.gold).toBe("number");
    expect(typeof report.exp).toBe("number");
  });
});

describe("Offline System - assigned-lane scaling", () => {
  it("only the CURRENT area's lane pays while away", () => {
    const state = unlocked_state({
      waifus: [
        waifu("Rosa the Barista", "gold", 0.08),
        waifu("Hank the Truck Driver", "gold", 0.15),
      ],
      assignments: { 0: ["Rosa the Barista"] },
    });
    const report = Offline.apply(state, T0 + 600, null)!;
    // Rosa (assigned) counts, Hank (other lane) does not.
    expect(report.gold).toBeCloseTo(600 * Config.PASSIVE_GOLD_RATE * 1.08);
  });

  it("an empty lane falls back to the top EQUIP_SLOTS by bonus", () => {
    const waifus = [
      waifu("A", "gold", 0.01),
      waifu("B", "gold", 0.02),
      waifu("C", "gold", 0.03),
      waifu("D", "gold", 0.04),
    ];
    const state = unlocked_state({ waifus });
    const report = Offline.apply(state, T0 + 600, null)!;
    // Top EQUIP_SLOTS by value: D + C + B = 0.09 of the four's 0.10 sum.
    expect(report.gold).toBeCloseTo(600 * Config.PASSIVE_GOLD_RATE * 1.09);
  });
});
