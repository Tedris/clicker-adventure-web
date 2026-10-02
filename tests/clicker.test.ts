// tests/clicker.test.ts
// Vitest port of tests/test_clicker.lua (busted -> vitest).

import { describe, it, expect, afterEach } from "vitest";
import Config from "../src/config";
import Clicker from "../src/systems/clicker";
import Upgrades from "../src/systems/upgrades";
import { createState } from "../src/state";
import type { GameState } from "../src/state";

function st(extra: Partial<GameState> = {}): GameState {
  return { ...createState(), ...extra };
}

describe("Clicker System", () => {
  it("initializes with correct default state", () => {
    const clicker = new Clicker();
    expect(clicker).toBeTruthy();
    expect(clicker.monster_state).toBe("alive");
    expect(clicker.current_monster).toBeTruthy();
    expect(clicker.current_monster!.humor_lines.length > 0).toBe(true);
    expect(clicker.pops.length).toBe(0);
    expect(clicker.fade_alpha).toBe(0.0);
    expect(clicker.fade_direction).toBe("in");
    expect(clicker.compression_phase).toBe("none");
  });

  it("awards gold and exp on click", () => {
    const clicker = new Clicker();
    const state = st();
    const rewards = clicker.click(state);
    expect(rewards).toBeTruthy();
    expect(rewards.gold > 0).toBe(true);
    expect(rewards.exp > 0).toBe(true);
    expect(rewards.gold).toBe(state.gold);
    expect(rewards.exp).toBe(state.exp);
    expect(clicker.monster_state).toBe("dead");
  });

  it("cleared areas pay a permanent gold multiplier on clicks", () => {
    const orig = Config.CRIT_CHANCE;
    Config.CRIT_CHANCE = 0;
    try {
      const clicker = new Clicker();
      const state = st();
      state.area_index = 2;
      const rewards = clicker.click(state);
      expect(rewards.gold).toBeCloseTo(
        Config.BASE_CLICK_VALUE * (1 + 2 * Config.AREA_GOLD_BONUS_PER_CLEAR), 5);
    } finally {
      Config.CRIT_CHANCE = orig;
    }
  });

  it("kills cap at the quota and never move the player by themselves", () => {
    const clicker = new Clicker();
    const state = st();
    state.area_kills = Config.AREA_KILL_TARGETS[0] - 1;
    clicker.click(state); // milestone kill fills the harvest rhythm
    expect(state.area_index).toBe(0); // advancing stays the player's call
    expect(state.area_kills).toBe(Config.AREA_KILL_TARGETS[0]);
  });

  it("click gold feeds the area's own gold meter", () => {
    const clicker = new Clicker();
    const state = st();
    clicker.click(state); // hp 1: one kill
    expect((state.area_gold ?? 0) > 0).toBe(true);
    expect(state.area_gold ?? 0).toBeLessThanOrEqual(state.gold);
  });

  it("later areas need multiple chips per kill and show HP", () => {
    const clicker = new Clicker();
    const state = st();
    state.area_index = 1; // Open Plan: hp 2
    clicker.spawn_new_monster(state);
    expect(clicker.max_hp).toBe(Config.AREA_MONSTER_HP[1]);
    clicker.click(state);
    expect(clicker.monster_state).toBe("alive"); // chipped, not dead yet
    expect(clicker.hp).toBe(Config.AREA_MONSTER_HP[1] - 1);
    clicker.click(state);
    expect(clicker.monster_state).toBe("dead");
    expect(state.area_kills).toBe(1); // counts once, not per chip
  });

  it("each area favors its own monster species", () => {
    const clicker = new Clicker();
    const seen: string[] = [];
    // Early-exp pool only exposes the ungated species; each matching area
    // must prefer its own key over the random fallback.
    for (const idx of [0, 1]) {
      const state = st();
      state.area_index = idx;
      clicker.spawn_new_monster(state);
      seen.push(clicker.current_monster?.sprite_key ?? "");
      expect(clicker.current_monster?.sprite_key).toBe(Config.AREAS[idx].monster);
    }
    expect(new Set(seen).size > 1).toBe(true);
  });

  it("assigned hires land automatic kills on a tick, bosses included", () => {
    const clicker = new Clicker();
    const state = st({ session_clicks: 0 });
    state.area_index = 1;
    clicker.spawn_new_monster(state); // hp 2
    const kills = clicker.auto_tick(state, 2); // two allies x click dmg
    expect(kills).toBe(1);
    expect(state.area_kills).toBe(1);
    // Overflow carries over within the tick: 3 allies clear hp 2 with 1 left.
    clicker.spawn_new_monster(state);
    expect(clicker.auto_tick(state, 3)).toBe(1);
    expect(clicker.hp).toBe(Config.AREA_MONSTER_HP[1] - 1);
  });

  it("prevents clicking dead monsters", () => {
    const clicker = new Clicker();
    clicker.click(st()); // hp 1: the first chip is the kill
    expect(() => clicker.click(st())).toThrow();
  });

  it("accumulates gold across multiple clicks", () => {
    const clicker = new Clicker();
    const state = st();
    clicker.click(state);
    const g1 = state.gold;
    clicker.spawn_new_monster();
    clicker.click(state);
    expect(state.gold > g1).toBe(true);
  });

  it("respawns monster after fade-in completes", () => {
    const clicker = new Clicker();
    const state = st();
    clicker.monster_state = "dead";
    clicker.fade_direction = "in";
    clicker.fade_alpha = 0.5;
    clicker.fade_timer = 0.15;
    clicker.update(0.2, state);
    expect(clicker.monster_state).toBe("alive");
    expect(clicker.fade_alpha).toBe(1.0);
  });

  it("resets humor state on respawn", () => {
    const clicker = new Clicker();
    clicker.spawn_new_monster();
    expect(clicker.humor_timer).toBe(0);
    expect(clicker.humor_visible).toBe(true);
  });

  it("computes idle offset via sine wave", () => {
    const clicker = new Clicker();
    const state = st();
    clicker.anim_timer = 0.25;
    clicker.update(0.01, state);
    expect(clicker.idle_offset).not.toBe(0);
  });

  it("removes humor bubble after lifetime", () => {
    const clicker = new Clicker();
    const state = st();
    clicker.humor_visible = true;
    clicker.humor_timer = 0;
    clicker.update(Config.HUMOR_BUBBLE_LIFETIME + 0.1, state);
    expect(clicker.humor_visible).toBe(false);
  });

  it("spawns and removes number pops", () => {
    const clicker = new Clicker();
    clicker.click(st());
    expect(clicker.pops.length >= 1).toBe(true);
    clicker.update(0.016, st());
    expect(clicker.pops.length >= 1).toBe(true);
    for (const pop of clicker.pops) pop.timer = 999;
    clicker.update(0.016, st());
    expect(clicker.pops.length).toBe(0);
  });

  it("animates compression through compressing -> rebounding -> none", () => {
    const clicker = new Clicker();
    const state = st();
    clicker.compression_phase = "compressing";
    clicker.compression_timer = 0;
    clicker.compression_amount = 0.1;
    clicker.update(0.1, state);
    expect(clicker.compression_phase).toBe("rebounding");
    clicker.update(0.2, state);
    expect(clicker.compression_phase).toBe("none");
    expect(clicker.compression_amount).toBe(0);
  });

  it("awards tokens on click (at least TOKEN_PER_CLICK)", () => {
    const clicker = new Clicker();
    const state = st();
    clicker.click(state);
    expect(state.tokens >= Config.TOKEN_PER_CLICK).toBe(true);
  });

  it("accumulates tokens across multiple clicks", () => {
    const clicker = new Clicker();
    const state = st();
    clicker.click(state);
    const t1 = state.tokens;
    clicker.spawn_new_monster();
    clicker.click(state);
    expect(state.tokens > t1).toBe(true);
  });

  it("uses self-referential monster names (Placeholder Slime, Placeholder Goblin)", () => {
    const clicker = new Clicker();
    const names: Record<string, true> = {};
    for (const m of clicker.monsters) names[m.name] = true;
    expect(names["Placeholder Slime"]).toBe(true);
    expect(names["Placeholder Goblin"]).toBe(true);
  });

  it("spawns token pop with cyan color and reduced size", () => {
    const clicker = new Clicker();
    clicker.pops = []; // ensure clean state
    clicker.click(st());
    let token_pop: (typeof clicker.pops)[number] | null = null;
    for (const pop of clicker.pops) {
      if (pop.is_token) {
        token_pop = pop;
        break;
      }
    }
    expect(token_pop).not.toBeNull();
    expect(token_pop!.color).toEqual(Config.POP_COLOR_TOKEN);
    expect(token_pop!.size).toBe(Config.POP_TOKEN_SIZE);
    expect(token_pop!.float_distance).toBe(Config.POP_TOKEN_FLOAT);
    expect(token_pop!.life).toBe(Config.POP_TOKEN_LIFE);
  });

  it("tracks session clicks in state", () => {
    const clicker = new Clicker();
    const state = st({ session_clicks: 0, session_crits: 0 });
    clicker.click(state);
    expect(state.session_clicks).toBe(1);
    clicker.spawn_new_monster();
    clicker.click(state);
    expect(state.session_clicks).toBe(2);
  });

  it("tracks session crits in state when crit occurs", () => {
    const clicker = new Clicker();
    const state = st({ session_clicks: 0, session_crits: 0 });
    // Force crit by setting CRIT_CHANCE to 100; restore in finally so the
    // throw can never leak 100 into later tests.
    const orig_crit = Config.CRIT_CHANCE;
    Config.CRIT_CHANCE = 100;
    try {
      clicker.click(state);
    } finally {
      Config.CRIT_CHANCE = orig_crit;
    }
    expect(state.session_clicks).toBe(1);
    expect(state.session_crits).toBe(1);
  });

  it("increments existing session_clicks counter", () => {
    const clicker = new Clicker();
    const state = st({ session_clicks: 5, session_crits: 0 });
    clicker.click(state);
    expect(state.session_clicks).toBe(6);
  });

  // Phase B: clicks roll the upgrade's crit chance when upgrades are attached.
  // A deterministic roll of 40 sits above the 5% config default and below
  // the upgraded 55%.
  describe("Crit Chance upgrade wiring", () => {
    it("uses the upgrade's crit chance when upgrades are attached", () => {
      const ups = new Upgrades();
      ups.upgrades.crit_chance = 25; // effect_per_level(25) = 5 + 50 = 55%
      const clicker = new Clicker(ups);

      const orig_random = Math.random;
      Math.random = () => 0.39; // roll = floor(0.39*100)+1 = 40
      const state = st({ session_clicks: 0, session_crits: 0 });
      let ok = true;
      try {
        clicker.click(state);
      } catch {
        ok = false;
      } finally {
        Math.random = orig_random;
      }
      expect(ok).toBe(true);
      expect(state.session_crits).toBe(1); // roll 40 crits at 55% upgraded chance
      expect(state.gold).toBe(2); // crit doubles the 1 gold base reward
    });

    it("same roll does NOT crit without the upgrade (config default 5%)", () => {
      const clicker = new Clicker();
      const orig_random = Math.random;
      Math.random = () => 0.39;
      const state = st({ session_clicks: 0, session_crits: 0 });
      let ok = true;
      try {
        clicker.click(state);
      } catch {
        ok = false;
      } finally {
        Math.random = orig_random;
      }
      expect(ok).toBe(true);
      expect(state.session_crits).toBe(0); // roll 40 must not crit at base 5%
    });
  });
});

