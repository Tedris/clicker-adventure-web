// tests/mastery.test.ts
// Vitest tests for the mastery-by-doing system: derived levels from the
// lifetime stats map, the gold multiplier, and the luck stack.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import Mastery from "../src/systems/mastery";
import type { GameState } from "../src/state";

function st(props: Record<string, unknown>): GameState {
  return props as unknown as GameState;
}

describe("Mastery System", () => {
  describe("Levels", () => {
    it("missing stats and missing state read as zero levels", () => {
      expect(Mastery.level(st({}), "clicks")).toBe(0);
      expect(Mastery.level(undefined, "clicks")).toBe(0);
      expect(Mastery.total_levels(st({}))).toBe(0);
    });

    it("counts every threshold the counter has passed", () => {
      const s = Config.MASTERY_THRESHOLDS;
      expect(Mastery.level(st({ stats: { clicks: s[0] - 1 } }), "clicks")).toBe(0);
      expect(Mastery.level(st({ stats: { clicks: s[0] } }), "clicks")).toBe(1);
      expect(Mastery.level(st({ stats: { clicks: s[1] } }), "clicks")).toBe(2);
      expect(Mastery.level(st({ stats: { clicks: 999999 } }), "clicks")).toBe(s.length);
    });

    it("total_levels sums every tracked ladder", () => {
      const top = Config.MASTERY_THRESHOLDS[Config.MASTERY_THRESHOLDS.length - 1];
      const stats: Record<string, number> = {};
      for (const key of Config.MASTERY_TRACKS) stats[key] = top;
      expect(Mastery.total_levels(st({ stats }))).toBe(
        Config.MASTERY_TRACKS.length * Config.MASTERY_THRESHOLDS.length,
      );
    });

    it("untracked stat keys never contribute", () => {
      expect(Mastery.total_levels(st({ stats: { badge_reward_gold: 99999 } }))).toBe(0);
    });
  });

  describe("Gold multiplier", () => {
    it("zero levels -> exactly 1.0", () => {
      expect(Mastery.gold_multiplier(st({}))).toBe(1);
    });

    it("each level adds MASTERY_GOLD_PER_LEVEL", () => {
      const s = Config.MASTERY_THRESHOLDS[0];
      const mult = Mastery.gold_multiplier(st({ stats: { clicks: s } }));
      expect(mult).toBeCloseTo(1 + Config.MASTERY_GOLD_PER_LEVEL, 6);
    });
  });

  describe("Luck multiplier", () => {
    it("bare state -> exactly 1.0", () => {
      expect(Mastery.luck_multiplier(st({}))).toBe(1);
    });

    it("buffs unlocked by rebirth count multiply together", () => {
      expect(Mastery.luck_multiplier(st({ prestige_rebirths: 1 }))).toBeCloseTo(1.25, 6);
      expect(Mastery.luck_multiplier(st({ prestige_rebirths: 2 }))).toBeCloseTo(1.875, 6);
      expect(Mastery.luck_multiplier(st({ prestige_rebirths: 3 }))).toBeCloseTo(3.75, 6);
    });

    it("the buff product stacks with the mastery share", () => {
      const s = Config.MASTERY_THRESHOLDS[0];
      const luck = Mastery.luck_multiplier(
        st({ prestige_rebirths: 2, stats: { kills: s } }),
      );
      expect(luck).toBeCloseTo(1.875 * (1 + Config.LUCK_PER_MASTERY_LEVEL), 6);
    });

    it("luck_buffs lists only unlocked tiers", () => {
      expect(Mastery.luck_buffs(st({ prestige_rebirths: 1 })).map((b) => b.name))
        .toEqual(["Career Coach"]);
      expect(Mastery.luck_buffs(st({ prestige_rebirths: 3 })).length).toBe(3);
    });

    it("negative rebirth counts normalize to zero", () => {
      expect(Mastery.luck_multiplier(st({ prestige_rebirths: -3 }))).toBe(1);
    });
  });
});
