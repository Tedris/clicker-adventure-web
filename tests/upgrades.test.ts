// tests/upgrades.test.ts
// Vitest port of tests/test_upgrades.lua (busted -> vitest).

import { describe, it, expect } from "vitest";
import Upgrades from "../src/systems/upgrades";
import UpgradePanel from "../src/ui/upgrades_panel";
import { createState } from "../src/state";
import type { GameState } from "../src/state";

function st(gold: number, extra: Partial<GameState> = {}): GameState {
  return { ...createState(), gold, ...extra };
}

describe("Upgrade System", () => {
  it("initializes with level 0 for all upgrade types", () => {
    const upgrades = new Upgrades();
    expect(upgrades).toBeTruthy();
    expect(upgrades.upgrades.click_multiplier).toBe(0);
    expect(upgrades.upgrades.idle_rate).toBe(0);
    expect(upgrades.upgrades.gold_multiplier).toBe(0);
    expect(upgrades.upgrades.exp_multiplier).toBe(0);
    expect(upgrades.upgrades.crit_chance).toBe(0);
  });

  it("has upgrade definitions including unlock_passive", () => {
    const upgrades = new Upgrades();
    expect(Object.keys(upgrades.Definitions).length).toBe(6);
    expect(upgrades.Definitions.unlock_passive).toBeTruthy();
  });

  it("calculates linear cost for click multiplier (base 10 + step 15)", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_cost("click_multiplier", 1)).toBe(25);
    expect(upgrades.get_cost("click_multiplier", 2)).toBe(40);
    expect(upgrades.get_cost("click_multiplier", 10)).toBe(160);
    expect(upgrades.get_cost("click_multiplier", 50)).toBe(760);
  });

  it("calculates linear cost for idle rate (base 20 + step 25)", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_cost("idle_rate", 1)).toBe(45);
    expect(upgrades.get_cost("idle_rate", 2)).toBe(70);
    expect(upgrades.get_cost("idle_rate", 10)).toBe(270);
    expect(upgrades.get_cost("idle_rate", 50)).toBe(1270);
  });

  it("calculates exponential cost for gold multiplier, floor(50 * 1.5^level)", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_cost("gold_multiplier", 1)).toBe(75);
    expect(upgrades.get_cost("gold_multiplier", 2)).toBe(112);
    expect(upgrades.get_cost("gold_multiplier", 10)).toBe(2883);
  });

  it("calculates exponential cost for exp multiplier (same as gold)", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_cost("gold_multiplier", 1)).toBe(
      upgrades.get_cost("exp_multiplier", 1),
    );
    expect(upgrades.get_cost("gold_multiplier", 10)).toBe(
      upgrades.get_cost("exp_multiplier", 10),
    );
  });

  it("calculates exponential cost for crit chance, floor(100 * 1.5^level)", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_cost("crit_chance", 1)).toBe(150);
    expect(upgrades.get_cost("crit_chance", 2)).toBe(225);
    expect(upgrades.get_cost("crit_chance", 5)).toBe(759);
  });

  it("purchases upgrade: level increments and gold deducts", () => {
    const upgrades = new Upgrades();
    const state = st(1000);
    const new_level = upgrades.purchase("click_multiplier", state);
    expect(new_level).toBe(1);
    expect(upgrades.upgrades.click_multiplier).toBe(1);
    expect(state.gold).toBe(990); // cost at level 0: 10 + 0 * 15
  });

  it("accumulates purchases across multiple levels", () => {
    const upgrades = new Upgrades();
    const state = st(10000);
    upgrades.purchase("click_multiplier", state);
    upgrades.purchase("click_multiplier", state);
    expect(upgrades.upgrades.click_multiplier).toBe(2);
    expect(state.gold).toBe(10000 - 10 - 25); // costs at level 0 and 1
  });

  it("raises error when purchasing with insufficient gold", () => {
    const upgrades = new Upgrades();
    expect(() => upgrades.purchase("click_multiplier", st(5))).toThrow();
  });

  it("is_maxed returns true at level 100", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 100;
    expect(upgrades.is_maxed("click_multiplier")).toBe(true);
    expect(upgrades.is_maxed("idle_rate")).toBe(false);
  });

  it("raises error when purchasing at max level", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 100;
    expect(() => upgrades.purchase("click_multiplier", st(999999))).toThrow();
  });

  // Phase B: the exponential lines keep their 50-step ceilings even though
  // Config.UPGRADE_MAX_LEVEL documents the 100-level active rails.
  it("exponential lines cap at 50 while the active rails reach 100", () => {
    const upgrades = new Upgrades();
    expect(upgrades.Definitions.click_multiplier.max_level).toBe(100);
    expect(upgrades.Definitions.idle_rate.max_level).toBe(100);
    expect(upgrades.Definitions.gold_multiplier.max_level).toBe(50);
    expect(upgrades.Definitions.exp_multiplier.max_level).toBe(50);
    expect(upgrades.Definitions.crit_chance.max_level).toBe(50);
  });

  // Phase B: crit chance saturates at a clean 100% instead of overshooting.
  it("crit chance effect caps at 100% at max level", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.crit_chance = 50;
    expect(upgrades.get_crit_chance()).toBe(100);
    expect(upgrades.Definitions.crit_chance.description(50)).toBe(
      "100% crit chance",
    );
  });

  it("raises error for unknown upgrade key in get_cost", () => {
    const upgrades = new Upgrades();
    expect(() => upgrades.get_cost("nonexistent", 0)).toThrow();
  });

  it("returns 1x click multiplier at level 0", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_click_multiplier()).toBe(1);
  });

  it("includes click multiplier effect at level 5", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 5; // effect: 1 + 5 = 6, gold: 1
    expect(upgrades.get_click_multiplier()).toBe(6);
  });

  it("includes gold multiplier effect", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 0;
    upgrades.upgrades.gold_multiplier = 5; // effect: 1 + 5 * 0.1 = 1.5
    expect(upgrades.get_click_multiplier()).toBe(1.5);
  });

  it("combines click and gold multipliers", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 4; // effect: 5
    upgrades.upgrades.gold_multiplier = 10; // effect: 2
    expect(upgrades.get_click_multiplier()).toBe(10);
  });

  it("returns 1x passive multiplier at level 0", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_passive_multiplier()).toBe(1);
  });

  it("returns correct passive multiplier at various levels", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.idle_rate = 0;
    expect(upgrades.get_passive_multiplier()).toBe(1);
    upgrades.upgrades.idle_rate = 2; // 1 + 2 * 0.5
    expect(upgrades.get_passive_multiplier()).toBe(2);
    upgrades.upgrades.idle_rate = 10; // 1 + 10 * 0.5
    expect(upgrades.get_passive_multiplier()).toBe(6);
  });

  it("returns 5% crit chance at level 0", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_crit_chance()).toBe(5);
  });

  it("increases crit chance with levels", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.crit_chance = 0;
    expect(upgrades.get_crit_chance()).toBe(5);
    upgrades.upgrades.crit_chance = 1; // 5 + 2
    expect(upgrades.get_crit_chance()).toBe(7);
    upgrades.upgrades.crit_chance = 10; // 5 + 20
    expect(upgrades.get_crit_chance()).toBe(25);
  });

  it("get_state returns current upgrade levels", () => {
    const upgrades = new Upgrades();
    upgrades.purchase("click_multiplier", st(99999));
    const state = upgrades.get_state();
    expect(state.click_multiplier).toBe(1);
    expect(state.idle_rate).toBe(0);
    expect(state.gold_multiplier).toBe(0);
    expect(state.exp_multiplier).toBe(0);
    expect(state.crit_chance).toBe(0);
  });

  it("set_state restores upgrade levels correctly", () => {
    const upgrades = new Upgrades();
    upgrades.purchase("click_multiplier", st(99999));
    upgrades.upgrades.unlock_passive = 1;
    upgrades.purchase("idle_rate", st(99999)); // lattice: parent unlocked at Lv1
    const saved = upgrades.get_state();
    for (const key of Object.keys(upgrades.Definitions)) {
      upgrades.upgrades[key] = 0;
    }
    upgrades.set_state(saved);
    expect(upgrades.upgrades.click_multiplier).toBe(1);
    expect(upgrades.upgrades.idle_rate).toBe(1);
  });

  it("set_state fills missing upgrade keys with 0", () => {
    const upgrades = new Upgrades();
    upgrades.set_state({ click_multiplier: 5 });
    expect(upgrades.upgrades.click_multiplier).toBe(5);
    expect(upgrades.upgrades.idle_rate).toBe(0);
    expect(upgrades.upgrades.gold_multiplier).toBe(0);
    expect(upgrades.upgrades.exp_multiplier).toBe(0);
    expect(upgrades.upgrades.crit_chance).toBe(0);
  });

  it("set_state with nil does not crash", () => {
    const upgrades = new Upgrades();
    upgrades.set_state(undefined);
    expect(upgrades.upgrades.click_multiplier).toBe(0);
  });

  it("can_afford returns true when gold is sufficient", () => {
    const upgrades = new Upgrades();
    expect(upgrades.can_afford("click_multiplier", st(100))).toBe(true);
  });

  it("can_afford returns false when gold is insufficient", () => {
    const upgrades = new Upgrades();
    expect(upgrades.can_afford("click_multiplier", st(1))).toBe(false);
  });

  it("all upgrade definitions have required fields", () => {
    const upgrades = new Upgrades();
    for (const [key, def] of Object.entries(upgrades.Definitions)) {
      expect(def.name, `Missing name for ${key}`).toBeTruthy();
      expect(def.icon, `Missing icon for ${key}`).toBeTruthy();
      expect(def.color.length > 0, `Missing color for ${key}`).toBe(true);
      expect(def.base_cost, `Missing base_cost for ${key}`).toBeTruthy();
      expect(def.cost_scaling, `Missing cost_scaling for ${key}`).toBeTruthy();
      expect(def.max_level, `Missing max_level for ${key}`).toBeTruthy();
      expect(typeof def.effect_per_level).toBe("function");
      expect(typeof def.description).toBe("function");
    }
  });

  it("all upgrade definitions use valid cost_scaling values", () => {
    const upgrades = new Upgrades();
    for (const [, def] of Object.entries(upgrades.Definitions)) {
      expect(
        def.cost_scaling === "linear" ||
          def.cost_scaling === "exponential" ||
          def.cost_scaling === "fixed",
      ).toBe(true);
    }
  });

  it("linear upgrade costs increase monotonically", () => {
    const upgrades = new Upgrades();
    let prev_cost = 0;
    for (let level = 0; level <= 99; level++) {
      const cost = upgrades.get_cost("click_multiplier", level);
      expect(cost > prev_cost).toBe(true);
      prev_cost = cost;
    }
  });

  it("exponential upgrade costs increase monotonically", () => {
    const upgrades = new Upgrades();
    let prev_cost = 0;
    for (let level = 0; level <= 49; level++) {
      const cost = upgrades.get_cost("gold_multiplier", level);
      expect(cost > prev_cost).toBe(true); // exponential line still caps at 50
      prev_cost = cost;
    }
  });

  it("unlock_passive has a fixed cost equal to base_cost", () => {
    const upgrades = new Upgrades();
    expect(upgrades.get_cost("unlock_passive", 0)).toBe(
      upgrades.Definitions.unlock_passive.base_cost,
    );
    expect(upgrades.get_cost("unlock_passive", 1)).toBe(
      upgrades.Definitions.unlock_passive.base_cost,
    );
  });

  it("purchasing unlock_passive sets state.passive_unlocked to true", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 2; // lattice parent gate
    const state = st(100, { passive_unlocked: false });
    upgrades.purchase("unlock_passive", state);
    expect(state.passive_unlocked).toBe(true);
    expect(upgrades.upgrades.unlock_passive).toBe(1);
  });

  it("unlock_passive cannot be purchased past level 1", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 2; // lattice parent gate
    upgrades.purchase("unlock_passive", st(99999));
    expect(() => upgrades.purchase("unlock_passive", st(99999))).toThrow();
  });

  it("unlock_passive description reflects unlocked state", () => {
    const upgrades = new Upgrades();
    expect(upgrades.Definitions.unlock_passive.description(0)).toBe(
      "Unlock idle generation",
    );
    expect(upgrades.Definitions.unlock_passive.description(1)).toBe(
      "Passive gen active",
    );
  });
});