describe("Humor bubble stage clamping (screenshot-review fix)", () => {
  const stage = { x: 236, y: 60, w: 328, h: 480 };

  it("without a stage the bubble stays centered on the monster", () => {
    const clicker = new Clicker();
    const [x, w] = clicker._clamp_bubble(400, 200);
    expect(x).toBe(300);
    expect(w).toBe(200);
  });

  it("a wide bubble shrinks and slides to stay inside the stage", () => {
    const clicker = new Clicker();
    const [x, w] = clicker._clamp_bubble(280, 500, stage);
    expect(w <= stage.w - 8).toBe(true);
    expect(x >= stage.x + 4 - 0.001).toBe(true);
    expect(x + w <= stage.x + stage.w - 4 + 0.001).toBe(true);
  });

  it("a normal bubble centered on the monster is untouched", () => {
    const clicker = new Clicker();
    const cx = stage.x + stage.w / 2;
    const [x, w] = clicker._clamp_bubble(cx, 200, stage);
    expect(w).toBe(200);
    expect(x).toBe(cx - 100);
  });
});

describe("Humor bubble word-wrap (fit text horizontally)", () => {
  // Stub ctx mirrors main_scene.test.ts: measureText ~7px per char.
  function stub_ctx(): CanvasRenderingContext2D {
    const ctx = {
      measureText: (s: string) => ({ width: String(s).length * 7 }),
    };
    return ctx as unknown as CanvasRenderingContext2D;
  }

  it("keeps a short line on a single row", () => {
    const clicker = new Clicker();
    const lines = clicker._wrap_lines(stub_ctx(), "short line", 200);
    expect(1).toEqual(lines.length);
    expect("short line").toEqual(lines[0]);
  });

  it("wraps words so every row fits the inner width", () => {
    const clicker = new Clicker();
    const text = "alpha beta gamma delta epsilon zeta";
    const lines = clicker._wrap_lines(stub_ctx(), text, 70);
    expect(lines.length > 1).toBe(true);
    for (const line of lines) {
      expect(line.length * 7 <= 70).toBe(true);
    }
    expect(lines.join(" ")).toEqual(text);
  });

  it("an over-long single word still gets its own row", () => {
    const clicker = new Clicker();
    const lines = clicker._wrap_lines(stub_ctx(), "tiny supercalifragilistic word", 40);
    expect(lines.length >= 3).toBe(true);
    expect(lines.join(" ")).toEqual("tiny supercalifragilistic word");
  });
});

