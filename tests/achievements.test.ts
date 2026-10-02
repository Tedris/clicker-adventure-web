import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { createState, type GameState } from "../src/state";
import Achievements from "../src/systems/achievements";
import Prestige from "../src/systems/prestige";

const T0 = 1700000000;

// Locate an ID inside an evaluate() result; undefined means absent.
function find_id(list: string[], id: string): string | undefined {
  return list.find((v) => v === id);
}

// Shallow copy so a "reload" simulation hands evaluate a genuinely NEW table.
function copy_map<T>(src: Record<string, T>): Record<string, T> {
  return { ...src };
}

function count_keys(src: Record<string, unknown> | undefined): number {
  return Object.keys(src ?? {}).length;
}

// A state carrying only the two maps the evaluator reads.
function stateWith(
  stats: Record<string, number>,
  achievements: Record<string, true> = {},
): GameState {
  const st = createState();
  st.stats = stats;
  st.achievements = achievements;
  return st;
}

describe("Achievements:evaluate — detection", () => {
  it("a single metric at its goal returns exactly that ID", () => {
    expect(Achievements.evaluate(stateWith({ clicks: 1 }))).toEqual(["first_click"]);
  });

  it("one step below the goal returns nothing", () => {
    expect(Achievements.evaluate(stateWith({ clicks: 0 }))).toEqual([]);
    expect(Achievements.evaluate(stateWith({ kills: 99 }))).toEqual([]);
  });

  it("several satisfied metrics return their IDs in Config.ACHIEVEMENTS order", () => {
    const st = stateWith({ clicks: 1, kills: 100, crits: 1 });
    expect(Achievements.evaluate(st)).toEqual(["first_click", "hundred_kills", "first_crit"]);
  });

  it("two calls with no mark in between return the SAME ordered array", () => {
    const st = stateWith({ clicks: 1, kills: 100 });
    const first = Achievements.evaluate(st);
    const second = Achievements.evaluate(st);
    expect(second).toEqual(first);
    expect(second).toEqual(["first_click", "hundred_kills"]);
  });

  it("evaluate then mark_unlocked then evaluate returns nothing", () => {
    const st = stateWith({ clicks: 1, kills: 100 });
    const newly = Achievements.evaluate(st);
    expect(newly).toEqual(["first_click", "hundred_kills"]);
    Achievements.mark_unlocked(st, newly);
    expect(Achievements.evaluate(st)).toEqual([]);
  });

  it("a nil state returns an empty array without erroring", () => {
    expect(Achievements.evaluate(null)).toEqual([]);
  });

  it("an empty state table and empty stat/achievement maps evaluate to nothing", () => {
    expect(Achievements.evaluate(createState())).toEqual([]);
    expect(Achievements.evaluate(stateWith({}))).toEqual([]);
    expect(Achievements.evaluate(stateWith({ kills: 0 }))).toEqual([]);
  });

  it("a fresh createState carries an empty achievements map and evaluates to nothing", () => {
    const st = createState();
    expect(st.achievements).toBeDefined();
    expect(Object.keys(st.achievements)).toHaveLength(0);
    expect(Achievements.evaluate(st)).toEqual([]);
  });

  it("evaluate mutates nothing — not stats, not achievements, not the economy", () => {
    const st = stateWith({ clicks: 1, kills: 100 });
    st.gold = 111.5;
    st.exp = 22;
    st.tokens = 3;
    Achievements.evaluate(st);
    expect(st.achievements).toEqual({});
    expect(st.stats.clicks).toBe(1);
    expect(st.stats.kills).toBe(100);
    expect(st.gold).toBe(111.5);
    expect(st.exp).toBe(22);
    expect(st.tokens).toBe(3);
  });

  it("is_unlocked reads the persisted set only, never the counters", () => {
    const st = stateWith({ clicks: 9 }, { first_click: true });
    expect(Achievements.is_unlocked(st, "first_click")).toBe(true);
    // A counter past goal but unmarked is NOT unlocked.
    expect(Achievements.is_unlocked(st, "hundred_kills")).toBeFalsy();
    expect(Achievements.is_unlocked(null, "first_click")).toBeFalsy();
    expect(Achievements.is_unlocked(createState(), "first_click")).toBeFalsy();
  });
});

