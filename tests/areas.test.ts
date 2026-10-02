// tests/areas.test.ts
// Areas ladder: per-area kill targets, milestone-boss advancement, the
// permanent gold multiplier, and the background tint lookup. Pure logic.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import Areas from "../src/systems/areas";
import createState from "../src/state";

describe("Areas definitions", () => {
  it("every area has a name, boss, tint and kill target", () => {
    expect(Config.AREAS.length).toEqual(Config.AREA_KILL_TARGETS.length);
    Config.AREAS.forEach((a, i) => {
      expect(typeof a.name).toBe("string");
      expect(typeof a.boss).toBe("string");
      expect(a.bg.length).toEqual(4);
      expect(Config.AREA_KILL_TARGETS[i] > 0).toBe(true);
    });
  });

  it("every pool name has a bonus def", () => {
    for (const area of Config.AREAS) {
      for (const name of area.pool) {
        const def = Config.WAIFU_BONUS_BY_NAME[name];
        expect(typeof def.bonus_type).toBe("string");
        expect(typeof def.bonus_value).toBe("number");
      }
    }
  });
});

describe("Areas.progress", () => {
  it("fresh state is area 0 with zero kills", () => {
    const p = Areas.progress(createState());
    expect(0).toEqual(p.index);
    expect("Cubicle").toEqual(p.name);
    expect(0).toEqual(p.kills);
    expect(Config.AREA_KILL_TARGETS[0]).toEqual(p.needed);
    expect(0).toEqual(p.progress);
  });

  it("progress is kills/needed clamped to 1", () => {
    const s = createState();
    s.area_index = 1;
    s.area_kills = 5;
    const p = Areas.progress(s);
    expect(1).toEqual(p.index);
    expect(p.progress).toBeCloseTo(5 / Config.AREA_KILL_TARGETS[1], 5);
    s.area_kills = 9999;
    expect(Areas.progress(s).progress <= 1).toBe(true);
  });
});

describe("Areas.on_kill", () => {
  it("increments kills in area and stays put below the target", () => {
    const s = createState();
    Areas.on_kill(s);
    expect(1).toEqual(s.area_kills);
    expect(0).toEqual(s.area_index);
  });

  it("the milestone kill advances the area and resets in-area kills", () => {
    const s = createState();
    s.area_kills = Config.AREA_KILL_TARGETS[0] - 1;
    const msg = Areas.on_kill(s);
    expect(1).toEqual(s.area_index);
    expect(0).toEqual(s.area_kills);
    expect(msg).toBeTruthy();
    expect(msg).toContain("Open Plan");
  });

  it("the final area caps instead of overflowing", () => {
    const s = createState();
    const last = Config.AREAS.length - 1;
    s.area_index = last;
    s.area_kills = Config.AREA_KILL_TARGETS[last];
    Areas.on_kill(s);
    expect(last).toEqual(s.area_index);
  });
});

describe("Areas.gold_multiplier", () => {
  it("is 1 in the first area and grows by the per-clear bonus", () => {
    const s = createState();
    expect(1).toEqual(Areas.gold_multiplier(s));
    s.area_index = 2;
    expect(Areas.gold_multiplier(s)).toBeCloseTo(1 + 2 * Config.AREA_GOLD_BONUS_PER_CLEAR, 5);
  });
});

describe("Areas.area_bg", () => {
  it("falls back to the base BG color before areas exist on a state", () => {
    const s = createState();
    expect(Areas.area_bg(s)).toEqual(Config.BG_COLOR);
    s.area_index = 1;
    expect(Areas.area_bg(s)).toEqual(Config.AREAS[1].bg);
  });
});