describe("Upgrades:next_affordable / save_toward (FEEL-02)", () => {
  it("next_affordable picks the cheapest affordable in pacing order", () => {
    const upgrades = new Upgrades();
    // All at level 0: click=10, idle=20, gold=50, exp=50, crit=100, passive=50.
    const [key, cost] = upgrades.next_affordable(st(100));
    expect(key).toBe("click_multiplier");
    expect(cost).toBe(10);
  });

  it("next_affordable skips unaffordable and maxed tracks", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 100; // maxed
    upgrades.upgrades.unlock_passive = 1; // maxed
    // idle: 20 (affordable), gold: 50, exp: 50, crit: 100
    const [key, cost] = upgrades.next_affordable(st(20));
    expect(key).toBe("idle_rate");
    expect(cost).toBe(20);
  });

  it("next_affordable tie-break: PRIORITY-earlier key wins on equal cost", () => {
    const upgrades = new Upgrades();
    // Only gold/exp multipliers affordable at gold=50, both cost 50;
    // gold_multiplier is pacing-order-earlier.
    upgrades.upgrades.click_multiplier = 3; // cost 55, unaffordable
    upgrades.upgrades.idle_rate = 2; // cost 70, unaffordable
    upgrades.upgrades.unlock_passive = 1; // maxed
    const [key, cost] = upgrades.next_affordable(st(50));
    expect(key).toBe("gold_multiplier");
    expect(cost).toBe(50);
  });

  it("next_affordable returns nil when nothing is affordable", () => {
    const upgrades = new Upgrades();
    const [key, cost] = upgrades.next_affordable(st(5));
    expect(key).toBeNull();
    expect(cost).toBeNull();
  });

  it("save_toward returns cheapest not-maxed with correct deficit", () => {
    const upgrades = new Upgrades();
    const t = upgrades.save_toward(st(5));
    expect(t).toBeTruthy();
    expect(t!.key).toBe("click_multiplier"); // cost 10, cheapest
    expect(t!.cost).toBe(10);
    expect(t!.deficit).toBe(5); // 10 - 5
  });

  it("save_toward respects pacing order on ties", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 100; // maxed
    upgrades.upgrades.idle_rate = 2; // cost 70
    upgrades.upgrades.unlock_passive = 1; // maxed
    upgrades.upgrades.crit_chance = 1; // cost 150
    const t = upgrades.save_toward(st(5));
    expect(t).toBeTruthy();
    expect(t!.key).toBe("gold_multiplier"); // PRIORITY-earlier of the two 50s
    expect(t!.cost).toBe(50);
    expect(t!.deficit).toBe(45); // 50 - 5
  });

  it("save_toward returns nil when every track is maxed", () => {
    const upgrades = new Upgrades();
    for (const [key, def] of Object.entries(upgrades.Definitions)) {
      upgrades.upgrades[key] = def.max_level;
    }
    const state = st(1000000);
    expect(upgrades.save_toward(state)).toBeNull();
    expect(upgrades.next_affordable(state)[0]).toBeNull();
  });

  it("save_toward clamps deficit to zero when gold >= cost", () => {
    const upgrades = new Upgrades();
    const t = upgrades.save_toward(st(50)); // click cost 10 cheapest
    expect(t).toBeTruthy();
    expect(t!.deficit).toBe(0);
  });
});