describe("Achievements — idempotence rides the persisted set", () => {
  it("an already-true ID is not re-reported even when its metric is far past goal", () => {
    const st = stateWith({ clicks: 5000 }, { first_click: true });
    expect(Achievements.evaluate(st)).toEqual([]);
  });

  it("dedup keys on the ID, not insertion order or the goal", () => {
    const a = createState();
    a.achievements.first_click = true;
    a.achievements.hundred_kills = true;
    const b = createState();
    b.achievements.hundred_kills = true;
    b.achievements.first_click = true;
    expect(Achievements.evaluate(a)).toEqual([]);
    expect(Achievements.evaluate(b)).toEqual([]);
    expect(count_keys(a.achievements)).toBe(2);
    expect(count_keys(b.achievements)).toBe(2);
  });

  it("after one mark, a second evaluate AND a simulated reload stay silent", () => {
    const st = createState();
    st.stats.clicks = 250;
    st.stats.kills = 250;
    st.stats.crits = 1;
    Achievements.mark_unlocked(st, Achievements.evaluate(st));
    expect(Achievements.evaluate(st)).toEqual([]);
    // "Reload": a brand-new state object carrying the same persisted set.
    const reloaded = createState();
    reloaded.stats = copy_map(st.stats);
    reloaded.achievements = copy_map(st.achievements);
    expect(count_keys(reloaded.achievements)).toBe(3);
    expect(Achievements.evaluate(reloaded)).toEqual([]);
  });

  it("the module carries no cache fields that could break idempotence", () => {
    const holder = Achievements as unknown as Record<string, unknown>;
    expect(holder._last_result).toBeUndefined();
    expect(holder._cache).toBeUndefined();
    expect(holder._last_snapshot).toBeUndefined();
  });

  it("mark_unlocked is the sole writer: it sets exactly the IDs given, all true", () => {
    const st = createState();
    Achievements.mark_unlocked(st, ["first_click", "epic_7"]);
    expect(st.achievements.first_click).toBe(true);
    expect(st.achievements.epic_7).toBe(true);
    expect(st.achievements.thousand_kills).toBeUndefined();
    expect(count_keys(st.achievements)).toBe(2);
  });

  it("mark_unlocked tolerates a nil state and creates the map on a bare one", () => {
    Achievements.mark_unlocked(null, ["first_click"]); // must not error
    const st = {} as GameState;
    Achievements.mark_unlocked(st, ["first_pull"]);
    expect(st.achievements!.first_pull).toBe(true);
  });
});

