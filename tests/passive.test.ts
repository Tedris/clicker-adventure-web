import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { createState, type GameState, type WaifuInstance } from "../src/state";
import Passive from "../src/systems/passive";

// Helper: replicate the real Waifu:get_bonus_multiplier contract — sum each
// bonus_type across the roster, per currency, from state.waifus.
const waifuStub = {
  get_bonus_multiplier(state: GameState): [number, number, number] {
    let token_mult = 0;
    let gold_mult = 0;
    let exp_mult = 0;
    for (const w of state.waifus ?? []) {
      if (w.bonus_type === "tokens") token_mult += w.bonus_value ?? 0;
      else if (w.bonus_type === "gold") gold_mult += w.bonus_value ?? 0;
      else if (w.bonus_type === "exp") exp_mult += w.bonus_value ?? 0;
    }
    return [token_mult, gold_mult, exp_mult];
  },
};

function waifu(name: string, bonus_type: string, bonus_value: number): WaifuInstance {
  return { name, bonus_type, bonus_value, rarity: "common" };
}

function unlocked_state(overrides: Partial<GameState> = {}): GameState {
  return { ...createState(), passive_unlocked: true, ...overrides };
}

describe("Passive Generation System", () => {
  it("initializes with correct base rates from config", () => {
    const passive = new Passive();
    expect(passive.base_gold_rate).toBe(Config.PASSIVE_GOLD_RATE);
    expect(passive.base_exp_rate).toBe(Config.PASSIVE_EXP_RATE);
    expect(passive.base_token_rate).toBe(Config.PASSIVE_TOKEN_RATE);
    expect(passive.timer).toBe(0);
  });

  it("awards gold, exp and tokens once the 1-second accumulator fills", () => {
    const passive = new Passive();
    const state = unlocked_state();
    passive.update(1.0, state);
    expect(state.gold).toBe(Config.PASSIVE_GOLD_RATE);
    expect(state.total_gold_earned).toBe(Config.PASSIVE_GOLD_RATE);
    expect(state.exp).toBe(Config.PASSIVE_EXP_RATE);
    expect(state.total_exp_earned).toBe(Config.PASSIVE_EXP_RATE);
    expect(state.tokens).toBe(Config.PASSIVE_TOKEN_RATE);
    expect(state.total_tokens_earned).toBe(Config.PASSIVE_TOKEN_RATE);
  });

  it("accumulates resources across multiple ticks", () => {
    const passive = new Passive();
    const state = unlocked_state();
    passive.update(1.0, state);
    const g1 = state.gold;
    passive.update(1.0, state);
    expect(state.gold).toBe(g1 * 2);
    expect(state.total_gold_earned).toBe(Config.PASSIVE_GOLD_RATE * 2);
  });

  it("does not award resources within a partial (<1s) tick", () => {
    const passive = new Passive();
    const state = unlocked_state();
    passive.update(0.5, state);
    expect(state.gold).toBe(0);
  });

  it("resets the timer after a tick (subsequent partial ticks work)", () => {
    const passive = new Passive();
    const state = unlocked_state();
    passive.update(1.0, state);
    expect(passive.timer).toBe(0);
    passive.update(0.5, state);
    expect(passive.timer).toBe(0.5);
    expect(state.gold).toBe(Config.PASSIVE_GOLD_RATE);
  });

  it("handles partial timer accumulation correctly (0.7 + 0.4)", () => {
    const passive = new Passive();
    const state = unlocked_state();
    passive.update(0.7, state);
    expect(state.gold).toBe(0);
    passive.update(0.4, state);
    expect(state.gold).toBe(Config.PASSIVE_GOLD_RATE);
  });

  it("tracks total_earned fields independently from current balance", () => {
    const passive = new Passive();
    const state = unlocked_state({
      gold: 100,
      total_gold_earned: 10,
    });
    passive.update(1.0, state);
    expect(state.gold).toBe(100 + Config.PASSIVE_GOLD_RATE);
    expect(state.total_gold_earned).toBe(10 + Config.PASSIVE_GOLD_RATE);
  });

  it("handles missing total_earned fields gracefully", () => {
    const passive = new Passive();
    const state = {
      gold: 0,
      exp: 0,
      tokens: 0,
      passive_unlocked: true,
    } as GameState;
    passive.update(1.0, state);
    expect(state.total_gold_earned).toBeDefined();
    expect(state.total_exp_earned).toBeDefined();
    expect(state.total_tokens_earned).toBeDefined();
    expect(state.total_gold_earned).toBe(Config.PASSIVE_GOLD_RATE);
  });

  it("provides state argument safety (nil state throws)", () => {
    const passive = new Passive();
    expect(() => passive.update(1.0, null as unknown as GameState)).toThrow();
  });

  it("empty roster yields base token rate only", () => {
    const passive = new Passive(null, waifuStub);
    const state = unlocked_state({ waifus: [] });
    passive.update(1.0, state);
    expect(state.tokens).toBe(1);
    expect(state.total_tokens_earned).toBe(1);
  });

  it("waifu bonuses apply per currency and stack additively", () => {
    const passive = new Passive(null, waifuStub);
    const state = unlocked_state({
      waifus: [
        waifu("Karen", "tokens", 0.1),
        waifu("Karen2", "tokens", 0.1),
        waifu("Steve", "gold", 0.05),
        waifu("Linda", "exp", 0.07),
      ],
    });
    passive.update(1.0, state);
    expect(state.tokens).toBeCloseTo(Config.PASSIVE_TOKEN_RATE * (1 + 0.2));
    expect(state.gold).toBeCloseTo(Config.PASSIVE_GOLD_RATE * 1.05);
    expect(state.exp).toBeCloseTo(Config.PASSIVE_EXP_RATE * 1.07);
  });

  it("exp bonuses stack additively", () => {
    const passive = new Passive(null, waifuStub);
    const state = unlocked_state({
      waifus: [waifu("Linda", "exp", 0.07), waifu("Linda2", "exp", 0.07)],
    });
    passive.update(1.0, state);
    expect(state.exp).toBeCloseTo(Config.PASSIVE_EXP_RATE * (1 + 0.14));
  });

  it("roster bonus persists across multiple ticks", () => {
    const passive = new Passive(null, waifuStub);
    const state = unlocked_state({ waifus: [waifu("Karen", "tokens", 0.1)] });
    passive.update(1.0, state);
    passive.update(1.0, state);
    passive.update(1.0, state);
    expect(state.tokens).toBeCloseTo(3.3);
    expect(state.total_tokens_earned).toBeCloseTo(3.3);
  });

  it("roster bonus reads state.waifus each tick, not a constructor snapshot", () => {
    const passive = new Passive(null, waifuStub);
    const state = unlocked_state({ waifus: [] });
    passive.update(1.0, state);
    expect(state.tokens).toBe(1);

    state.waifus = [waifu("Karen", "tokens", 0.1), waifu("Karen2", "tokens", 0.1)];
    passive.update(1.0, state);
    expect(state.tokens).toBeCloseTo(2.2);
  });

  it("idle multiplier scales gold/exp but not tokens", () => {
    const upgrades = { get_passive_multiplier: () => 6 };
    const passive = new Passive(upgrades, waifuStub);
    const state = unlocked_state({
      waifus: [
        waifu("Karen", "tokens", 0.1),
        waifu("Steve", "gold", 0.05),
        waifu("Linda", "exp", 0.07),
      ],
    });
    passive.apply_passive_rewards(state);
    expect(state.tokens).toBeCloseTo(1.1);
    expect(state.gold).toBeCloseTo(Config.PASSIVE_GOLD_RATE * 6 * 1.05);
    expect(state.exp).toBeCloseTo(Config.PASSIVE_EXP_RATE * 6 * 1.07);
  });

  it("numeric idle multiplier 0 is honored; thrown errors fall back to 1", () => {
    const zero = new Passive({ get_passive_multiplier: () => 0 });
    const stateZero = unlocked_state();
    zero.apply_passive_rewards(stateZero);
    expect(stateZero.gold).toBe(0);
    expect(stateZero.exp).toBe(0);
    expect(stateZero.tokens).toBe(Config.PASSIVE_TOKEN_RATE);

    const thrower = new Passive({
      get_passive_multiplier: () => {
        throw new Error("boom");
      },
    });
    const stateThrow = unlocked_state();
    thrower.apply_passive_rewards(stateThrow);
    expect(stateThrow.gold).toBeCloseTo(Config.PASSIVE_GOLD_RATE);
    expect(stateThrow.exp).toBeCloseTo(Config.PASSIVE_EXP_RATE);
  });

  it("prestige multiplier applies to GOLD only", () => {
    const passive = new Passive();
    const state = unlocked_state({ prestige_points: 100 });
    passive.apply_passive_rewards(state);
    // 1 + 100 * PRESTIGE_MULTIPLIER_PER_POINT (=2 with the 0.01 constant)
    const prestige_mult = 1 + Config.PRESTIGE_MULTIPLIER_PER_POINT * 100;
    expect(state.gold).toBeCloseTo(Config.PASSIVE_GOLD_RATE * prestige_mult);
    expect(state.exp).toBeCloseTo(Config.PASSIVE_EXP_RATE);
    expect(state.tokens).toBeCloseTo(Config.PASSIVE_TOKEN_RATE);
  });

  it("does not generate resources when passive is locked", () => {
    const passive = new Passive();
    const state = unlocked_state({ passive_unlocked: false });
    passive.update(5.0, state);
    expect(state.gold).toBe(0);
    expect(state.exp).toBe(0);
    expect(state.tokens).toBe(0);
    expect(state.total_gold_earned).toBe(0);
    expect(state.total_exp_earned).toBe(0);
    expect(state.total_tokens_earned).toBe(0);
  });
});