describe("Monster sprite draw lane", () => {
  it("falls back to the colored rect when no DOM canvas is available", () => {
    const clicker = new Clicker();
    clicker.humor_visible = false;
    const calls: string[] = [];
    const ctx = {
      calls,
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      translate: () => {},
      fillRect: () => calls.push("fillRect"),
      drawImage: () => calls.push("drawImage"),
      fillText: () => {},
      measureText: (s: string) => ({ width: String(s).length * 7 }),
    } as unknown as CanvasRenderingContext2D;
    clicker.draw(ctx);
    expect(calls.includes("fillRect")).toBe(true); // rect fallback
    expect(calls.includes("drawImage")).toBe(false);
  });

  it("draws the pixel-art sprite via drawImage when a DOM canvas exists", () => {
    const clicker = new Clicker();
    clicker.humor_visible = false;
    const calls: string[] = [];
    const inner_ctx = {
      imageSmoothingEnabled: false,
      putImageData: () => {},
      drawImage: () => {},
    };
    const canvas_stub = { width: 0, height: 0, getContext: () => inner_ctx };
    const doc = { createElement: () => canvas_stub };
    const g = globalThis as { document?: unknown; ImageData?: unknown };
    const prev_doc = g.document;
    const prev_id = g.ImageData;
    g.document = doc;
    g.ImageData = class {
      constructor(_d: unknown, _w: number, _h: number) {}
    };
    const ctx = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      fillRect: () => calls.push("fillRect"),
      drawImage: () => calls.push("drawImage"),
      fillText: () => {},
      measureText: (s: string) => ({ width: String(s).length * 7 }),
    } as unknown as CanvasRenderingContext2D;
    try {
      clicker.draw(ctx);
    } finally {
      g.document = prev_doc;
      g.ImageData = prev_id;
    }
    expect(calls.includes("drawImage")).toBe(true);
    expect(calls.includes("fillRect")).toBe(false);
  });
});

