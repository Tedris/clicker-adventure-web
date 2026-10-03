// tests/gacha.test.ts
// Vitest tests for the guaranteed-hatch summon system: every paid pull
// yields a hire, luck tilts the rarity walk, commons come from the current
// area and epics/legendaries from the shared pool.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { Gacha, type RandomFn } from "../src/systems/gacha";
import type { GameState } from "../src/state";

// Minimal state fixtures.
function st(props: Record<string, unknown>): GameState {
  return props as unknown as GameState;
}

// Success consumes the RNG in order: rarity walk (argless roll), hire pick
// (indexed call). The stub feeds the roll positionally and pins indexed calls
// to slot 1 so hire picks stay deterministic.
function stubRandom(rarityRoll: number): RandomFn {
  return (max?: number) => (max === undefined ? rarityRoll : 1);
}

function freshState(props: Record<string, unknown> = {}): GameState {
  return st({ tokens: 1000, waifus: [], stats: {}, ...props });
}

describe("Gacha System", () => {
  it("initializes and exposes the roll/pool seams", () => {
    const gacha = new Gacha();
    expect(gacha).toBeTruthy();
    expect(typeof gacha.roll_rarity().key).toBe("string");
    expect(gacha.get_random_waifu()).toBeTruthy();
  });

  it("returns nil when tokens are insufficient", () => {
    const state = st({ tokens: Config.PULL_COST - 1, waifus: [] });
    expect(new Gacha().pull(state)).toBeNull();
    expect(state.tokens).toBe(Config.PULL_COST - 1);
  });

  it("returns nil when the tokens field is missing", () => {
    expect(new Gacha().pull(st({ waifus: [] }))).toBeNull();
  });

  it("raises on a missing state table", () => {
    expect(() => new Gacha().pull(undefined as unknown as GameState)).toThrow(
      "Gacha:pull requires state table",
    );
  });

  it("guarantees a hire on every paid pull", () => {
    // Even a roll that would miss the old drop gate still summons: the
    // guarantee moved from pity to the hatch itself.
    const state = freshState();
    const result = new Gacha(stubRandom(0.999)).pull(state)!;
    expect(result.success).toBe(true);
    expect(result.waifu!.name).toBeTruthy();
    expect(state.tokens).toBe(1000 - Config.PULL_COST);
    expect(state.stats.pulls_total).toBe(1);
  });

  it("creates the waifu list when the state has none", () => {
    const state = st({ tokens: Config.PULL_COST, stats: {} });
    const result = new Gacha(stubRandom(0.5)).pull(state)!;
    expect(result.success).toBe(true);
    expect(state.waifus.length).toBe(1);
  });

  it("pull produces an independent instance: mutating it never infects Config.WAIFU_POOL", () => {
    const result = new Gacha(stubRandom(0.5)).pull(freshState())!;
    result.waifu!.bonus_value = 999;
    result.waifu!.name = "Not Karen";
    expect(Config.WAIFU_POOL[0].bonus_value).toBe(0.10);
    expect(Config.WAIFU_POOL[0].name).toBe("Karen the Accountant");
  });
});

describe("Rarity walk", () => {
  it("maps cumulative weight bands onto the ladder keys", () => {
    const cases: [number, string][] = [
      [0.3, "common"], [0.699, "common"],
      [0.7, "rare"], [0.91, "rare"],
      [0.92, "epic"], [0.98, "epic"],
      [0.99, "legendary"],
    ];
    for (const [roll, key] of cases) {
      expect(new Gacha(() => roll).roll_rarity().key).toBe(key);
    }
  });

  it("luck squeezes the common band so the same roll lands higher", () => {
    // Same 0.5 roll: common at luck 1, rare once the 3.75x buff stack is on.
    expect(new Gacha(() => 0.5).roll_rarity(1).key).toBe("common");
    expect(new Gacha(() => 0.5).roll_rarity(3.75).key).toBe("rare");
  });

  it("rebirth buffs lift real pulls toward the top tiers", () => {
    const plain = new Gacha(stubRandom(0.5)).pull(freshState())!;
    expect(plain.waifu!.rarity).toBe("common");
    const buffed = new Gacha(stubRandom(0.5)).pull(
      freshState({ prestige_rebirths: 9 }),
    )!;
    expect(buffed.waifu!.rarity).toBe("rare");
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
      const result = new Gacha(stubRandom(roll)).pull(freshState())!;
      expect(result.waifu!.bonus_value).toBe(expected);
    }
  });

  it("every success carries a valid rarity key, even under unstubbed RNG", () => {
    for (let i = 0; i < 30; i++) {
      const result = new Gacha().pull(freshState())!;
      expect(Config.WAIFU_RARITY_BY_KEY[result.waifu!.rarity]).toBeTruthy();
      expect(result.waifu!.name).toBeTruthy();
    }
  });
});