describe("Achievements:get_progress", () => {
  it("a known ID returns {id, label, metric, current, goal} with the raw counter", () => {
    const p = Achievements.get_progress(stateWith({ kills: 250 }), "hundred_kills")!;
    expect(p).not.toBeNull();
    expect(p.id).toBe("hundred_kills");
    expect(p.label).toBe("Performance Review"); // opaque curated title
    expect(p.metric).toBe("kills");
    expect(p.current).toBe(250); // raw counter, uncapped, unformatted
    expect(p.goal).toBe(100);
  });

  it("current is goal-1 / goal / goal+1 verbatim across the boundary", () => {
    const probe = (v: number) =>
      Achievements.get_progress(stateWith({ kills: v }), "hundred_kills")!.current;
    expect(probe(99)).toBe(99);
    expect(probe(100)).toBe(100);
    expect(probe(101)).toBe(101);
  });

  it("a missing metric key yields current 0 — never nil, never an error", () => {
    const p = Achievements.get_progress({ achievements: {} } as GameState, "ten_k_kills")!;
    expect(p).not.toBeNull();
    expect(p.current).toBe(0);
    expect(p.goal).toBe(10000);
  });

  it("a nil state also gets a row with current 0 rather than a crash", () => {
    const p = Achievements.get_progress(null, "first_click")!;
    expect(p).not.toBeNull();
    expect(p.current).toBe(0);
  });

  it("play_time keeps its raw float precision — no rounding at the boundary", () => {
    const p = Achievements.get_progress(stateWith({ play_time: 3599.999 }), "playtime_3600")!;
    expect(p.current).toBe(3599.999);
  });

  it("an unknown ID returns nil rather than a fabricated row", () => {
    expect(Achievements.get_progress(stateWith({}), "no_such_badge")).toBeNull();
  });

  it("adjacent IDs on one metric stay distinct rows — never collapsed", () => {
    const st = stateWith({ rebirths: 1 });
    const one = Achievements.get_progress(st, "rebirth_1")!;
    const two = Achievements.get_progress(st, "rebirth_2")!;
    expect(one.id).toBe("rebirth_1");
    expect(two.id).toBe("rebirth_2");
    expect(one.goal).toBe(1);
    expect(two.goal).toBe(2);
    expect(one.current).toBe(1);
    expect(two.current).toBe(1); // shared metric shows the shared raw current
  });

  it("progress_all returns one row per Config.ACHIEVEMENTS entry in order", () => {
    const rows = Achievements.progress_all(stateWith({ clicks: 7 }));
    expect(rows).toHaveLength(Config.ACHIEVEMENTS.length);
    Config.ACHIEVEMENTS.forEach((def, i) => {
      expect(rows[i].id).toBe(def.id); // row order must mirror config order
      expect(rows[i].goal).toBe(def.goal);
    });
    expect(rows[0].current).toBe(7); // the first row tracks the live counter
  });

  it("hire_everyone unlocks once every hire name is on the books", () => {
    const goal = Config.ACHIEVEMENTS.find((d) => d.id === "hire_everyone")!.goal;
    expect(Achievements.evaluate(stateWith({ unique_hires: goal - 1 }))).not.toContain("hire_everyone");
    expect(Achievements.evaluate(stateWith({ unique_hires: goal }))).toContain("hire_everyone");
  });

  it("all_definitions hands out the shared config roster unchanged", () => {
    expect(Achievements.all_definitions()).toBe(Config.ACHIEVEMENTS);
  });
});

describe("Achievements module purity", () => {
  it("the shipped source contains no engine, OS, or RNG access", () => {
    const body = readFileSync("src/systems/achievements.ts", "utf8");
    for (const token of ["love.", "os.", "math.random"]) {
      expect(body.includes(token), `found '${token}' in body`).toBe(false);
    }
  });

  it("the shipped source reads its definitions from the config layer", () => {
    const body = readFileSync("src/systems/achievements.ts", "utf8");
    expect(body.includes('from "../config"')).toBe(true);
  });
});

describe("Achievements:evaluate — boundary battery", () => {
  function isolate(target: (typeof Config.ACHIEVEMENTS)[number]): GameState {
    const st = createState();
    st.stats = {};
    st.achievements = {};
    for (const other of Config.ACHIEVEMENTS) {
      if (other.metric === target.metric && other.id !== target.id) {
        st.achievements[other.id] = true;
      }
    }
    return st;
  }

  // play_time is hand-set at its float endpoints rather than accumulated,
  // and compared numerically with no epsilon.
  const FLOAT_ENDPOINTS: Record<string, { below: number; above: number }> = {
    playtime_3600: { below: 3599.999, above: 3600.001 },
  };

  for (const def of Config.ACHIEVEMENTS) {
    it(`${def.id} (${def.metric}/${def.goal}) flips only at its own goal`, () => {
      const ends = FLOAT_ENDPOINTS[def.id];
      const below = ends ? ends.below : def.goal - 1;
      const above = ends ? ends.above : def.goal + 1;

      let st = isolate(def);
      st.stats[def.metric] = below;
      expect(find_id(Achievements.evaluate(st), def.id)).toBeUndefined();

      st = isolate(def);
      st.stats[def.metric] = def.goal;
      expect(Achievements.evaluate(st)).toEqual([def.id]);

      Achievements.mark_unlocked(st, [def.id]);
      st.stats[def.metric] = above;
      expect(Achievements.evaluate(st)).toEqual([]);
    });
  }
});

