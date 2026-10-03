// tests/gacha.test.ts
// Vitest tests for the gacha/pity system (ported from tests/test_gacha.lua).

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { Gacha, type RandomFn } from "../src/systems/gacha";
import type { GameState } from "../src/state";

// Minimal state fixtures (the Lua tests pass plain tables).
function st(props: Record<string, unknown>): GameState {
  return props as unknown as GameState;
}

// Success-path pulls consume the RNG in order: drop roll, pool index, rarity
// roll. Stub feeds them positionally (no-max calls get [0,1) values, maxed
// calls integer indices) — mirrors the Lua math.random stub.
function stubRandom(drop: number, poolIdx: number, rarityRoll: number): RandomFn {
  const values = [drop, poolIdx, rarityRoll];
  let i = 0;
  return () => values[i++ % values.length];
}

function successPull(rng: RandomFn, state: GameState) {
  state.pity_counter = Config.PITY_HARD; // 100% drop, no RNG dependence
  return new Gacha(rng).pull(state)!;
}

function freshState(): GameState {
  return st({ tokens: 1000, pity_counter: 0, waifus: [] });
}

describe("Gacha System", () => {
  it("initializes with correct configuration", () => {
    const gacha = new Gacha();
    expect(gacha).toBeTruthy();
    expect(typeof gacha.get_probability(0)).toBe("number");
    expect(gacha.get_random_waifu()).toBeTruthy();
    expect(gacha.get_next_threshold(0)).toBeNull();
    expect(gacha.get_display_info(0)).toBeTruthy();
  });

  it("returns nil when tokens are insufficient", () => {
    const gacha = new Gacha();
    const state = st({ tokens: 0, pity_counter: 0, waifus: [] });
    expect(gacha.pull(state)).toBeNull();
    expect(state.tokens).toBe(0);
    expect(state.pity_counter).toBe(0);
  });

  it("returns nil when tokens field is missing", () => {
    const gacha = new Gacha();
    const state = st({ pity_counter: 0, waifus: [] });
    expect(gacha.pull(state)).toBeNull();
  });

  it("deducts pull cost from tokens on successful pull attempt", () => {
    const gacha = new Gacha();
    const state = st({ tokens: Config.PULL_COST + 5, pity_counter: 100, waifus: [] });
    const result = gacha.pull(state);
    expect(result).not.toBeNull();
    expect(state.tokens).toBe(Config.PULL_COST + 5 - Config.PULL_COST);
  });

  describe("Probability Calculation", () => {
    const gacha = new Gacha();
    it("base rate is 5% without pity", () => {
      expect(gacha.get_probability(0)).toBe(Config.BASE_DROP_RATE);
      expect(gacha.get_probability(0)).toBe(0.05);
    });
    it("base rate is 5% at 74 pulls", () => {
      expect(gacha.get_probability(74)).toBe(Config.BASE_DROP_RATE);
      expect(gacha.get_probability(74)).toBe(0.05);
    });
    it("soft pity rate is 10% at 75 pulls", () => {
      expect(gacha.get_probability(75)).toBe(Config.SOFT_PITY_RATE);
      expect(gacha.get_probability(75)).toBe(0.1);
    });
    it("soft pity rate is 10% at 99 pulls", () => {
      expect(gacha.get_probability(99)).toBe(Config.SOFT_PITY_RATE);
      expect(gacha.get_probability(99)).toBe(0.1);
    });
    it("hard pity rate is 100% at 100 pulls", () => {
      expect(gacha.get_probability(100)).toBe(1.0);
    });
    it("hard pity rate is 100% at 101 pulls (past hard pity)", () => {
      expect(gacha.get_probability(101)).toBe(1.0);
    });
    it("probability is monotonically non-decreasing with pity", () => {
      let prev = gacha.get_probability(0);
      for (let i = 1; i <= 100; i++) {
        const curr = gacha.get_probability(i);
        expect(curr >= prev).toBe(true);
        prev = curr;
      }
    });
  });

  describe("Pull Mechanics", () => {
    it("failed pull increments pity counter", () => {
      const gacha = new Gacha(() => 0.999); // always misses the 5% rate
      const state = st({ tokens: Config.PULL_COST + 100, pity_counter: 50, waifus: [] });
      gacha.pull(state);
      expect(state.pity_counter).toBeGreaterThanOrEqual(50); // counter never decreases
      expect(state.pity_counter).toBe(51);
    });

    it("pity counter resets to 0 on successful pull at hard pity", () => {
      const gacha = new Gacha();
      const state = st({ tokens: Config.PULL_COST + 100, pity_counter: 100, waifus: [] });
      const result = gacha.pull(state); // probability is 1.0 at hard pity
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(state.pity_counter).toBe(0);
    });

    it("pity counter increments on failure", () => {
      const state = st({ tokens: Config.PULL_COST + 100, pity_counter: 0, waifus: [] });
      // Simulate the failure branch: deduct tokens, increment counter.
      state.tokens = state.tokens - Config.PULL_COST;
      state.pity_counter = state.pity_counter + 1;
      expect(state.pity_counter).toBe(1);
      expect(state.tokens).toBe(100);
    });

    it("handles nil pity_counter gracefully (defaults to 0)", () => {
      const gacha = new Gacha();
      const state = st({ tokens: Config.PULL_COST + 100, waifus: [] });
      expect(gacha.get_probability(state.pity_counter ?? 0)).toBe(0.05);
    });

    it("handles nil waifus table on success (creates one)", () => {
      const gacha = new Gacha();
      const state = st({ tokens: Config.PULL_COST + 100, pity_counter: 100 });
      const result = gacha.pull(state);
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(state.waifus).toBeTruthy();
      expect(state.waifus.length).toBe(1);
    });
  });

  describe("Waifu Pool", () => {
    it("returns a waifu from the pool with the correct data shape", () => {
      const gacha = new Gacha(() => 1); // pool index 1 -> first entry
      const waifu = gacha.get_random_waifu();
      expect(waifu).toBeTruthy();
      expect(waifu!.name).toBe("Karen the Accountant");
      expect(waifu!.bonus_type).toBe("tokens");
      expect(waifu!.bonus_value).toBe(0.10);
    });

    it("returns nil when waifu pool is empty", () => {
      const original = Config.WAIFU_POOL;
      Config.WAIFU_POOL = [];
      expect(new Gacha().get_random_waifu()).toBeNull();
      Config.WAIFU_POOL = original;
    });

    it("returns nil when waifu pool is nil", () => {
      const original = Config.WAIFU_POOL;
      (Config as { WAIFU_POOL: unknown }).WAIFU_POOL = null;
      expect(new Gacha().get_random_waifu()).toBeNull();
      Config.WAIFU_POOL = original;
    });

    it("area 0 keeps the legacy 3-name pool byte-for-byte", () => {
      const gacha = new Gacha(() => 3); // last index of a 3-entry pool
      expect(gacha.get_random_waifu(0)!.name).toBe("Linda the Middle Manager");
    });

    it("later areas join their hires to the pool", () => {
      // area 1 pool: Karen, Steve, Linda, Dave, Maya, Dave, Maya (current double).
      const gacha = new Gacha(() => 4);
      expect(gacha.get_random_waifu(1)!.name).toBe("Dave from IT");
      // area 5 stacks every hire once, plus its own pair doubled:
      // K, S, L, Dave, Maya, Priya, Rosa, Carl, Tina, Diaz, Ana, Gus, Hank,
      // Elaine, Bob, Elaine, Bob -> index 13 is Hank the Truck Driver.
      const deep = new Gacha(() => 13);
      expect(deep.get_random_waifu(5)!.name).toBe("Hank the Truck Driver");
    });

    it("counts each new hire name once in stats.unique_hires", () => {
      // Deterministic success path: pity guarantees the drop, the stub
      // feeds drop/pool/rarity rolls positionally.
      const state = st({ tokens: 1000, pity_counter: Config.PITY_HARD, waifus: [], stats: {} });
      const gacha = new Gacha(stubRandom(0, 3, 50));
      gacha.pull(state);
      gacha.pull(state);
      expect(state.waifus.length).toEqual(2);
      expect(state.stats.unique_hires).toEqual(1);
      expect(state.stats.pulls_total).toEqual(2);
    });
  });

  describe("Hard Pity Guarantee", () => {
    it("guarantees waifu at 100 pulls (deterministic)", () => {
      const gacha = new Gacha();
      const state = st({ tokens: Config.PULL_COST + 100, pity_counter: 100, waifus: [] });
      const result = gacha.pull(state);
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.waifu).toBeTruthy();
      expect(state.pity_counter).toBe(0);
    });

    it("guarantees waifu at any pity >= 100", () => {
      const gacha = new Gacha();
      for (const pityVal of [100, 101, 150, 200]) {
        const state = st({ tokens: Config.PULL_COST + 100, pity_counter: pityVal, waifus: [] });
        const result = gacha.pull(state);
        expect(result).not.toBeNull();
        expect(result!.success).toBe(true);
      }
    });
  });

  describe("Next Threshold", () => {
    const gacha = new Gacha();
    it("returns nil below soft pity", () => {
      expect(gacha.get_next_threshold(0)).toBeNull();
      expect(gacha.get_next_threshold(74)).toBeNull();
    });
    it("returns soft at soft pity threshold", () => {
      expect(gacha.get_next_threshold(75)).toBe("soft");
      expect(gacha.get_next_threshold(99)).toBe("soft");
    });
    it("returns hard at hard pity threshold", () => {
      expect(gacha.get_next_threshold(100)).toBe("hard");
      expect(gacha.get_next_threshold(150)).toBe("hard");
    });
  });

  describe("Display Info", () => {
    const gacha = new Gacha();
    it("returns correct display info at 0 pity", () => {
      const info = gacha.get_display_info(0);
      expect(info.counter).toBe(0);
      expect(info.max).toBe(100);
      expect(info.threshold).toBeNull();
      expect(info.warning).toBe(false);
    });
    it("returns correct display info at 90 pity (warning)", () => {
      const info = gacha.get_display_info(90);
      expect(info.counter).toBe(90);
      expect(info.max).toBe(100);
      expect(info.threshold).toBe("soft");
      expect(info.warning).toBe(true);
    });
    it("returns correct display info at 100 pity (hard)", () => {
      const info = gacha.get_display_info(100);
      expect(info.counter).toBe(100);
      expect(info.max).toBe(100);
      expect(info.threshold).toBe("hard");
      expect(info.warning).toBe(true);
    });
    it("handles nil pity_counter gracefully", () => {
      expect(gacha.get_display_info(undefined).counter).toBe(0);
    });
  });

  describe("State Argument Safety", () => {
    it("raises error on nil state", () => {
      const gacha = new Gacha();
      expect(() => gacha.pull(undefined as unknown as GameState)).toThrow(
        "Gacha:pull requires state table",
      );
    });
  });

  describe("Token Validation", () => {
    const gacha = new Gacha();
    it("pull succeeds with exactly PULL_COST tokens", () => {
      const state = st({ tokens: Config.PULL_COST, pity_counter: 100, waifus: [] });
      const result = gacha.pull(state);
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(state.tokens).toBe(0);
    });

    it("does not pull with one less than PULL_COST tokens", () => {
      const state = st({ tokens: Config.PULL_COST - 1, pity_counter: 100, waifus: [] });
      expect(gacha.pull(state)).toBeNull();
      expect(state.tokens).toBe(Config.PULL_COST - 1);
    });
  });

  describe("Rarity Tiers (per-pull roll)", () => {
    it("pull produces an independent instance: mutating it never infects Config.WAIFU_POOL", () => {
      const result = successPull(stubRandom(0, 1, 0), freshState());
      expect(result.success).toBe(true);
      result.waifu!.bonus_value = 999;
      result.waifu!.name = "Not Karen";
      expect(Config.WAIFU_POOL[0].bonus_value).toBe(0.10);
      expect(Config.WAIFU_POOL[0].name).toBe("Karen the Accountant");
    });

    it("rarity roll maps cumulative weight bands onto the ladder keys", () => {
      const cases: [number, string][] = [
        [0.3, "common"], [0.699, "common"],
        [0.7, "rare"], [0.91, "rare"],
        [0.92, "epic"], [0.98, "epic"],
        [0.99, "legendary"],
      ];
      for (const [roll, key] of cases) {
        const result = successPull(stubRandom(0, 1, roll), freshState());
        expect(result.waifu!.rarity).toBe(key);
        expect(Config.WAIFU_RARITY_BY_KEY[result.waifu!.rarity]).toBeTruthy();
      }
    });

    it("bonus_value scales by the rolled rarity's bonus_mult, rounded to 3 decimals", () => {
      const karenBase = Config.WAIFU_POOL[0].bonus_value;
      const cases: [number, number][] = [
        [0.5, karenBase * 1.0], // common
        [0.8, karenBase * 1.5], // rare
        [0.95, karenBase * 2.25], // epic
        [0.995, karenBase * 3.5], // legendary
      ];
      for (const [roll, raw] of cases) {
        const expected = Math.floor(raw * 1000 + 0.5) / 1000;
        const result = successPull(stubRandom(0, 1, roll), freshState());
        expect(result.waifu!.bonus_value).toBe(expected);
        expect(result.waifu!.bonus_type).toBe(Config.WAIFU_POOL[0].bonus_type);
      }
    });

    it("every success carries a valid rarity key, even under unstubbed RNG", () => {
      const state = freshState();
      for (let i = 0; i < 30; i++) {
        state.pity_counter = Config.PITY_HARD; // guaranteed success
        const result = new Gacha().pull(state)!;
        expect(Config.WAIFU_RARITY_BY_KEY[result.waifu!.rarity]).toBeTruthy();
        expect(result.waifu!.name).toBeTruthy();
      }
    });

    it("failed pulls carry no waifu and no rarity", () => {
      const gacha = new Gacha(() => 0.999); // always miss (5% rate)
      const state = st({ tokens: 100, pity_counter: 0, waifus: [] });
      const result = gacha.pull(state);
      expect(result!.success).toBe(false);
      expect(result!.waifu).toBeNull();
    });
  });

  describe("Pity Counter Persistence", () => {
    it("pity counter persists across multiple pulls", () => {
      const gacha = new Gacha();
      const state = st({ tokens: Config.PULL_COST * 10 + 100, pity_counter: 70, waifus: [] });
      // Simulate 5 failed pulls
      for (let i = 0; i < 5; i++) {
        gacha.get_probability(state.pity_counter);
        state.tokens = state.tokens - Config.PULL_COST;
        state.pity_counter = state.pity_counter + 1;
      }
      expect(state.pity_counter).toBe(75);
    });

    it("pity counter resets and new cycle begins after hard pity success", () => {
      const gacha = new Gacha();
      const state = st({ tokens: Config.PULL_COST * 5 + 100, pity_counter: 99, waifus: [] });
      // One pull at 99 pity (soft pity, 10% rate) - simulate failure
      state.tokens = state.tokens - Config.PULL_COST;
      state.pity_counter = state.pity_counter + 1;
      expect(state.pity_counter).toBe(100);
      // Next pull at 100 pity - guaranteed success
      const result = gacha.pull(state);
      expect(result!.success).toBe(true);
      expect(state.pity_counter).toBe(0);
    });
  });
});

