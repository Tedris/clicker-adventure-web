// tests/debug.test.ts
// Vitest port of tests/test_debug.lua for the debug harness.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Config from "../src/config";
import { createState, type GameState } from "../src/state";
import Debug, { type DebugClickerLike, type DebugGameLike } from "../src/systems/debug";

type StubClicker = DebugClickerLike & { click_count: number; buffer_count: number };

function makeGame(): DebugGameLike {
  const state = createState();
  state.gold = 100;
  state.exp = 50;
  state.tokens = 10;
  const clicker: StubClicker = {
    monster_state: "alive",
    click_count: 0,
    buffer_count: 0,
    update() { /* no-op tick */ },
    click(st: GameState) { this.click_count += 1; st.gold = st.gold + 1; },
    buffer_click() { this.buffer_count += 1; },
  };
  return { state, clicker };
}

function stub(game: DebugGameLike): StubClicker {
  return game.clicker as StubClicker;
}

describe("Debug Module", () => {
  describe("Initialization", () => {
    it("creates a debug instance with default values", () => {
      const dbg = new Debug(makeGame());
      expect(dbg).not.toBe(null);
      expect(dbg.speed_multiplier).toBe(1);
      expect(dbg.auto_clicker_enabled).toBe(false);
      expect(dbg.rng_seed).toBe(null);
      expect(dbg.total_clicks).toBe(0);
      expect(dbg.elapsed_time).toBe(0);
    });
  });

  describe("Speed control (AC1)", () => {
    it("sets speed to valid values", () => {
      const dbg = new Debug(makeGame());
      dbg.setSpeed(2); expect(dbg.getSpeed()).toBe(2);
      dbg.setSpeed(5); expect(dbg.getSpeed()).toBe(5);
      dbg.setSpeed(10); expect(dbg.getSpeed()).toBe(10);
      dbg.setSpeed(50); expect(dbg.getSpeed()).toBe(50);
      dbg.setSpeed(1); expect(dbg.getSpeed()).toBe(1);
    });

    it("rejects invalid speed values", () => {
      const dbg = new Debug(makeGame());
      dbg.setSpeed(2);
      dbg.setSpeed(100); expect(dbg.getSpeed()).toBe(2);
      dbg.setSpeed(-1); expect(dbg.getSpeed()).toBe(2);
      dbg.setSpeed(3); expect(dbg.getSpeed()).toBe(2);
    });
  });

  describe("Auto-clicker (AC2)", () => {
    it("enables and disables auto-clicker", () => {
      const dbg = new Debug(makeGame());
      expect(dbg.getAutoClick()).toBe(false);
      dbg.setAutoClick(true); expect(dbg.getAutoClick()).toBe(true);
      dbg.setAutoClick(false); expect(dbg.getAutoClick()).toBe(false);
    });
  });

  describe("Resource injection (AC3)", () => {
    it("injects gold, exp and tokens into state", () => {
      const game = makeGame();
      const dbg = new Debug(game);
      dbg.addGold(50); expect(game.state.gold).toBe(150);
      dbg.addExp(100); expect(game.state.exp).toBe(150);
      dbg.addTokens(5); expect(game.state.tokens).toBe(15);
    });

    it("validates positive amounts", () => {
      const dbg = new Debug(makeGame());
      expect(() => dbg.addGold(-1)).toThrow();
      expect(() => dbg.addGold(0)).toThrow();
      expect(() => dbg.addGold("ten" as unknown as number)).toThrow();
      expect(() => dbg.addExp(-1)).toThrow();
      expect(() => dbg.addTokens(0)).toThrow();
    });
  });

  describe("Seeded RNG (AC4)", () => {
    function draws(seed: number): number[] {
      const dbg = new Debug(makeGame());
      dbg.seedRandom(seed);
      const out: number[] = [];
      for (let i = 0; i < 5; i++) out.push(dbg.next_random());
      return out;
    }

    it("seeds and returns RNG seed", () => {
      const dbg = new Debug(makeGame());
      dbg.seedRandom(42);
      expect(dbg.getSeed()).toBe(42);
    });

    it("validates seed is a number", () => {
      const dbg = new Debug(makeGame());
      expect(() => dbg.seedRandom("abc" as unknown as number)).toThrow();
    });

    it("produces deterministic results with same seed", () => {
      expect(draws(123)).toEqual(draws(123));
    });
  });

  describe("State snapshot (AC5)", () => {
    it("returns a copy of the state table", () => {
      const game = makeGame();
      const dbg = new Debug(game);
      const snapshot = dbg.getState();
      expect(snapshot).not.toBe(null);
      expect(snapshot.gold).toBe(game.state.gold);
      expect(snapshot.exp).toBe(game.state.exp);
    });

    it("returns a shallow copy (modifications to snapshot do not affect state)", () => {
      const game = makeGame();
      const dbg = new Debug(game);
      const snapshot = dbg.getState();
      snapshot.gold = 9999;
      expect(game.state.gold).toBe(100);
    });
  });

  describe("Scaled dt (AC1 integration)", () => {
    it("returns unscaled dt at 1x speed", () => {
      const dbg = new Debug(makeGame());
      dbg.setSpeed(1);
      dbg.update(0.016);
      expect(dbg.getScaledDt()).toBeCloseTo(0.016);
    });

    it("returns scaled dt at 10x speed", () => {
      const dbg = new Debug(makeGame());
      dbg.setSpeed(10);
      dbg.update(0.016);
      expect(dbg.getScaledDt()).toBeCloseTo(0.16);
    });

    it("returns scaled dt at 50x speed", () => {
      const dbg = new Debug(makeGame());
      dbg.setSpeed(50);
      dbg.update(0.016);
      expect(dbg.getScaledDt()).toBeCloseTo(0.8);
    });

    it("tracks elapsed time", () => {
      const dbg = new Debug(makeGame());
      dbg.setSpeed(2);
      dbg.update(0.016);
      expect(dbg.elapsed_time).toBeCloseTo(0.032);
      dbg.update(0.016);
      expect(dbg.elapsed_time).toBeCloseTo(0.064);
    });
  });

  describe("Auto-clicker simulation", () => {
    it("calls clicker:click when enabled and monster is alive", () => {
      const game = makeGame();
      const dbg = new Debug(game);
      dbg.setAutoClick(true);
      dbg.setSpeed(1);
      dbg.update(0.016);
      expect(stub(game).click_count).toBe(1);
      dbg.update(0.016);
      expect(stub(game).click_count).toBe(2);
    });

    it("does not call clicker:click when disabled", () => {
      const game = makeGame();
      const dbg = new Debug(game);
      dbg.setAutoClick(false);
      dbg.update(0.016);
      expect(stub(game).click_count).toBe(0);
    });

    it("does not call clicker:click when monster is dead", () => {
      const game = makeGame();
      stub(game).monster_state = "dead";
      const dbg = new Debug(game);
      dbg.setAutoClick(true);
      dbg.update(0.016);
      expect(stub(game).click_count).toBe(0);
    });

    it("routes dead-window auto-clicks into the clicker buffer (FEEL-04)", () => {
      const game = makeGame();
      stub(game).monster_state = "dead";
      const dbg = new Debug(game);
      dbg.setAutoClick(true);
      dbg.update(0.016);
      expect(stub(game).click_count, "dead-window auto-click must not call click() directly").toBe(0);
      expect(stub(game).buffer_count, "dead-window auto-click must reach the buffer").toBe(1);
    });
  });

  describe("Offline/daily simulation hooks", () => {
    it("simulateOffline credits capped passive income and shows a report", () => {
      const game = makeGame();
      game.state.passive_unlocked = true;
      game.state.last_save_time = Math.floor(Date.now() / 1000) - 120;
      const dbg = new Debug(game);
      const report = dbg.simulateOffline(120)!;
      expect(report.seconds >= 120).toBe(true);
      expect(report.seconds <= Config.OFFLINE_TOKEN_CAP_SECONDS).toBe(true);
      expect(game.state.tokens).toBe(10 + report.tokens);
      expect(game.state.gold).toBe(100 + report.gold);
      expect(game.state.offline_report).not.toBe(null);
    });

    it("simulateOffline rejects non-positive durations", () => {
      const dbg = new Debug(makeGame());
      expect(() => dbg.simulateOffline(0)).toThrow();
      expect(() => dbg.simulateOffline(-5)).toThrow();
    });
  });

  describe("Key bindings", () => {
    beforeEach(() => { Config.DEBUG_MODE = true; });
    afterEach(() => { Config.DEBUG_MODE = false; });

    it("handles F5/F6/F7/F8 to set speeds", () => {
      const dbg = new Debug(makeGame());
      dbg.keypressed("f5"); expect(dbg.getSpeed()).toBe(2);
      dbg.keypressed("f6"); expect(dbg.getSpeed()).toBe(5);
      dbg.keypressed("f7"); expect(dbg.getSpeed()).toBe(10);
      dbg.keypressed("f8"); expect(dbg.getSpeed()).toBe(50);
    });

    it("toggles auto-clicker on left shift", () => {
      const dbg = new Debug(makeGame());
      dbg.keypressed("lshift"); expect(dbg.getAutoClick()).toBe(true);
      dbg.keypressed("lshift"); expect(dbg.getAutoClick()).toBe(false);
    });

    it("F9 queues a daily login report through the live Daily path", () => {
      const game = makeGame();
      const dbg = new Debug(game);
      game.state.last_login_day = 0;
      game.state.login_streak = 0;
      dbg.keypressed("f9");
      expect(game.state.login_report).not.toBe(null);
      expect(game.state.login_streak).toBe(1);
      expect(game.state.login_report!.day).toBe(1);
      expect(game.state.login_report!.tokens).toBe(Config.DAILY_LOGIN_REWARDS[0]);
    });
  });

  describe("Config constants", () => {
    it("has debug overlay constants defined", () => {
      expect(Config.DEBUG_OVERLAY_X).not.toBe(null);
      expect(Config.DEBUG_OVERLAY_Y).not.toBe(null);
      expect(Config.DEBUG_OVERLAY_COLOR).not.toBe(null);
      expect(Config.DEBUG_OVERLAY_SIZE).not.toBe(null);
    });

    it("overlay color has alpha component", () => {
      expect(Config.DEBUG_OVERLAY_COLOR.length).toBe(4);
      expect(Config.DEBUG_OVERLAY_COLOR[0]).toBe(255);
      expect(Config.DEBUG_OVERLAY_COLOR[1]).toBe(255);
      expect(Config.DEBUG_OVERLAY_COLOR[2]).toBe(255);
    });
  });

  describe("Boot entropy mix (FEEL-05)", () => {
    it("keeps sub-second authority in BOTH inputs", () => {
      const base = Debug.entropy_seed(1.0, 2.0);
      const timerShift = Debug.entropy_seed(1.000001, 2.0);
      const clockShift = Debug.entropy_seed(1.0, 2.000001);
      for (const v of [base, timerShift, clockShift]) {
        expect(typeof v).toBe("number");
        expect(Number.isInteger(v), "seed must be an integer").toBe(true);
        expect(v >= 0, "seed must be non-negative").toBe(true);
      }
      expect(timerShift).not.toBe(base);
      expect(clockShift).not.toBe(base);
      expect(clockShift).not.toBe(timerShift);
    });

    it("same-second relaunch proxy: successive timer values under fixed clock are pairwise distinct", () => {
      const seeds: number[] = [];
      for (let i = 0; i < 5; i++) seeds.push(Debug.entropy_seed(10 + i * 0.001, 5.5));
      for (let i = 0; i < seeds.length; i++) {
        for (let j = i + 1; j < seeds.length; j++) {
          expect(seeds[j]).not.toBe(seeds[i]);
        }
      }
    });

    it("override pin: reseed-twice with a pinned value reproduces the same draw sequence", () => {
      const k = 424242;
      expect(drawsFor(k)).toEqual(drawsFor(k));
      const dbg = new Debug(makeGame());
      dbg.seedRandom(k);
      expect(dbg.getSeed()).toBe(k);
    });
  });

  describe("Overlay readout for the UI", () => {
    it("exposes plain overlay lines (draw-free)", () => {
      const dbg = new Debug(makeGame());
      dbg.setSpeed(2);
      dbg.update(0.016);
      const lines = dbg.overlay_lines();
      expect(lines[0]).toBe("Speed: 2x");
      expect(lines[1]).toBe("Tick: 0.032s");
      expect(lines[2]).toBe("Auto-Click: OFF");
      expect(lines[4]).toMatch(/^Time: \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("Auto-clicker single counting with the real Clicker (TECH-02)", () => {
    function makeRealClickerGame(): DebugGameLike {
      const game = makeGame();
      game.clicker = {
        monster_state: "alive",
        update() { /* real Clicker tick is irrelevant here */ },
        click(st: GameState) {
          // The single payment site: session AND lifetime ride this one bump.
          st.session_clicks += 1;
          st.stats.clicks = (st.stats.clicks ?? 0) + 1;
        },
      };
      return game;
    }

    it("one debug tick with an alive monster counts the auto-click exactly once", () => {
      const game = makeRealClickerGame();
      const dbg = new Debug(game);
      dbg.setAutoClick(true);
      dbg.update(0.016);
      expect(game.state.session_clicks, "Clicker:click is the sole session counter").toBe(1);
      expect(game.state.stats.clicks, "the lifetime counter rides the same single payment path").toBe(1);
      expect(game.state.stats.clicks).toBe(game.state.session_clicks);
    });

    it("Debug keeps its own independent telemetry counter", () => {
      const game = makeRealClickerGame();
      const dbg = new Debug(game);
      dbg.setAutoClick(true);
      dbg.update(0.016);
      expect(dbg.total_clicks, "Debug-owned total_clicks stays bumped from the tick site").toBe(1);
    });
  });
});

function drawsFor(seed: number): number[] {
  const dbg = new Debug(makeGame());
  dbg.seedRandom(seed);
  const out: number[] = [];
  for (let i = 0; i < 12; i++) out.push(dbg.next_random());
  return out;
}