describe("Achievements — adjacent values on a shared metric stay separate", () => {
  it("the kills ladder crosses 100/1000/10000 one unique ID at a time", () => {
    const st = createState();
    st.stats = { kills: 99 };
    st.achievements = {};
    expect(Achievements.evaluate(st)).toEqual([]);
    st.stats.kills = 100;
    expect(Achievements.evaluate(st)).toEqual(["hundred_kills"]);
    Achievements.mark_unlocked(st, ["hundred_kills"]);
    st.stats.kills = 999;
    expect(Achievements.evaluate(st)).toEqual([]); // still hundred_kills territory
    st.stats.kills = 1000;
    expect(Achievements.evaluate(st)).toEqual(["thousand_kills"]);
    Achievements.mark_unlocked(st, ["thousand_kills"]);
    st.stats.kills = 9999;
    expect(Achievements.evaluate(st)).toEqual([]);
    st.stats.kills = 10000;
    expect(Achievements.evaluate(st)).toEqual(["ten_k_kills"]);
    Achievements.mark_unlocked(st, ["ten_k_kills"]);
    expect(Achievements.evaluate(st)).toEqual([]);
  });

  it("rebirth_1 and rebirth_2 are distinct rows on the shared rebirths key", () => {
    const st = createState();
    st.stats = { rebirths: 1 };
    st.achievements = {};
    expect(Achievements.evaluate(st)).toEqual(["rebirth_1"]);
    Achievements.mark_unlocked(st, ["rebirth_1"]);
    st.stats.rebirths = 2;
    expect(Achievements.evaluate(st)).toEqual(["rebirth_2"]);
    Achievements.mark_unlocked(st, ["rebirth_2"]);
    expect(Achievements.evaluate(st)).toEqual([]);
  });

  it("the shared clicks/kills payment site still yields independent unique IDs", () => {
    // A one-hit kill bumps BOTH counters; the evaluator reads each key
    // independently, so both badges appear as two separate IDs in config
    // order — never one collapsed "mystery" badge.
    const st = createState();
    st.stats = { clicks: 100, kills: 100 };
    st.achievements = {};
    const newly = Achievements.evaluate(st);
    expect(newly).toEqual(["first_click", "hundred_kills"]);
    expect(newly[0]).not.toBe(newly[1]); // adjacent badges keep distinct IDs
    Achievements.mark_unlocked(st, newly);
    st.stats.clicks = 101;
    st.stats.kills = 99;
    expect(Achievements.evaluate(st)).toEqual([]);
  });
});

describe("Achievements — ordering determinism", () => {
  it("progress_all is stable call-to-call and mirrors Config index for index", () => {
    const st = stateWith({ kills: 150 });
    const a = Achievements.progress_all(st);
    const b = Achievements.progress_all(st);
    expect(a).toHaveLength(Config.ACHIEVEMENTS.length);
    Config.ACHIEVEMENTS.forEach((def, i) => {
      expect(a[i].id).toBe(def.id);
      expect(b[i].id).toBe(def.id);
      expect(a[i].current).toBe(b[i].current);
      expect(a[i].goal).toBe(b[i].goal);
    });
  });

  it("simultaneously-satisfied badges at non-adjacent positions return in config order", () => {
    // first_click (pos 1), first_crit (pos 5), upgrades_500 (pos 12).
    const st = stateWith({ clicks: 1, crits: 1, upgrades_bought: 500 });
      expect(Achievements.evaluate(st)).toEqual(["first_click", "first_crit", "upgrades_500"]);
  });
});