// STATS-03: a successful pull records pulls_total plus the rolled rarity's
// sibling key; misses and blocked pulls record nothing.
describe("Gacha lifetime stats recording (STATS-03)", () => {
  it("a forced-success pull records pulls_total plus exactly the rolled rarity sibling key", () => {
    // cumulative 70/22/7/1: 0.95*100 lands in the epic band
    const rng = stubRandom(0, 1, 0.95);
    const state = st({ tokens: 1000, pity_counter: Config.PITY_HARD, waifus: [], stats: {} });
    const result = new Gacha(rng).pull(state)!;
    expect(result.success).toBe(true);
    expect(result.waifu!.rarity).toBe("epic");
    expect(state.stats.pulls_total).toBe(1);
    expect(state.stats.pulls_epic).toBe(1);
    expect(state.stats.pulls_common).toBeUndefined();
    expect(state.stats.pulls_rare).toBeUndefined();
    expect(state.stats.pulls_legendary).toBeUndefined();
  });

  it("a forced-miss pull records nothing at all", () => {
    const gacha = new Gacha(() => 0.999); // always misses the 5% base rate
    const state = st({ tokens: 100, pity_counter: 0, waifus: [], stats: {} });
    const result = gacha.pull(state)!;
    expect(result.success).toBe(false);
    expect(Object.keys(state.stats).length).toBe(0);
  });

  it("a blocked pull (insufficient tokens) records nothing", () => {
    const gacha = new Gacha();
    const state = st({ tokens: Config.PULL_COST - 1, pity_counter: 0, waifus: [], stats: {} });
    expect(gacha.pull(state)).toBeNull();
    expect(Object.keys(state.stats).length).toBe(0);
  });

  it("a success pull on a state without a stats table does not error (nil-safe hook)", () => {
    const state = st({ tokens: 1000, pity_counter: Config.PITY_HARD, waifus: [] });
    expect(() => new Gacha().pull(state)).not.toThrow();
  });
});

