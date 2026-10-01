import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { createState, type GameState } from "../src/state";
import Stats from "../src/systems/stats";

function fresh_state(): GameState {
  const st = createState();
  st.stats = {};
  return st;
}

describe("Stats recorder: record_click", () => {
  it("bumps clicks and kills by exactly 1 on first call and to 2 on the second", () => {
    const st = fresh_state();
    Stats.record_click(st, false);
    expect(st.stats.clicks).toBe(1);
    expect(st.stats.kills).toBe(1); // one-hit model
    expect(st.stats.crits).toBeUndefined(); // non-crit must not create crits
    Stats.record_click(st, false);
    expect(st.stats.clicks).toBe(2);
    expect(st.stats.kills).toBe(2);
  });

  it("a crit click bumps clicks, kills AND crits from the single call", () => {
    const st = fresh_state();
    Stats.record_click(st, true);
    expect(st.stats.clicks).toBe(1);
    expect(st.stats.kills).toBe(1);
    expect(st.stats.crits).toBe(1);
  });

  it("is nil-safe: a state without a stats table records nothing and does not error", () => {
    expect(() => Stats.record_click({}, false)).not.toThrow();
  });
});

describe("Stats recorder: record_pull", () => {
  it("bumps pulls_total AND the named per-rarity sibling key", () => {
    const st = fresh_state();
    Stats.record_pull(st, "rare");
    expect(st.stats.pulls_total).toBe(1);
    expect(st.stats.pulls_rare).toBe(1);
    expect(st.stats.pulls_common).toBeUndefined();
    expect(st.stats.pulls_epic).toBeUndefined();
    expect(st.stats.pulls_legendary).toBeUndefined();
    Stats.record_pull(st, "rare");
    expect(st.stats.pulls_total).toBe(2);
    expect(st.stats.pulls_rare).toBe(2);
  });

  it("records every ladder rarity onto its own sibling key", () => {
    const st = fresh_state();
    for (const r of Config.WAIFU_RARITIES) {
      Stats.record_pull(st, r.key);
    }
    expect(st.stats.pulls_total).toBe(Config.WAIFU_RARITIES.length);
    for (const r of Config.WAIFU_RARITIES) {
      expect(st.stats[`pulls_${r.key}`]).toBe(1);
    }
  });

  it("an unknown rarity bumps ONLY pulls_total and writes no bogus key", () => {
    const st = fresh_state();
    st.stats.pulls_common = 3;
    Stats.record_pull(st, "bogus");
    expect(st.stats.pulls_total).toBe(1); // pulls_total still counts the pull
    expect(st.stats.pulls_common).toBe(3); // named counters untouched
    expect(st.stats.pulls_bogus).toBeUndefined();
  });

  it("a nil rarity bumps only pulls_total", () => {
    const st = fresh_state();
    Stats.record_pull(st, null);
    expect(st.stats.pulls_total).toBe(1);
    expect(Object.keys(st.stats)).toEqual(["pulls_total"]);
  });

  it("a non-string rarity bumps only pulls_total (no concat, no bogus key)", () => {
    const st = fresh_state();
    expect(() => Stats.record_pull(st, 42)).not.toThrow();
    expect(st.stats.pulls_total).toBe(1);
    expect(Object.keys(st.stats)).toEqual(["pulls_total"]);
  });

  it("is nil-safe on a state without a stats table", () => {
    expect(() => Stats.record_pull({}, "rare")).not.toThrow();
  });
});

describe("Stats recorder: record_upgrade / record_rebirth", () => {
  it("record_upgrade bumps upgrades_bought by exactly 1, then to 2", () => {
    const st = fresh_state();
    Stats.record_upgrade(st);
    expect(st.stats.upgrades_bought).toBe(1);
    Stats.record_upgrade(st);
    expect(st.stats.upgrades_bought).toBe(2);
  });

  it("record_rebirth bumps rebirths by exactly 1, then to 2", () => {
    const st = fresh_state();
    Stats.record_rebirth(st);
    expect(st.stats.rebirths).toBe(1);
    Stats.record_rebirth(st);
    expect(st.stats.rebirths).toBe(2);
  });

  it("both are nil-safe on a state without a stats table", () => {
    expect(() => Stats.record_upgrade({})).not.toThrow();
    expect(() => Stats.record_rebirth({})).not.toThrow();
  });
});

describe("Stats recorder: tick (caller-fed play_time)", () => {
  it("accumulates play_time by the dt argument (two 0.5 steps)", () => {
    const st = fresh_state();
    Stats.tick(st, 0.5);
    Stats.tick(st, 0.5);
    expect(Math.abs(st.stats.play_time - 1.0) < 1e-9).toBe(true);
  });

  it("dt == 0 is a no-op on an existing play_time", () => {
    const st = fresh_state();
    Stats.tick(st, 0.5);
    const before = st.stats.play_time;
    Stats.tick(st, 0);
    expect(st.stats.play_time).toBe(before); // zero dt must not move play_time
  });

  it("a nil dt is tolerated and records nothing", () => {
    const st = fresh_state();
    expect(() => Stats.tick(st, null)).not.toThrow();
    expect(st.stats.play_time).toBeUndefined();
  });

  it("is nil-safe on a state without a stats table", () => {
    expect(() => Stats.tick({}, 0.1)).not.toThrow();
  });
});

describe("Stats module purity", () => {
  it("source contains no engine, OS, or RNG access", () => {
    // House-style source scan: the recorder is pure data arithmetic.
    const body = readFileSync("src/systems/stats.ts", "utf8");
    for (const token of ["love.", "os.", "math.random"]) {
      expect(body.includes(token), `found '${token}' in body`).toBe(false);
    }
  });

  it("the per-rarity vocabulary mirrors Config.WAIFU_RARITIES exactly (drift guard)", () => {
    let n = 0;
    for (const r of Config.WAIFU_RARITIES) {
      n += 1;
      expect(Stats.RARITY_KEYS).toBeDefined();
      expect(Stats.RARITY_KEYS[r.key]).toBe(true);
    }
    let seen = 0;
    for (const k of Object.keys(Stats.RARITY_KEYS)) {
      seen += 1;
      expect(Config.WAIFU_RARITY_BY_KEY[k]).toBeDefined();
    }
    expect(seen).toBe(n); // vocabulary cardinality must match the ladder
  });
});

describe("Stats play-time lane (bounded deterministic model)", () => {
  it("accumulates 10 x 0.1 steps to ~1.0", () => {
    const st = fresh_state();
    for (let i = 0; i < 10; i++) {
      Stats.tick(st, 0.1);
    }
    expect(Math.abs(st.stats.play_time - 1.0) < 1e-9).toBe(true);
  });

  it("the accumulated value stays a plain number (flat string->number compatible)", () => {
    const st = fresh_state();
    for (let i = 0; i < 4; i++) {
      Stats.tick(st, 0.25);
    }
    expect(typeof st.stats.play_time).toBe("number");
  });
});