describe("Achievements — economy immutability", () => {
  function full_house(): GameState {
    const st = createState();
    st.gold = 12345.5;
    st.exp = 999;
    st.tokens = 55;
    st.pity_counter = 3;
    // One state satisfying every curated definition simultaneously:
    st.stats = {
      clicks: 1, kills: 10000, crits: 5000,
      pulls_total: 1, pulls_rare: 23, pulls_epic: 7, pulls_legendary: 1,
      upgrades_bought: 500, rebirths: 2, play_time: 3600, unique_hires: 15,
    };
    return st;
  }

  function summed_rewards(): { sum_gold: number; sum_tokens: number } {
    let sum_gold = 0;
    let sum_tokens = 0;
    for (const def of Config.ACHIEVEMENTS) {
      const amounts = Config.ACHV_REWARDS[def.tier as keyof typeof Config.ACHV_REWARDS];
      sum_gold += amounts.gold;
      sum_tokens += amounts.tokens;
    }
    return { sum_gold, sum_tokens };
  }

  it("a full 15-badge evaluate + mark cycle pays each badge once, then stays silent", () => {
    const { sum_gold, sum_tokens } = summed_rewards();
    const st = full_house();
    const gold0 = st.gold;
    const exp0 = st.exp;
    const tok0 = st.tokens;
    const newly = Achievements.evaluate(st);
    expect(newly).toHaveLength(Config.ACHIEVEMENTS.length); // every curated badge triggers at once
    expect(newly[0]).toBe(Config.ACHIEVEMENTS[0].id);
    expect(newly[newly.length - 1]).toBe(Config.ACHIEVEMENTS[Config.ACHIEVEMENTS.length - 1].id);
    Achievements.mark_unlocked(st, newly);
    expect(count_keys(st.achievements)).toBe(Config.ACHIEVEMENTS.length);
    expect(Achievements.evaluate(st)).toEqual([]); // silent once marked
    expect(st.gold).toBe(gold0 + sum_gold); // one summed credit at the flip
    expect(st.tokens).toBe(tok0 + sum_tokens);
    expect(st.exp).toBe(exp0); // exp byte-identical — badge rewards carry no EXP
    // Repeated cycles add nothing further: the flip-guard keeps its promise.
    Achievements.mark_unlocked(st, Achievements.evaluate(st));
    expect(st.gold).toBe(gold0 + sum_gold);
    expect(st.tokens).toBe(tok0 + sum_tokens);
    expect(st.exp).toBe(exp0);
  });

  it("repeated cycles after a real rebirth cannot drift the post-reset economy", () => {
    const { sum_gold, sum_tokens } = summed_rewards();
    const st = full_house();
    st.prestige_points = 0;
    st.prestige_rebirths = 0;
    st.prestige_gold_since_rebirth = 100 * Config.PRESTIGE_GOLD_BASE;
    const ups = {
      upgrades: { ...st.upgrades },
      set_state() {
        this.upgrades = {};
      },
    };
    const ok = Prestige.rebirth(st, ups);
    expect(ok[0]).toBe(true); // the rebirth path runs for real
    // Snapshot AFTER the legitimate reset-set wipe. The first cycle pays the
    // summed badge amounts once through the prestige multiplier (10 points
    // -> mult 1.1, derived at the site); every cycle after must be silent.
    const mult = Prestige.gold_multiplier(st);
    const gold0 = st.gold;
    const exp0 = st.exp;
    const tok0 = st.tokens;
    Achievements.mark_unlocked(st, Achievements.evaluate(st));
    expect(st.gold).toBe(gold0 + sum_gold * mult); // one credit via multiplier
    expect(st.tokens).toBe(tok0 + sum_tokens); // tokens land raw
    expect(st.exp).toBe(exp0);
    for (let i = 0; i < 3; i++) {
      Achievements.mark_unlocked(st, Achievements.evaluate(st));
    }
    expect(st.gold).toBe(gold0 + sum_gold * mult);
    expect(st.exp).toBe(exp0);
    expect(st.tokens).toBe(tok0 + sum_tokens);
  });
});