describe("get_kill_progress (FEEL-01/02 pure helper)", () => {
  const ALL_UNLOCKED: Record<string, true> = {
    "Spreadsheet Skeleton": true,
    "Compliance Cyclops": true,
    "Middle-Manager Mimic": true,
  };

  it("(a) bottom clamp: fresh state reports exactly 0.0 toward the first tier", () => {
    const clicker = new Clicker();
    const p = clicker.get_kill_progress(
      st({ exp: 0, exp_thresholds_unlocked: {} }),
    );
    expect(p.mode).toBe("exp");
    expect(p.target).toBe("Spreadsheet Skeleton");
    expect(p.needed).toBe(100);
    expect(p.progress).toBe(0.0);
  });

  it("(b) upper clamp: one step below the active target is in (0.99, 1)", () => {
    const clicker = new Clicker();
    const p = clicker.get_kill_progress(
      st({ exp: 999, exp_thresholds_unlocked: { "Spreadsheet Skeleton": true } }),
    );
    expect(p.target).toBe("Compliance Cyclops");
    expect(p.needed).toBe(1000);
    expect(p.progress > 0.99 && p.progress < 1).toBe(true);
  });

  it("(b2) a raw ratio exceeding 1 never leaks past the clamp", () => {
    const clicker = new Clicker();
    const p = clicker.get_kill_progress(
      st({ exp: 1500, exp_thresholds_unlocked: { "Spreadsheet Skeleton": true } }),
    );
    expect(p.progress).toBe(1.0);
  });

  it("(c) target and needed flip exactly at each threshold crossing", () => {
    const clicker = new Clicker();
    const below = clicker.get_kill_progress(
      st({ exp: 99, exp_thresholds_unlocked: {} }),
    );
    expect(below.target).toBe("Spreadsheet Skeleton");
    expect(below.needed).toBe(100);

    const at = clicker.get_kill_progress(
      st({ exp: 100, exp_thresholds_unlocked: { "Spreadsheet Skeleton": true } }),
    );
    expect(at.target).toBe("Compliance Cyclops");
    expect(at.needed).toBe(1000);
    expect(at.progress).toBe(0.0);

    const below2 = clicker.get_kill_progress(
      st({ exp: 999, exp_thresholds_unlocked: { "Spreadsheet Skeleton": true } }),
    );
    expect(below2.target).toBe("Compliance Cyclops");
    expect(below2.progress > 0.99).toBe(true);

    const at2 = clicker.get_kill_progress(
      st({
        exp: 1000,
        exp_thresholds_unlocked: {
          "Spreadsheet Skeleton": true,
          "Compliance Cyclops": true,
        },
      }),
    );
    expect(at2.target).toBe("Middle-Manager Mimic");
    expect(at2.needed).toBe(6000);

    const below3 = clicker.get_kill_progress(
      st({
        exp: 5999,
        exp_thresholds_unlocked: {
          "Spreadsheet Skeleton": true,
          "Compliance Cyclops": true,
        },
      }),
    );
    expect(below3.target).toBe("Middle-Manager Mimic");
    expect(below3.progress > 0.99 && below3.progress < 1).toBe(true);
  });

  it("(d) purchase mode: all tiers unlocked -> clamped gold over the target cost", () => {
    const clicker = new Clicker();
    clicker.upgrades = {
      next_affordable: () => ["gold_multiplier", 75],
      save_toward: () => null,
    };
    const p = clicker.get_kill_progress(
      st({ exp: 7000, exp_thresholds_unlocked: ALL_UNLOCKED, gold: 37 }),
    );
    expect(p.mode).toBe("purchase");
    expect(p.target).toBe("gold_multiplier");
    expect(p.needed).toBe(75);
    expect(p.progress).toBeCloseTo(37 / 75, 8);
  });

  it("(d2) purchase mode gold above the cost clamps to exactly 1.0", () => {
    const clicker = new Clicker();
    clicker.upgrades = {
      next_affordable: () => ["gold_multiplier", 75],
      save_toward: () => null,
    };
    const p = clicker.get_kill_progress(
      st({ exp: 7000, exp_thresholds_unlocked: ALL_UNLOCKED, gold: 9999 }),
    );
    expect(p.progress).toBe(1.0);
  });

  it("(e) tie-break: two equal-cheapest keys resolve to the pacing-order earlier one", () => {
    // Stand-in for the real next_affordable: walks the pacing order and keeps
    // the first (pacing-earlier) key on exact cost ties.
    const PRIORITY_ORDER = [
      "click_multiplier",
      "unlock_passive",
      "idle_rate",
      "gold_multiplier",
      "exp_multiplier",
      "crit_chance",
    ];
    const costs: Record<string, number> = { gold_multiplier: 100, crit_chance: 100 };
    const clicker = new Clicker();
    clicker.upgrades = {
      next_affordable: () => {
        let bk: string | null = null;
        let bc: number | null = null;
        for (const k of PRIORITY_ORDER) {
          const c = costs[k];
          if (c !== undefined && (bc === null || c < bc)) {
            bc = c;
            bk = k;
          }
        }
        return [bk, bc];
      },
      save_toward: () => null,
    };
    const p = clicker.get_kill_progress(
      st({ exp: 7000, exp_thresholds_unlocked: ALL_UNLOCKED, gold: 50 }),
    );
    expect(p.mode).toBe("purchase");
    expect(p.target).toBe("gold_multiplier"); // earlier than crit_chance
    expect(p.needed).toBe(100);
    expect(p.progress).toBeCloseTo(0.5, 8);
  });

  it("(f) nil-safe: no upgrades + all tiers unlocked yields a guarded purchase shape", () => {
    const clicker = new Clicker();
    const p = clicker.get_kill_progress(
      st({ exp: 7000, exp_thresholds_unlocked: ALL_UNLOCKED, gold: 12 }),
    );
    expect(p.mode).toBe("purchase");
    expect(p.target).toBeNull();
    expect(p.needed).toBeNull();
    expect(p.progress).toBe(0);
  });
});

