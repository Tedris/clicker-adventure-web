// tests/areas.test.ts
// Areas ladder: per-area gold targets, chest-gated unlocking, the harvest
// pickups, the permanent gold multiplier, and the background tint lookup.
// Pure logic.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import Areas from "../src/systems/areas";
import createState from "../src/state";

describe("Areas definitions", () => {
  it("every area has a name, boss, tint and targets", () => {
    expect(Config.AREAS.length).toEqual(Config.AREA_KILL_TARGETS.length);
    expect(Config.AREAS.length).toEqual(Config.AREA_GOLD_TARGETS.length);
    Config.AREAS.forEach((a, i) => {
      expect(typeof a.name).toBe("string");
      expect(typeof a.boss).toBe("string");
      expect(a.bg.length).toEqual(4);
      expect(Config.AREA_KILL_TARGETS[i] > 0).toBe(true);
      expect(Config.AREA_GOLD_TARGETS[i] > 0).toBe(true);
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
  it("fresh state is area 0 with zero in-area gold", () => {
    const p = Areas.progress(createState());
    expect(0).toEqual(p.index);
    expect("Cubicle").toEqual(p.name);
    expect(0).toEqual(p.kills);
    expect(0).toEqual(p.gold);
    expect(Config.AREA_GOLD_TARGETS[0]).toEqual(p.gold_target);
    expect(0).toEqual(p.progress);
  });

  it("progress is gold/target clamped to 1", () => {
    const s = createState();
    s.area_index = 1;
    s.area_gold = 50;
    const p = Areas.progress(s);
    expect(1).toEqual(p.index);
    expect(p.progress).toBeCloseTo(50 / Config.AREA_GOLD_TARGETS[1], 5);
    s.area_gold = 99999;
    expect(Areas.progress(s).progress <= 1).toBe(true);
  });
});

describe("Areas.on_kill", () => {
  it("increments kills in area and stays put", () => {
    const s = createState();
    Areas.on_kill(s);
    expect(1).toEqual(s.area_kills);
    expect(0).toEqual(s.area_index);
  });

  it("kills cap at the area target instead of overflowing", () => {
    const s = createState();
    const needed = Config.AREA_KILL_TARGETS[0];
    s.area_kills = needed;
    Areas.on_kill(s);
    expect(needed).toEqual(s.area_kills);
    expect(0).toEqual(s.area_index); // kills alone never move the player
  });

  it("the final area caps too", () => {
    const s = createState();
    const last = Config.AREAS.length - 1;
    s.area_index = last;
    s.area_kills = Config.AREA_KILL_TARGETS[last];
    Areas.on_kill(s);
    expect(last).toEqual(s.area_index);
    expect(Config.AREA_KILL_TARGETS[last]).toEqual(s.area_kills);
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

describe("Areas.travel", () => {
  it("walks the position back and forth inside highest_area", () => {
    const s = createState();
    s.area_index = 2;
    s.highest_area = 2;
    expect("Open Plan").toEqual(Areas.travel(s, -1));
    expect(1).toEqual(s.area_index);
    expect(0).toEqual(s.area_kills);
    Areas.travel(s, -1);
    expect(0).toEqual(s.area_index);
    // Walking past the left edge is a no-op that reports null.
    expect(null).toEqual(Areas.travel(s, -1));
    expect(0).toEqual(s.area_index);
  });

  it("never walks ahead of highest_area", () => {
    const s = createState();
    s.area_index = 1;
    s.highest_area = 2;
    Areas.travel(s, 1);
    Areas.travel(s, 1);
    expect(2).toEqual(s.area_index);
    expect(null).toEqual(Areas.travel(s, 1));
  });

  it("resets the in-area gold counter on every move", () => {
    const s = createState();
    s.area_index = 1;
    s.highest_area = 2;
    s.area_gold = 42;
    Areas.travel(s, 1);
    expect(0).toEqual(s.area_gold);
  });

  it("the chest harvest lifts highest_area, walking back keeps the bonus", () => {
    const s = createState();
    s.area_gold = Config.AREA_GOLD_TARGETS[0];
    Areas.harvest(s, "chest");
    expect(1).toEqual(s.highest_area);
    Areas.travel(s, -1);
    expect(0).toEqual(s.area_index);
    // Bonus follows highest_area (1 clear), not the walked-back position.
    expect(Areas.gold_multiplier(s)).toBeCloseTo(1 + Config.AREA_GOLD_BONUS_PER_CLEAR, 5);
  });
});

describe("Areas node hops", () => {
  it("gold boundaries ripe the pickups; harvest pays each once", () => {
    const s = createState();
    const target = Config.AREA_GOLD_TARGETS[0];
    const [b1, b2] = Areas.node_bounds(target);
    // Boundary arithmetic: thirds round up and stay below the full meter.
    expect(b1 < b2 && b2 <= target).toBe(true);

    s.area_gold = b1;
    expect(Areas.harvest(s, "coins")).toBeTruthy();
    expect(null).toEqual(Areas.harvest(s, "coins"));
    s.area_gold = b2;
    expect(Areas.harvest(s, "exp")).toBeTruthy();
    expect(s.total_gold_earned >= Config.AREA_NODE_GOLD).toBe(true);
    expect(s.total_exp_earned >= Config.AREA_NODE_EXP).toBe(true);

    // The chest rides the full meter.
    s.area_gold = target;
    expect(true).toEqual(Areas.next_ready(s));
    expect(Areas.harvest(s, "chest")).toBeTruthy();
    expect(s.total_tokens_earned >= Config.AREA_NODE_TOKENS).toBe(true);
    // Chest harvest laps the area: gold, kills and flags all reset.
    expect(0).toEqual(s.area_gold);
    expect(0).toEqual(s.area_kills);
    expect({}).toEqual(s.area_nodes);
  });

  it("a save loaded past several boundaries still harvests each node once", () => {
    const s = createState();
    s.area_gold = Math.ceil((Config.AREA_GOLD_TARGETS[0] * 2) / 3);
    const gold_before = s.gold;
    expect(Areas.harvest(s, "coins")).toBeTruthy();
    expect(s.gold).toBe(gold_before + Config.AREA_NODE_GOLD);
    expect(Areas.harvest(s, "coins")).toBeNull();
  });
});

describe("Areas.walk_to", () => {
  it("jumps to any unlocked area and resets the in-area counters", () => {
    const s = createState();
    s.highest_area = 3;
    s.area_index = 3;
    s.area_kills = 12;
    s.area_gold = 300;
    expect(Areas.walk_to(s, 1)).toEqual("Open Plan");
    expect(s.area_index).toEqual(1);
    expect(s.area_kills).toEqual(0);
    expect(s.area_gold).toEqual(0);
    // Beyond the unlocked frontier clamps; same-spot jumps report null.
    expect(Areas.walk_to(s, 99)).toEqual("Conference Room");
    expect(s.area_index).toEqual(3);
    expect(Areas.walk_to(s, 3)).toBeNull();
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

describe("Areas.monster_hp", () => {
  it("climbs with the area ladder", () => {
    const s = createState();
    expect(Config.AREA_MONSTER_HP[0]).toEqual(Areas.monster_hp(s));
    s.area_index = 2;
    expect(Config.AREA_MONSTER_HP[2]).toEqual(Areas.monster_hp(s));
    expect(true).toEqual(Areas.next_ready({ area_index: 2, area_gold: Config.AREA_GOLD_TARGETS[2] }));
    expect(false).toEqual(Areas.next_ready({ area_index: 2, area_gold: Config.AREA_GOLD_TARGETS[2] - 1 }));
    // Hand-built junk indices clamp instead of crashing.
    expect(Areas.monster_hp({ area_index: 99, area_kills: 0 })).toEqual(
      Config.AREA_MONSTER_HP[Config.AREA_MONSTER_HP.length - 1],
    );
  });
});

describe("Areas.harvest", () => {
  it("a ripe Coin pile pays once and a second tap is inert", () => {
    const s = createState();
    s.area_gold = Math.ceil(Config.AREA_GOLD_TARGETS[0] / 3);
    const gold_before = s.gold;
    const msg = Areas.harvest(s, "coins");
    expect(msg).toBeTruthy();
    expect(s.gold).toBe(gold_before + Config.AREA_NODE_GOLD);
    // The pile burst also feeds the area's own meter.
    expect(s.area_gold).toBe(Math.ceil(Config.AREA_GOLD_TARGETS[0] / 3) + Config.AREA_NODE_GOLD);
    expect(null).toEqual(Areas.harvest(s, "coins"));
  });

  it("a pending node never pays", () => {
    const s = createState();
    expect(null).toEqual(Areas.harvest(s, "exp"));
    expect(null).toEqual(Areas.harvest(s, "coins"));
    expect(0).toEqual(s.exp);
  });

  it("travel resets the harvest flags for the new area", () => {
    const s = createState();
    s.area_gold = Math.ceil(Config.AREA_GOLD_TARGETS[0] / 3);
    Areas.harvest(s, "coins");
    s.highest_area = 1;
    Areas.travel(s, 1);
    expect({}).toEqual(s.area_nodes);
    // Fresh area, fresh Coin pile: ripe right away at its own boundary.
    s.area_gold = Math.ceil(Config.AREA_GOLD_TARGETS[1] / 3);
    expect(Areas.harvest(s, "coins")).toBeTruthy();
  });
});