describe("Achievements — rebirth retention", () => {
  it("a real Prestige:rebirth preserves the persisted set and evaluate does not re-report", () => {
    const st = createState();
    st.prestige_gold_since_rebirth = 100 * Config.PRESTIGE_GOLD_BASE; // >= 1 genuine point
    st.stats = { clicks: 250, kills: 250, crits: 25 };
    st.achievements = { first_click: true, hundred_kills: true };
    const ups = { upgrades: { ...st.upgrades }, set_state() { this.upgrades = {}; } };

    const [ok] = Prestige.rebirth(st, ups);
    expect(ok).toBe(true); // enough since-rebirth gold for a genuine rebirth

    expect(count_keys(st.achievements)).toBe(2); // KEEP retains the map verbatim
    expect(st.achievements.first_click).toBe(true);
    expect(st.achievements.hundred_kills).toBe(true);

    const newly = Achievements.evaluate(st);
    expect(find_id(newly, "first_click")).toBeUndefined(); // no re-report
    expect(find_id(newly, "hundred_kills")).toBeUndefined();
    // Fresh badges keep unlocking after the rebirth too (evaluator still runs).
    expect(find_id(newly, "first_crit")).toBeDefined();
  });
});

describe("Achievements:count_unlocked — render-time count", () => {
  it("nil state and empty sets count as zero without erroring", () => {
    expect(Achievements.count_unlocked(null)).toBe(0);
    expect(Achievements.count_unlocked(stateWith({}))).toBe(0);
    expect(Achievements.count_unlocked(createState())).toBe(0);
  });

  it("k marked roster ids count exactly k", () => {
    const st = createState();
    st.achievements.first_click = true;
    st.achievements.hundred_kills = true;
    expect(Achievements.count_unlocked(st)).toBe(2);
    Achievements.mark_unlocked(st, ["first_crit"]);
    expect(Achievements.count_unlocked(st)).toBe(3); // a fresh mark raises it by one
  });

  it("the whole roster counts to the derived denominator #Config.ACHIEVEMENTS", () => {
    const st = createState();
    st.achievements = {};
    Achievements.mark_unlocked(st, Config.ACHIEVEMENTS.map((def) => def.id));
    expect(Achievements.count_unlocked(st)).toBe(Config.ACHIEVEMENTS.length);
  });

  it("unknown extra ids never inflate the count past #Config.ACHIEVEMENTS", () => {
    // mark_unlocked marks unknown ids true and pays nothing; a plain
    // key-count over this set would overshoot, the roster-order count must
    // not.
    const st = createState();
    st.achievements = { first_click: true, no_such_badge: true };
    expect(Achievements.count_unlocked(st)).toBe(1);
    const full = createState();
    full.achievements = {};
    for (const def of Config.ACHIEVEMENTS) full.achievements[def.id] = true;
    full.achievements.extra_one = true;
    full.achievements.extra_two = true;
    expect(Achievements.count_unlocked(full)).toBe(Config.ACHIEVEMENTS.length);
    expect(count_keys(full.achievements) > Achievements.count_unlocked(full)).toBe(true);
  });
});