describe("Per-area hire pools", () => {
  it("commons and rares come from the CURRENT area's own pool", () => {
    for (const area of [0, 1, 2]) {
      const result = new Gacha(stubRandom(0.5)).pull(freshState({ area_index: area }))!;
      expect(Config.AREAS[area].pool.includes(result.waifu!.name)).toBe(true);
    }
  });

  it("epics and legendaries come from the shared cross-area pool", () => {
    const names = Config.WAIFU_POOL.map((d) => d.name);
    for (const roll of [0.95, 0.995]) {
      const result = new Gacha(stubRandom(roll)).pull(freshState({ area_index: 3 }))!;
      expect(names).toContain(result.waifu!.name);
    }
  });

  it("counts each new hire name once in stats.unique_hires", () => {
    // Deterministic middle-slot picks repeat the same name every cycle.
    const state = freshState({ area_index: 1 });
    const gacha = new Gacha(stubRandom(0.5));
    gacha.pull(state);
    gacha.pull(state);
    expect(state.waifus.length).toBe(2);
    expect(state.stats.unique_hires).toBe(1);
    expect(state.stats.pulls_total).toBe(2);
  });
});

describe("Legacy cumulative pool (get_random_waifu)", () => {
  it("returns a waifu from the pool with the correct data shape", () => {
    const waifu = new Gacha(() => 1).get_random_waifu();
    expect(waifu).toBeTruthy();
    expect(waifu!.name).toBe("Karen the Accountant");
    expect(waifu!.bonus_type).toBe("tokens");
    expect(waifu!.bonus_value).toBe(0.10);
  });

  it("returns nil when the waifu pool is empty", () => {
    const original = Config.WAIFU_POOL;
    Config.WAIFU_POOL = [];
    expect(new Gacha().get_random_waifu()).toBeNull();
    Config.WAIFU_POOL = original;
  });

  it("area 0 keeps the legacy 3-name pool byte-for-byte", () => {
    expect(new Gacha(() => 3).get_random_waifu(0)!.name).toBe("Linda the Middle Manager");
  });

  it("later areas join their hires to the pool", () => {
    // area 1 pool: Karen, Steve, Linda, Dave, Maya, Dave, Maya (current double).
    expect(new Gacha(() => 4).get_random_waifu(1)!.name).toBe("Dave from IT");
  });
});

describe("Lifetime stats recording", () => {
  it("a forced-epic pull records pulls_total plus exactly the epic sibling key", () => {
    const state = freshState();
    const result = new Gacha(stubRandom(0.95)).pull(state)!;
    expect(result.waifu!.rarity).toBe("epic");
    expect(state.stats.pulls_total).toBe(1);
    expect(state.stats.pulls_epic).toBe(1);
    expect(state.stats.pulls_common).toBeUndefined();
  });

  it("a blocked pull (insufficient tokens) records nothing", () => {
    const state = st({ tokens: Config.PULL_COST - 1, waifus: [], stats: {} });
    expect(new Gacha().pull(state)).toBeNull();
    expect(Object.keys(state.stats).length).toBe(0);
  });

  it("a success pull on a state without a stats table does not error", () => {
    const state = st({ tokens: Config.PULL_COST, waifus: [] });
    expect(() => new Gacha(stubRandom(0.5)).pull(state)).not.toThrow();
  });
});

describe("pull_many (batch summons)", () => {
  const batchRng = stubRandom(0.5); // common band, deterministic picks

  it("runs count pulls, paying each one and feeding the mastery ladder", () => {
    const state = freshState({ tokens: Config.PULL_COST * 3 + 5 });
    const found = new Gacha(batchRng).pull_many(state, 3);
    expect(found.length).toBe(3);
    expect(state.waifus.length).toBe(3);
    expect(state.tokens).toBe(5);
    expect(state.stats.pulls_total).toBe(3);
  });

  it("stops early when tokens run out mid-batch", () => {
    const state = freshState({ tokens: Config.PULL_COST * 2 });
    const found = new Gacha(batchRng).pull_many(state, 5);
    expect(found.length).toBe(2);
    expect(state.tokens).toBe(0);
  });

  it("returns nothing when the batch cannot pay for its first pull", () => {
    const state = freshState({ tokens: Config.PULL_COST - 1 });
    expect(new Gacha(batchRng).pull_many(state, 5)).toEqual([]);
    expect(state.tokens).toBe(Config.PULL_COST - 1);
  });

  it("defaults to BATCH_PULL_COUNT pulls", () => {
    const state = freshState({ tokens: Config.PULL_COST * Config.BATCH_PULL_COUNT });
    const found = new Gacha(batchRng).pull_many(state);
    expect(found.length).toBe(Config.BATCH_PULL_COUNT);
  });
});
