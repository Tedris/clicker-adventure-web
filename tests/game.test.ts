// Game-container wiring tests: boot order (load -> offline -> daily ->
// re-stamp), the autosave round-trip through a storage stub, and the clamped
// update lane. now_fn is injected so nothing depends on the wall clock.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import Game from "../src/game";
import type { StorageLike } from "../src/systems/save";

function memory_storage(): StorageLike & { map: Record<string, string> } {
  const map: Record<string, string> = {};
  return {
    map,
    getItem: (k: string) => map[k] ?? null,
    setItem: (k: string, v: string) => { map[k] = v; },
  };
}

describe("Game.boot", () => {
  it("grants the first-day login reward on a fresh boot", () => {
    const game = new Game(memory_storage(), () => 100000);
    expect(game.state.login_report).not.toBeNull();
    expect(game.state.tokens).toBeGreaterThan(0);
    expect(game.state.login_streak).toBe(1);
  });

  it("round-trips gold through the save on the second boot", () => {
    const store = memory_storage();
    const first = new Game(store, () => 100000);
    first.state.gold = 4242;
    expect(first.save.save(first.state, first.upgrades)).toBe(true);
    const second = new Game(store, () => 100000);
    expect(second.state.gold).toBe(4242);
    // Same UTC day as the first boot: no second login grant.
    expect(second.state.login_streak).toBe(1);
  });

  it("applies offline earnings for an away window on top of the loaded save", () => {
    const store = memory_storage();
    const first = new Game(store, () => 100000);
    first.state.gold = 100;
    first.state.passive_unlocked = true;
    expect(first.save.save(first.state, first.upgrades)).toBe(true);
    const second = new Game(store, () => 100000 + Config.OFFLINE_SKIP_SECONDS + 300);
    const report = second.state.offline_report as Record<string, number> | null;
    expect(report).not.toBeNull();
    expect((report?.seconds ?? 0)).toBe(Config.OFFLINE_SKIP_SECONDS + 300);
    expect(second.state.gold).toBeGreaterThan(100);
  });
});

describe("Game.update", () => {
  it("clamps a long frame gap to MAX_FRAME_DT on the play-time lane", () => {
    const game = new Game(memory_storage(), () => 100000);
    game.update(1);
    game.update(1);
    expect(game.state.stats.play_time ?? 0).toBeLessThanOrEqual(2 * Config.MAX_FRAME_DT + 0.001);
    expect(game.state.stats.play_time ?? 0).toBeGreaterThan(0);
  });
});