// The false->true flip inside mark_unlocked is the single payment trigger.
// One badge pays its tier amounts exactly once: gold rides the prestige
// multiplier derived at the payment site, tokens stay raw, and lifetime
// totals plus the since-rebirth counter move exactly once.
describe("badge payout — exactly once on flip", () => {
  // Capture the currency-side counters before a mark so every claim is a
  // DELTA claim — immune to whatever createState seeds.
  function snapshot(st: GameState) {
    return {
      gold: st.gold ?? 0,
      tokens: st.tokens ?? 0,
      tge: st.total_gold_earned ?? 0,
      tte: st.total_tokens_earned ?? 0,
      since: st.prestige_gold_since_rebirth ?? 0,
      bbrg: st.stats?.badge_reward_gold ?? 0,
      bbrt: st.stats?.badge_reward_tokens ?? 0,
    };
  }

  it("credits bronze amounts once at zero prestige points, second mark is silent", () => {
    const st = createState();
    st.stats.clicks = 1;
    const b = snapshot(st);
    // Read the swept ladder from config (single source of numbers).
    const bg = Config.ACHV_REWARDS.bronze.gold;
    const bt = Config.ACHV_REWARDS.bronze.tokens;

    Achievements.mark_unlocked(st, ["first_click"]);
    expect(st.gold - b.gold).toBe(bg); // bronze gold lands exactly once
    expect(st.tokens - b.tokens).toBe(bt); // bronze tokens land unmultiplied
    expect(st.total_gold_earned - b.tge).toBe(bg); // lifetime gold: one credit
    expect(st.total_tokens_earned - b.tte).toBe(bt); // lifetime tokens: one credit
    // The prestige counter rides the same single credit.
    expect(st.prestige_gold_since_rebirth - b.since).toBe(bg);
    expect(st.achievements.first_click).toBe(true); // the flip still marks the id
    expect(st.stats.badge_reward_gold - b.bbrg).toBe(bg); // accumulates
    expect(st.stats.badge_reward_tokens - b.bbrt).toBe(bt); // accumulates

    Achievements.mark_unlocked(st, ["first_click"]);
    expect(st.gold - b.gold).toBe(bg); // second mark adds no gold
    expect(st.tokens - b.tokens).toBe(bt); // second mark adds no tokens
    expect(st.total_gold_earned - b.tge).toBe(bg); // totals stay at one credit
    expect(st.total_tokens_earned - b.tte).toBe(bt);
    expect(st.prestige_gold_since_rebirth - b.since).toBe(bg);
  });

  it("multiplies gold only at the payment site — tokens stay raw", () => {
    const st = createState();
    st.prestige_points = 10; // mult = 1.1 != 1, gold/token split is visible
    st.stats.clicks = 1;
    const mult = Prestige.gold_multiplier(st);
    const b = snapshot(st);

    Achievements.mark_unlocked(st, ["first_click"]);
    const exp_gold = Config.ACHV_REWARDS.bronze.gold * mult;
    expect(st.gold - b.gold).toBe(exp_gold); // gold crosses the prestige multiplier
    expect(st.tokens - b.tokens).toBe(Config.ACHV_REWARDS.bronze.tokens); // NOT multiplied
    expect(st.total_gold_earned - b.tge).toBe(exp_gold);
    expect(st.prestige_gold_since_rebirth - b.since).toBe(exp_gold);
    expect(st.total_tokens_earned - b.tte).toBe(Config.ACHV_REWARDS.bronze.tokens);
    expect(st.stats.badge_reward_gold - b.bbrg).toBe(exp_gold); // post-multiplier
    expect(st.stats.badge_reward_tokens - b.bbrt).toBe(Config.ACHV_REWARDS.bronze.tokens); // raw
  });

  it("three simultaneous badges land as ONE summed credit in config order", () => {
    const st = createState();
    st.stats.clicks = 1;
    st.stats.kills = 10000;
    // Sibling isolation: pre-marking the shared-kills middle tier keeps the
    // expected sum at bronze+silver+gold.
    st.achievements.thousand_kills = true;
    const newly = Achievements.evaluate(st);
    expect(newly).toEqual(["first_click", "hundred_kills", "ten_k_kills"]);

    const gold0 = st.gold;
    const tok0 = st.tokens;
    const tge0 = st.total_gold_earned;
    const tte0 = st.total_tokens_earned;
    Achievements.mark_unlocked(st, newly);
    // bronze + silver + gold summed into ONE credit at zero prestige points.
    const r = Config.ACHV_REWARDS;
    const sum_gold = r.bronze.gold + r.silver.gold + r.gold.gold;
    const sum_tokens = r.bronze.tokens + r.silver.tokens + r.gold.tokens;
    expect(st.gold - gold0).toBe(sum_gold);
    expect(st.tokens - tok0).toBe(sum_tokens);
    // Lifetime gold moves exactly once for the batch (1:1 invariant).
    expect(st.total_gold_earned - tge0).toBe(sum_gold);
    expect(st.total_tokens_earned - tte0).toBe(sum_tokens);
    expect(st.gold - gold0).toBe(st.total_gold_earned - tge0); // session == lifetime delta
  });

  it("a copied persisted map keeps evaluate and the credit silent (reload)", () => {
    const st = createState();
    st.stats.clicks = 1;
    const newly = Achievements.evaluate(st);
    Achievements.mark_unlocked(st, newly);

    const reloaded = createState();
    reloaded.stats = copy_map(st.stats);
    reloaded.achievements = copy_map(st.achievements);
    expect(Achievements.evaluate(reloaded)).toEqual([]); // reload never re-reports

    const gold0 = reloaded.gold;
    const tok0 = reloaded.tokens;
    const tge0 = reloaded.total_gold_earned;
    Achievements.mark_unlocked(reloaded, newly);
    expect(reloaded.gold - gold0).toBe(0); // no credit on the copied set
    expect(reloaded.tokens - tok0).toBe(0);
    expect(reloaded.total_gold_earned - tge0).toBe(0);
  });

  it("a real rebirth keeps paid badges and a second mark adds nothing", () => {
    const st = createState();
    st.stats.clicks = 1;
    Achievements.mark_unlocked(st, ["first_click"]);
    // Pre-marking rebirth_1 keeps this leg measuring the re-pay contract,
    // not the fresh rebirth_1 unlock the success tail would otherwise pay.
    st.achievements.rebirth_1 = true;
    st.prestige_gold_since_rebirth = 100 * Config.PRESTIGE_GOLD_BASE;
    const ups = { upgrades: { ...st.upgrades }, set_state() { this.upgrades = {}; } };

    const [ok] = Prestige.rebirth(st, ups);
    expect(ok).toBe(true);
    expect(st.achievements.first_click).toBe(true); // KEEP preserves the paid badge
    expect(Achievements.evaluate(st)).toEqual([]); // paid badges never re-report

    // Assert the TOTALS, not gold: rebirth legitimately zeroes gold while
    // KEEP preserves the lifetime counters.
    const tge0 = st.total_gold_earned;
    const tte0 = st.total_tokens_earned;
    Achievements.mark_unlocked(st, ["first_click"]);
    expect(st.total_gold_earned - tge0).toBe(0); // no re-pay after rebirth
    expect(st.total_tokens_earned - tte0).toBe(0);
  });

  it("a fresh state evaluates empty and an empty batch changes nothing", () => {
    const st = createState();
    expect(Achievements.evaluate(st)).toEqual([]);
    const gold0 = st.gold;
    const tok0 = st.tokens;
    const tge0 = st.total_gold_earned;
    const tte0 = st.total_tokens_earned;
    Achievements.mark_unlocked(st, []);
    expect(st.gold - gold0).toBe(0); // nil-safe writes keep a bare state at its seed
    expect(st.tokens - tok0).toBe(0);
    expect(st.total_gold_earned - tge0).toBe(0);
    expect(st.total_tokens_earned - tte0).toBe(0);
    expect(st.achievements).toEqual({});
  });
});