// FEEL-04: death-fade click buffer. Intents queued while the monster is dead
// are paid exactly once at the respawn flip via the real click() path.
describe("Death-fade click buffer (FEEL-04)", () => {
  // Capture the real RNG before any test stubs it.
  const realRandom = Math.random;
  // Deterministic stub: crit roll -> floor(0.05*100)+1 = 6 (no crit at 5%);
  // pool/line index -> floor(0.05*n) = 0 (valid first index).
  const stubRandom = (): void => {
    Math.random = () => 0.05;
  };

  afterEach(() => {
    Math.random = realRandom;
  });

  it("queues a click while dead, pays it exactly once on respawn", () => {
    stubRandom();
    const clicker = new Clicker();
    const state = st({ session_clicks: 0 });
    clicker.click(state);
    expect(clicker.monster_state).toBe("dead");
    const gold_after_first = state.gold;

    const ev = clicker.buffer_click();
    expect(ev).toBe(0);
    expect(clicker.pending_clicks.length).toBe(1);
    expect(state.gold).toBe(gold_after_first); // buffering must not pay

    // Drive the death fade to completion -> respawn flushes the intent.
    clicker.update(Config.MONSTER_FADE_DURATION + 0.01, state);
    expect(clicker.pending_clicks.length).toBe(0);
    const flushed = clicker.take_flushed_results();
    expect(flushed.length).toBe(1);
    expect(state.gold).toBe(gold_after_first + 1);
    expect(clicker.take_flushed_results().length).toBe(0); // no double-drain
  });

  it("does not flush before the fade completes (no early pay)", () => {
    stubRandom();
    const clicker = new Clicker();
    const state = st();
    clicker.click(state);
    const gold_after_first = state.gold;
    clicker.buffer_click();
    clicker.update(Config.MONSTER_FADE_DURATION * 0.5, state);
    expect(clicker.pending_clicks.length).toBe(1);
    expect(state.gold).toBe(gold_after_first);
  });

  it("evicts the oldest intent when the buffer overflows", () => {
    stubRandom();
    const clicker = new Clicker();
    clicker.click(st());
    const evs: number[] = [];
    for (let i = 0; i < Config.CLICK_BUFFER_CAPACITY + 1; i++) {
      evs.push(clicker.buffer_click());
    }
    expect(clicker.pending_clicks.length).toBe(Config.CLICK_BUFFER_CAPACITY);
    expect(evs[evs.length - 1]).toBe(1); // overflow evicted exactly one
  });

  it("keeps the sacred alive-assert: a direct click on a dead monster still errors", () => {
    const clicker = new Clicker();
    clicker.click(st()); // kill
    expect(() => clicker.click(st())).toThrow();
  });
});

