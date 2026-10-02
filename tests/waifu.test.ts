// tests/waifu.test.ts
// Vitest tests for the waifu system (ported from tests/test_waifu.lua):
// animation states, humor lines, bonus calculation.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { Waifu } from "../src/systems/waifu";
import type { GameState, WaifuInstance } from "../src/state";

function wi(name: string, bonus_type: string, bonus_value?: number): WaifuInstance {
  return { name, bonus_type, bonus_value, rarity: "common" } as unknown as WaifuInstance;
}

function stateWith(waifus?: WaifuInstance[], lane?: string[]): GameState {
  return {
    waifus,
    area_index: 0,
    assignments: lane ? { 0: lane } : {},
  } as unknown as GameState;
}

describe("Waifu System", () => {
  it("initializes with animation state defaulting to idle", () => {
    const waifu = new Waifu();
    expect(waifu).toBeTruthy();
    expect(waifu.animation_state).toBe("idle");
    expect(waifu.animation_timer).toBe(0);
    expect(waifu.humor_timer).toBe(0);
  });

  describe("Animation state colors", () => {
    it("idle returns summon-aura color", () => {
      const waifu = new Waifu();
      waifu.set_animation_state("idle");
      expect(waifu.get_state_color()).toEqual(Config.WAIFU_IDLE_COLOR);
    });
    it("happy returns success-green color", () => {
      const waifu = new Waifu();
      waifu.set_animation_state("happy");
      expect(waifu.get_state_color()).toEqual(Config.WAIFU_HAPPY_COLOR);
    });
    it("disappointed returns text-muted color", () => {
      const waifu = new Waifu();
      waifu.set_animation_state("disappointed");
      expect(waifu.get_state_color()).toEqual(Config.WAIFU_DISAPPOINTED_COLOR);
    });
    it("reaction returns summon-glow color", () => {
      const waifu = new Waifu();
      waifu.set_animation_state("reaction");
      expect(waifu.get_state_color()).toEqual(Config.WAIFU_REACTION_COLOR);
    });
  });

  describe("Animation state labels", () => {
    it("idle returns 'Karen (idle)'", () => {
      const waifu = new Waifu();
      waifu.set_animation_state("idle");
      expect(waifu.get_state_label()).toBe("Karen (idle)");
    });
    it("happy returns 'Karen (happy~)'", () => {
      const waifu = new Waifu();
      waifu.set_animation_state("happy");
      expect(waifu.get_state_label()).toBe("Karen (happy~)");
    });
    it("disappointed returns 'Karen (sigh...)'", () => {
      const waifu = new Waifu();
      waifu.set_animation_state("disappointed");
      expect(waifu.get_state_label()).toBe("Karen (sigh...)");
    });
    it("reaction returns 'Karen (ooh!)'", () => {
      const waifu = new Waifu();
      waifu.set_animation_state("reaction");
      expect(waifu.get_state_label()).toBe("Karen (ooh!)");
    });
  });

  describe("Per-waifu bonus calculation", () => {
    it("Karen (tokens +0.10) yields 0.10 token multiplier", () => {
      const waifu = new Waifu();
      const [tm, gm] = waifu.get_bonus_multiplier(stateWith([wi("Karen", "tokens", 0.10)]));
      expect(tm).toBe(0.10);
      expect(gm).toBe(0);
    });

    it("Two Karen-equivalent waifus yield 0.20 multiplier", () => {
      const waifu = new Waifu();
      const [tm, gm] = waifu.get_bonus_multiplier(
        stateWith([wi("Karen", "tokens", 0.10), wi("Karen2", "tokens", 0.10)]),
      );
      expect(tm).toBeCloseTo(0.20, 3);
      expect(gm).toBe(0);
    });

    it("Different bonus types do not affect token multiplier", () => {
      const waifu = new Waifu();
      const [tm, gm] = waifu.get_bonus_multiplier(
        stateWith([wi("Karen", "tokens", 0.10), wi("GoldGoddess", "gold", 0.15)]),
      );
      expect(tm).toBe(0.10);
      expect(gm).toBe(0.15);
    });

    it("Empty roster yields 0 multiplier", () => {
      const waifu = new Waifu();
      const [tm, gm] = waifu.get_bonus_multiplier(stateWith([]));
      expect(tm).toBe(0);
      expect(gm).toBe(0);
    });

    it("Nil waifu list yields 0 multiplier", () => {
      const waifu = new Waifu();
      const [tm, gm] = waifu.get_bonus_multiplier(stateWith(undefined));
      expect(tm).toBe(0);
      expect(gm).toBe(0);
    });

    it("Nil bonus_value is guarded (defaults to 0)", () => {
      const waifu = new Waifu();
      const [tm] = waifu.get_bonus_multiplier(stateWith([wi("Broken", "tokens", undefined)]));
      expect(tm).toBe(0);
    });

    it("Mixed token and gold bonuses calculate independently", () => {
      const waifu = new Waifu();
      const [tm, gm] = waifu.get_bonus_multiplier(
        stateWith([
          wi("Karen", "tokens", 0.10),
          wi("RichGoddess", "gold", 0.20),
          wi("Karen2", "tokens", 0.05),
        ]),
      );
      expect(tm).toBeCloseTo(0.15, 3);
      expect(gm).toBe(0.20);
    });

    it("get_bonus_multiplier returns three values", () => {
      const waifu = new Waifu();
      const [t, g, e] = waifu.get_bonus_multiplier(stateWith([]));
      expect(t).toBeDefined();
      expect(g).toBeDefined();
      expect(e).toBeDefined();
    });

    it("Steve (gold +0.05) yields 0.05 gold multiplier, 0 others", () => {
      const waifu = new Waifu();
      const [tm, gm, em] = waifu.get_bonus_multiplier(stateWith([wi("Steve", "gold", 0.05)]));
      expect(tm).toBe(0);
      expect(gm).toBeCloseTo(0.05, 3);
      expect(em).toBe(0);
    });

    it("Linda (exp +0.07) yields 0.07 exp multiplier, 0 others", () => {
      const waifu = new Waifu();
      const [tm, gm, em] = waifu.get_bonus_multiplier(stateWith([wi("Linda", "exp", 0.07)]));
      expect(tm).toBe(0);
      expect(gm).toBe(0);
      expect(em).toBeCloseTo(0.07, 3);
    });

    it("All three waifus stack correctly", () => {
      const waifu = new Waifu();
      const [tm, gm, em] = waifu.get_bonus_multiplier(
        stateWith([
          wi("Karen", "tokens", 0.10),
          wi("Steve", "gold", 0.05),
          wi("Linda", "exp", 0.07),
        ]),
      );
      expect(tm).toBeCloseTo(0.10, 3);
      expect(gm).toBeCloseTo(0.05, 3);
      expect(em).toBeCloseTo(0.07, 3);
    });

    it("Exp and gold bonuses do not affect token multiplier", () => {
      const waifu = new Waifu();
      const [tm] = waifu.get_bonus_multiplier(
        stateWith([
          wi("Karen", "tokens", 0.10),
          wi("Steve", "gold", 0.05),
          wi("Linda", "exp", 0.07),
        ]),
      );
      expect(tm).toBeCloseTo(0.10, 3);
    });
  });

  describe("Area assignments", () => {
    it("empty lane is AUTO: top EQUIP_SLOTS instances by bonus_value count", () => {
      const waifu = new Waifu();
      const roster = [
        wi("A", "gold", 0.05), wi("B", "gold", 0.20), wi("C", "gold", 0.10), wi("D", "gold", 0.15),
      ];
      const [tm, gm] = waifu.get_bonus_multiplier(stateWith(roster));
      // Top three by value: B 0.20 + D 0.15 + C 0.10 — A falls out.
      expect(gm).toBeCloseTo(0.45, 3);
      expect(tm).toBe(0);
    });

    it("named lane counts assigned names only, duplicates stacked", () => {
      const waifu = new Waifu();
      const roster = [
        wi("Hank", "tokens", 0.15), wi("Rosa", "gold", 0.08), wi("Hank", "tokens", 0.18),
      ];
      const [tm, gm] = waifu.get_bonus_multiplier(stateWith(roster, ["Hank"]));
      expect(tm).toBeCloseTo(0.33, 3); // both Hank copies stack
      expect(gm).toBe(0);
    });

    it("toggle_assign adds, removes and evicts oldest beyond the slots", () => {
      const waifu = new Waifu();
      const st = stateWith([wi("A", "gold", 0.1), wi("B", "gold", 0.1), wi("C", "gold", 0.1), wi("D", "gold", 0.1)]);
      expect(waifu.toggle_assign(st, "A")).toEqual(["A"]);
      expect(waifu.toggle_assign(st, "B")).toEqual(["A", "B"]);
      expect(waifu.toggle_assign(st, "A")).toEqual(["B"]);
      waifu.toggle_assign(st, "C");
      const lane = waifu.toggle_assign(st, "D");
      expect(lane).toEqual(["B", "C", "D"]);
      const evicted = waifu.toggle_assign(st, "A"); // fourth hire pushes the oldest
      expect(evicted).toEqual(["C", "D", "A"]);
    });
  });

  describe("Config waifu pool and personality", () => {
    it("Config.WAIFU_POOL has three entries with the expected names", () => {
      expect(Config.WAIFU_POOL.length).toBe(3);
      expect(Config.WAIFU_POOL.map((w) => w.name)).toEqual([
        "Karen the Accountant",
        "Steve the HR Rep",
        "Linda the Middle Manager",
      ]);
    });

    it("Config.WAIFU_PERSONALITY has entries for all three waifus", () => {
      expect(Config.WAIFU_PERSONALITY["Karen the Accountant"]).toBeTruthy();
      expect(Config.WAIFU_PERSONALITY["Steve the HR Rep"]).toBeTruthy();
      expect(Config.WAIFU_PERSONALITY["Linda the Middle Manager"]).toBeTruthy();
    });

    it("Steve has correct reveal properties", () => {
      const steve = Config.WAIFU_PERSONALITY["Steve the HR Rep"];
      expect(steve.reveal_color).toEqual([46, 204, 113, 255]);
      expect(steve.reveal_label).toBe("Steve (nodding approvingly)");
      expect(steve.glow_intensity).toBe(0.6);
      expect(steve.reaction_delay).toBe(0.15);
    });

    it("Linda has correct reveal properties", () => {
      const linda = Config.WAIFU_PERSONALITY["Linda the Middle Manager"];
      expect(linda.reveal_color).toEqual([243, 156, 18, 255]);
      expect(linda.reveal_label).toBe("Linda (synergizing~)");
      expect(linda.glow_intensity).toBe(0.7);
      expect(linda.reaction_delay).toBe(0.12);
    });
  });

  describe("Waifu set_waifu and humor lines", () => {
    it("set_waifu stores current waifu data", () => {
      const waifu = new Waifu();
      waifu.set_waifu({ name: "Steve the HR Rep" });
      expect(waifu.current_waifu!.name).toBe("Steve the HR Rep");
    });

    it("get_first_pull_line returns Steve line when set", () => {
      const waifu = new Waifu();
      waifu.set_waifu({ name: "Steve the HR Rep" });
      const line = waifu.get_first_pull_line();
      expect(line).toBeTruthy();
      expect(typeof line).toBe("string");
    });

    it("get_periodic_line returns Steve line when set", () => {
      const waifu = new Waifu();
      waifu.set_waifu({ name: "Steve the HR Rep" });
      const line = waifu.get_periodic_line();
      expect(line).toBeTruthy();
      expect(typeof line).toBe("string");
    });

    it("get_first_pull_line returns Linda line when set", () => {
      const waifu = new Waifu();
      waifu.set_waifu({ name: "Linda the Middle Manager" });
      expect(waifu.get_first_pull_line()).toBeTruthy();
    });

    it("get_periodic_line returns Linda line when set", () => {
      const waifu = new Waifu();
      waifu.set_waifu({ name: "Linda the Middle Manager" });
      expect(waifu.get_periodic_line()).toBeTruthy();
    });
  });

  describe("Humor line system", () => {
    it("returns a line from the pool", () => {
      const waifu = new Waifu();
      const lines = [
        "Have you filed your tax forms today?",
        "This clicker would make an excellent spreadsheet.",
        "I've calculated your optimal farming route. It involves more clicking.",
      ];
      const line = waifu.get_random_humor_line(lines)!;
      expect(lines).toContain(line);
    });

    it("returns nil for empty pool", () => {
      expect(new Waifu().get_random_humor_line([])).toBeNull();
    });

    it("returns nil for nil pool", () => {
      expect(new Waifu().get_random_humor_line(undefined)).toBeNull();
    });

    it("returns nil when no waifu is set", () => {
      expect(new Waifu().get_first_pull_line()).toBeNull();
    });

    it("returns nil when no waifu is set (periodic)", () => {
      expect(new Waifu().get_periodic_line()).toBeNull();
    });

    it("returns Karen's first pull line when set", () => {
      const waifu = new Waifu();
      waifu.set_waifu({ name: "Karen the Accountant" });
      const line = waifu.get_first_pull_line()!;
      expect([
        "I was isekai'd because my Excel macros were too powerful for this dimension.",
        "My cheat skill is 'understanding Q4 projections.' Please don't make me use it.",
        "They told me this was a 'relaxing idle game.' I see no spreadsheets.",
        "I spent 200 pulls for this? My billable hours would have covered it.",
        "Welcome to the roster. I'll start auditing your gold immediately.",
      ]).toContain(line);
    });

    it("returns Karen's periodic line when set", () => {
      const waifu = new Waifu();
      waifu.set_waifu({ name: "Karen the Accountant" });
      expect(waifu.get_periodic_line()).toBeTruthy();
    });

    it("triggers after configured interval", () => {
      const waifu = new Waifu();
      waifu.humor_timer = 35;
      waifu.next_humor_interval = 30;
      expect(waifu.check_humor_trigger(35)).toBe(true);
      expect(waifu.humor_timer).toBe(0);
    });

    it("does not trigger before interval", () => {
      const waifu = new Waifu();
      waifu.humor_timer = 10;
      waifu.next_humor_interval = 30;
      expect(waifu.check_humor_trigger(10)).toBe(false);
    });
  });

  describe("Passive integration", () => {
    // Mirrors Passive:apply_passive_rewards (passive.ts not yet ported) so the
    // waifu bonus tuple is exercised through its real consumer formula:
    // rate * (1 + bonus_mult), one tick per call (dt=1.0 equivalent).
    function passiveTick(state: GameState, waifu: Waifu | null): void {
      const [tm, gm, em] = waifu ? waifu.get_bonus_multiplier(state) : [0, 0, 0];
      const tokens = Config.PASSIVE_TOKEN_RATE * (1 + tm);
      const gold = Config.PASSIVE_GOLD_RATE * (1 + gm);
      const exp = Config.PASSIVE_EXP_RATE * (1 + em);
      state.gold += gold; state.exp += exp; state.tokens += tokens;
      state.total_gold_earned += gold;
      state.total_exp_earned += exp;
      state.total_tokens_earned += tokens;
    }

    function passiveState(waifus?: WaifuInstance[]): GameState {
      return {
        gold: 0, exp: 0, tokens: 0,
        total_gold_earned: 0, total_exp_earned: 0, total_tokens_earned: 0,
        passive_unlocked: true, waifus: waifus ?? [],
      } as unknown as GameState;
    }

    it("applies correct multiplier to token rate", () => {
      const state = passiveState([wi("Karen", "tokens", 0.10)]);
      passiveTick(state, new Waifu());
      expect(state.tokens).toBeCloseTo(1.1, 3);
      expect(state.total_tokens_earned).toBeCloseTo(1.1, 3);
    });

    it("falls back to base rates when waifu is nil", () => {
      const state = passiveState();
      passiveTick(state, null);
      expect(state.tokens).toBe(1);
      expect(state.total_tokens_earned).toBe(1);
    });

    it("applies gold bonus to gold rate", () => {
      const state = passiveState([wi("RichGoddess", "gold", 0.25)]);
      passiveTick(state, new Waifu());
      expect(state.gold).toBeCloseTo(5.0, 3);
      expect(state.total_gold_earned).toBeCloseTo(5.0, 3);
    });
  });
});
