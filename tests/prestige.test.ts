import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { createState, type GameState } from "../src/state";
import Prestige, { type LiveUpgrades } from "../src/systems/prestige";

const BASE = Config.PRESTIGE_GOLD_BASE;
const PER = Config.PRESTIGE_MULTIPLIER_PER_POINT;

// Minimal stand-in for the live Upgrades instance rebirth re-aliases
// through: set_state({}) zeroes every canonical track.
function makeUpgrades(initial: Record<string, number>): LiveUpgrades {
  return {
    upgrades: { ...initial },
    set_state(_next: Record<string, number>) {
      this.upgrades = {
        click_multiplier: 0,
        idle_rate: 0,
        gold_multiplier: 0,
        exp_multiplier: 0,
        crit_chance: 0,
        unlock_passive: 0,
      };
    },
  };
}

describe("Prestige: core economy", () => {
  describe("earnable_points", () => {
    it("is 0 below the base", () => {
      expect(Prestige.earnable_points({ prestige_gold_since_rebirth: 0 })).toBe(0);
      expect(Prestige.earnable_points({ prestige_gold_since_rebirth: BASE - 1 })).toBe(0);
      expect(Prestige.earnable_points({ prestige_gold_since_rebirth: 1 })).toBe(0);
    });

    it("is exactly 1 AT the base", () => {
      expect(Prestige.earnable_points({ prestige_gold_since_rebirth: BASE })).toBe(1);
    });

    it("is sub-linear past the base (anti-hoard)", () => {
      expect(Prestige.earnable_points({ prestige_gold_since_rebirth: 4 * BASE })).toBe(2);
      expect(Prestige.earnable_points({ prestige_gold_since_rebirth: 100 * BASE })).toBe(10);
      // 4x gold gives < 4x points; 100x gold gives < 100x points.
      const p1 = Prestige.earnable_points({ prestige_gold_since_rebirth: BASE });
      const p2 = Prestige.earnable_points({ prestige_gold_since_rebirth: 4 * BASE });
      expect(p2 < p1 * 4).toBe(true);
      const p3 = Prestige.earnable_points({ prestige_gold_since_rebirth: BASE });
      const p4 = Prestige.earnable_points({ prestige_gold_since_rebirth: 100 * BASE });
      expect(p4 < p3 * 100).toBe(true);
    });

    it("is monotonic non-decreasing over 0..10*base", () => {
      let prev = 0;
      for (let g = 0; g <= 10 * BASE; g += Math.floor(BASE / 100)) {
        const p = Prestige.earnable_points({ prestige_gold_since_rebirth: g });
        expect(p >= prev, `points went down at gold=${g}`).toBe(true);
        prev = p;
      }
    });

    it("is nil-safe (no counter yet)", () => {
      expect(Prestige.earnable_points(createState())).toBe(0);
    });
  });

  describe("gold_multiplier", () => {
    it("is exactly 1.0 at 0 points", () => {
      expect(Prestige.gold_multiplier({ prestige_points: 0 })).toBe(1.0);
      expect(Prestige.gold_multiplier(createState())).toBe(1.0);
    });

    it("is derived, not stored", () => {
      const s = createState();
      s.prestige_points = 50;
      expect(Prestige.gold_multiplier(s)).toBe(1 + 50 * PER);
      s.prestige_points = 200;
      expect(Prestige.gold_multiplier(s)).toBe(1 + 200 * PER);
      expect("prestige_multiplier" in s || "prestige_mult" in s).toBe(false);
    });

    it("is linear in points", () => {
      const m1 = Prestige.gold_multiplier({ prestige_points: 10 });
      const m2 = Prestige.gold_multiplier({ prestige_points: 20 });
      expect(Math.abs(m2 - m1 - 10 * PER) < 1e-12).toBe(true);
    });
  });

  describe("rebirth", () => {
    // A state with every persisted field set to a recognizable value so we
    // can prove which survive and which reset.
    function make_state(): GameState {
      const st = createState();
      st.gold = 12345;
      st.exp = 999;
      st.tokens = 55;
      st.pity_counter = 3;
      st.last_save_time = 1000;
      st.last_login_day = 42;
      st.login_streak = 7;
      st.total_gold_earned = 88888;
      st.total_exp_earned = 777;
      st.total_tokens_earned = 66;
      st.passive_unlocked = true;
      st.waifus = [{ name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.1, rarity: "common" }];
      st.exp_thresholds_unlocked = { "Spreadsheet Skeleton": true };
      st.prestige_points = 10;
      st.prestige_rebirths = 2;
      st.prestige_gold_since_rebirth = 100 * BASE;
      st.stats.badge_reward_gold = 5200;
      st.stats.badge_reward_tokens = 168;
      st.upgrades = {
        click_multiplier: 5, idle_rate: 3, gold_multiplier: 2,
        exp_multiplier: 1, crit_chance: 0, unlock_passive: 1,
      };
      return st;
    }

    it("resets the reset-set and preserves the keep-set", () => {
      const st = make_state();
      const ref = st; // capture identity
      const ups = makeUpgrades({ ...st.upgrades });

      const [ok, gain] = Prestige.rebirth(st, ups);

      expect(ok).toBe(true);
      expect(gain).toBe(10); // 100x base must yield 10 points (sub-linear sqrt)
      expect(st).toBe(ref); // state table identity preserved

      // KEEP_SET survives with its prior value.
      expect(st.tokens).toBe(55);
      expect(st.last_login_day).toBe(42);
      expect(st.login_streak).toBe(7);
      expect(st.last_save_time).toBe(1000);
      expect(st.total_gold_earned).toBe(88888);
      expect(st.total_exp_earned).toBe(777);
      expect(st.total_tokens_earned).toBe(66);
      expect(st.waifus).toHaveLength(1);
      expect(st.waifus[0].name).toBe("Karen the Accountant");

      // RESET_SET wiped to fresh defaults.
      expect(st.gold).toBe(0);
      expect(st.exp).toBe(0);
      expect(st.pity_counter).toBe(0);
      expect(st.passive_unlocked).toBeFalsy();
      expect(st.prestige_gold_since_rebirth).toBe(0);
      expect(st.exp_thresholds_unlocked).toEqual({});

      // Badge-award sub-keys zeroed on rebirth.
      expect(st.stats.badge_reward_gold).toBe(0);
      expect(st.stats.badge_reward_tokens).toBe(0);

      // Prestige block accumulates.
      expect(st.prestige_points).toBe(20); // 10 + gain(10)
      expect(st.prestige_rebirths).toBe(3); // 2 + 1
    });

    it("re-aliases state.upgrades to the live zeroed Upgrades instance", () => {
      const st = make_state();
      const ups = makeUpgrades({ ...st.upgrades });
      Prestige.rebirth(st, ups);

      expect(st.upgrades.click_multiplier).toBe(0);
      expect(st.upgrades.idle_rate).toBe(0);
      expect(st.upgrades.gold_multiplier).toBe(0);
      expect(st.upgrades.exp_multiplier).toBe(0);
      expect(st.upgrades.crit_chance).toBe(0);
      expect(st.upgrades.unlock_passive).toBe(0);
      expect(st.upgrades).toBe(ups.upgrades); // the live instance table
    });

    it("is a no-op returning false,0 when gain < 1", () => {
      const st = make_state();
      st.prestige_gold_since_rebirth = BASE - 1; // just short of a point
      const before = st.prestige_points;
      const ups = makeUpgrades({ ...st.upgrades });

      const [ok, gain] = Prestige.rebirth(st, ups);
      expect(ok).toBeFalsy();
      expect(gain).toBe(0);
      expect(st.prestige_points).toBe(before);
      expect(st.gold).toBe(12345);
      expect(st.upgrades.click_multiplier).toBe(5);
    });

    it("keeps/resets sets disjoint and cover the persist scheme exactly once", () => {
      // The persisted key set (mirrors the save scheme): every key must
      // appear in exactly one of KEEP_SET / RESET_SET.
      const scheme = [
        ...Prestige.KEEP_SET,
        ...Prestige.RESET_SET,
        "gold", "exp", "tokens", "pity_counter", "waifus", "upgrades",
        "stats", "achievements", "last_save_time", "passive_unlocked",
        "last_login_day", "login_streak", "total_gold_earned",
        "total_exp_earned", "total_tokens_earned", "exp_thresholds_unlocked",
        "prestige_points", "prestige_rebirths", "prestige_gold_since_rebirth",
      ];
      const expected = Array.from(new Set(scheme.slice(scheme.length - 19)));
      const keep = new Set(Prestige.KEEP_SET);
      const reset = new Set(Prestige.RESET_SET);
      const both: string[] = [];
      const neither: string[] = [];
      for (const k of expected) {
        if (keep.has(k) && reset.has(k)) both.push(k);
        else if (!keep.has(k) && !reset.has(k)) neither.push(k);
      }
      expect(both).toEqual([]);
      expect(neither).toEqual([]);
    });
  });
});

// The rebirth SUCCESS branch records the lifetime rebirth counter; the
// gain < 1 no-op branch records nothing.
describe("Prestige lifetime stats recording", () => {
  it("a successful rebirth bumps stats.rebirths exactly once", () => {
    const st = createState();
    st.gold = 12345;
    st.exp = 1;
    st.prestige_gold_since_rebirth = 100 * Config.PRESTIGE_GOLD_BASE;
    const ok = Prestige.rebirth(st, null);
    expect(ok[0]).toBe(true); // a gain >= 1 rebirth must complete
    expect(st.stats.rebirths).toBe(1);
  });

  it("a no-op rebirth (gain < 1) records nothing", () => {
    const st = createState();
    st.gold = 12345;
    st.prestige_gold_since_rebirth = Config.PRESTIGE_GOLD_BASE - 1;
    const [ok, gain] = Prestige.rebirth(st, null);
    expect(ok).toBeFalsy(); // below base must be a no-op
    expect(gain).toBe(0);
    expect(st.stats.rebirths).toBeUndefined();
  });
});