// STATS-01/02: the single payment site also feeds the pure Stats recorder.
describe("Clicker lifetime stats recording (STATS-01/STATS-02)", () => {
  function click_with_crit_rate(rate: number, state: GameState): boolean {
    const orig = Config.CRIT_CHANCE;
    Config.CRIT_CHANCE = rate;
    const clicker = new Clicker();
    let ok = true;
    try {
      clicker.click(state);
    } catch {
      ok = false;
    } finally {
      Config.CRIT_CHANCE = orig;
    }
    expect(ok).toBe(true);
    return ok;
  }

  it("a non-crit paid click bumps stats.clicks and stats.kills once and never crits", () => {
    const state = st({ stats: {} });
    click_with_crit_rate(0, state);
    expect(state.stats.clicks).toBe(1);
    expect(state.stats.kills).toBe(1); // hp 1 area: the click is the kill
    expect(state.stats.crits).toBeUndefined();
    expect(state.session_clicks).toBe(1); // session and lifetime advance 1:1
  });

  it("a crit paid click bumps clicks, kills and crits from the single payment", () => {
    const state = st({ session_clicks: 0, session_crits: 0, stats: {} });
    click_with_crit_rate(100, state);
    expect(state.stats.clicks).toBe(1);
    expect(state.stats.kills).toBe(1);
    expect(state.stats.crits).toBe(1);
    expect(state.session_clicks).toBe(1);
    expect(state.session_crits).toBe(1); // session crits twin of stats.crits
  });

  it("a state without a stats table still pays the click without error (nil-safe hook)", () => {
    const orig = Config.CRIT_CHANCE;
    Config.CRIT_CHANCE = 0;
    const clicker = new Clicker();
    const bare = { gold: 0, exp: 0, tokens: 0 } as unknown as GameState;
    let ok = true;
    try {
      clicker.click(bare);
    } catch {
      ok = false;
    } finally {
      Config.CRIT_CHANCE = orig;
    }
    expect(ok).toBe(true);
  });
});