// STATS-02: a COMPLETED purchase records upgrades_bought; a refused purchase
// errors out and records nothing.
describe("Upgrades lifetime stats recording (STATS-02)", () => {
  it("a completed purchase bumps stats.upgrades_bought once per level gained", () => {
    const upgrades = new Upgrades();
    const state = st(999999, { stats: {} });
    upgrades.purchase("click_multiplier", state);
    expect(state.stats.upgrades_bought).toBe(1);
    upgrades.purchase("click_multiplier", state);
    expect(state.stats.upgrades_bought).toBe(2);
  });

  it("an unaffordable purchase errors and records nothing", () => {
    const upgrades = new Upgrades();
    const state = st(1, { stats: {} });
    expect(() => upgrades.purchase("click_multiplier", state)).toThrow();
    expect(state.stats.upgrades_bought).toBeUndefined();
  });

  it("a maxed purchase errors and records nothing extra", () => {
    const upgrades = new Upgrades();
    upgrades.upgrades.click_multiplier = 2; // lattice parent gate
    const state = st(999999, { stats: {} });
    upgrades.purchase("unlock_passive", state);
    expect(state.stats.upgrades_bought).toBe(1);
    expect(() => upgrades.purchase("unlock_passive", state)).toThrow();
    expect(state.stats.upgrades_bought).toBe(1); // refused buy must not double-count
  });

  it("a purchase on a state without a stats table completes without error (nil-safe hook)", () => {
    const upgrades = new Upgrades();
    const bare = { gold: 999999 } as unknown as GameState;
    let ok = true;
    try {
      upgrades.purchase("click_multiplier", bare);
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });
});




describe("UpgradePanel reading order", () => {
  it("reads as the skill chain: PRIORITY order, click_multiplier first", () => {
    const panel = new UpgradePanel(new Upgrades());
    expect(panel.card_keys()).toEqual([
      "click_multiplier",
      "unlock_passive",
      "idle_rate",
      "gold_multiplier",
      "exp_multiplier",
      "crit_chance",
    ]);
  });

  describe("Lattice gating", () => {
    it("only the root is live on a fresh board", () => {
      const upgrades = new Upgrades();
      expect(upgrades.is_unlocked("click_multiplier")).toBe(true);
      expect(upgrades.is_unlocked("unlock_passive")).toBe(false);
      expect(upgrades.locked_by("unlock_passive")).toEqual(["Click Multiplier", 2]);
    });

    it("a child lights up when its parent reaches the gate level", () => {
      const upgrades = new Upgrades();
      upgrades.upgrades.click_multiplier = 2;
      expect(upgrades.is_unlocked("unlock_passive")).toBe(true);
      // one level deep: Idle Generation maxes at 1, so Lv1 gates Idle Rate
      upgrades.upgrades.unlock_passive = 1;
      expect(upgrades.is_unlocked("idle_rate")).toBe(true);
      expect(upgrades.is_unlocked("gold_multiplier")).toBe(false);
    });

    it("purchase refuses a locked node and records nothing", () => {
      const upgrades = new Upgrades();
      const state = st(999999, { stats: {} });
      expect(() => upgrades.purchase("idle_rate", state)).toThrow("Upgrade locked: idle_rate");
      expect(state.stats.upgrades_bought).toBeUndefined();
      expect(state.gold).toBe(999999);
    });

    it("next_affordable walks only live nodes", () => {
      const upgrades = new Upgrades();
      upgrades.upgrades.click_multiplier = 100; // maxed root
      // unlock_passive is live (parent maxed >= 2); everything deeper waits.
      const [key] = upgrades.next_affordable(st(1000));
      expect(key).toBe("unlock_passive");
    });
  });
});