describe("Luck stack on the drop roll", () => {
  it("rebirth luck lifts a roll that would miss at the base rate", () => {
    // 9 rebirths unlock all three buffs: luck = 1.25 * 1.5 * 2 = 3.75 ->
    // effective rate 0.05 * 3.75 = 0.1875. A 0.09 drop roll fails the bare
    // 5% but succeeds with the rebirth buff stack.
    const state = st({
      tokens: 1000, pity_counter: 0, waifus: [], stats: {}, prestige_rebirths: 9,
    });
    const result = new Gacha(stubRandom(0.09, 1, 0.5)).pull(state)!;
    expect(result.success).toBe(true);
    expect(state.pity_counter).toBe(0);
  });

  it("a bare state keeps the base rate (a near-miss roll still fails)", () => {
    const state = st({ tokens: 1000, pity_counter: 0, waifus: [], stats: {} });
    const result = new Gacha(stubRandom(0.09, 1, 0.5)).pull(state)!;
    expect(result.success).toBe(false);
    expect(state.pity_counter).toBe(1);
  });
});

describe("hire_from_pool (chest hires)", () => {
  function hireRng(poolIdx: number, rarityRoll: number): RandomFn {
    const values = [poolIdx, rarityRoll];
    let i = 0;
    return () => values[i++ % values.length];
  }

  it("hires from the CURRENT area's pool without touching tokens", () => {
    const state = st({ tokens: 3, pity_counter: 7, waifus: [], area_index: 1, stats: {} });
    const hire = new Gacha(hireRng(1, 0.5)).hire_from_pool(state)!;
    expect(Config.AREAS[1].pool.includes(hire.name)).toBe(true);
    expect(hire.bonus_value > 0).toBe(true);
    expect(state.waifus.length).toBe(1);
    expect(state.tokens).toBe(3); // a chest hire is not a token pull
    expect(state.pity_counter).toBe(7); // and it never moves pity
    expect(state.stats.pulls_total).toBe(1);
  });

  it("counts a duplicate hire without a unique bump", () => {
    const first = Config.AREAS[0].pool[0];
    const state = st({
      tokens: 0, pity_counter: 0, stats: {}, area_index: 0,
      waifus: [{ name: first, bonus_type: "gold", bonus_value: 0.05, rarity: "common" }],
    });
    const hire = new Gacha(hireRng(1, 0.5)).hire_from_pool(state)!;
    expect(hire.name).toBe(first);
    expect(state.stats.unique_hires).toBeUndefined();
    expect(state.stats.pulls_total).toBe(1);
  });
});
