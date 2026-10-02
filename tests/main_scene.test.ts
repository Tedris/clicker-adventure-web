// Canvas-UI wiring tests: MainScene hit-testing, toast lanes, modal flow and
// the two-step confirmations. A stub 2d context records calls only — draw
// paths just need to survive with plain data.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import Layout from "../src/ui/layout";
import createState, { type GameState } from "../src/state";
import Upgrades from "../src/systems/upgrades";
import Clicker from "../src/systems/clicker";
import Gacha from "../src/systems/gacha";
import Waifu from "../src/systems/waifu";
import MainScene from "../src/ui/main_scene";

function stub_ctx(): CanvasRenderingContext2D {
  const calls: string[] = [];
  const ctx = {
    calls,
    fillRect: () => calls.push("fillRect"),
    fillText: (s: string) => calls.push("fillText:" + s),
    strokeRect: () => calls.push("strokeRect"),
    beginPath: () => calls.push("beginPath"),
    arc: () => calls.push("arc"),
    rect: () => calls.push("rect"),
    clip: () => calls.push("clip"),
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    measureText: (s: string) => ({ width: String(s).length * 7 }),
    drawImage: () => calls.push("drawImage"),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    translate: () => calls.push("translate"),
    setTransform: () => calls.push("setTransform"),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function rigged_random(max?: number): number {
  // Deterministic seam: argless call -> [0,1) under base rate so the pull
  // always succeeds; indexed call -> a valid 1-based pool slot; rarity roll
  // shares the argless shape.
  if (max === undefined) return 0.01;
  return Math.floor(max / 2) + 1;
}

function make_scene(state: GameState): MainScene {
  const upgrades = new Upgrades();
  return new MainScene({
    clicker: new Clicker(upgrades),
    upgrades,
    gacha: new Gacha(rigged_random),
    waifu: new Waifu(() => 0.5),
  });
}

describe("MainScene.draw", () => {
  it("renders HUD, monster area and rail without throwing", () => {
    const state = createState();
    state.gold = 50;
    const scene = make_scene(state);
    scene.load(state);
    const ctx = stub_ctx();
    scene.draw(ctx, state, Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    const recorded = (ctx as unknown as { calls: string[] }).calls.join("|");
    expect(recorded).toContain("fillText");
    expect(recorded).toContain("fillRect");
  });
});

describe("MainScene.draw area line", () => {
  it("shows the current area and in-area gold under the meter", () => {
    const state = createState();
    const scene = make_scene(state);
    scene.load(state);
    const ctx = stub_ctx();
    scene.draw(ctx, state, Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    const recorded = (ctx as unknown as { calls: string[] }).calls.join("|");
    expect(recorded).toContain(`Area 1: Cubicle · 0/${Config.AREA_GOLD_TARGETS[0]} gold`);
  });

  it("announces the Treasure Chest once the gold meter is full", () => {
    const state = createState();
    state.area_gold = Config.AREA_GOLD_TARGETS[0];
    const scene = make_scene(state);
    scene.load(state);
    const ctx = stub_ctx();
    scene.draw(ctx, state, Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    const recorded = (ctx as unknown as { calls: string[] }).calls.join("|");
    expect(recorded).toContain("Treasure ready!");
  });
});

describe("MainScene.mousepressed", () => {
  it("clicking the monster awards gold through Clicker", () => {
    const state = createState();
    const scene = make_scene(state);
    scene.load(state);
    const hit = scene.mousepressed(Config.WINDOW_WIDTH / 2, Config.WINDOW_HEIGHT / 2);
    expect(hit).toBe(true);
    expect(state.gold).toBeGreaterThan(0);
  });

  it("Pull spends tokens and opens the summon screen", () => {
    const state = createState();
    state.tokens = Config.PULL_COST;
    const scene = make_scene(state);
    scene.load(state);
    const b = Layout.bar_items(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    scene.mousepressed(b.pull.x + b.pull.w / 2, b.pull.y + b.pull.h / 2);
    // The pull itself pays PULL_COST; badge rewards for first_pull can add
    // tokens back, so assert the spend happened via the roster growing.
    expect(state.waifus.length).toBe(1);
    expect(scene.showing_pull_screen).toBe(true);
  });

  it("a broke pull explains itself in the fail lane instead of a dead click", () => {
    const state = createState();
    const scene = make_scene(state);
    scene.load(state);
    const b = Layout.bar_items(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    scene.mousepressed(b.pull.x + b.pull.w / 2, b.pull.y + b.pull.h / 2);
    expect(scene.pull_fail_message).toContain(String(Config.PULL_COST));
    expect(scene.showing_pull_screen).toBe(false);
  });

  it("the first reset click arms, a click elsewhere disarms, two clicks reset", () => {
    const state = createState();
    state.gold = 10;
    const scene = make_scene(state);
    scene.load(state);
    const b = Layout.bar_items(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    scene.mousepressed(b.reset.x + b.reset.w / 2, b.reset.y + b.reset.h / 2);
    expect(scene.reset_armed).toBe(true);
    scene.mousepressed(b.sess.x + 1, b.sess.y + 1);
    expect(scene.reset_armed).toBe(false);
    scene.mousepressed(b.reset.x + b.reset.w / 2, b.reset.y + b.reset.h / 2);
    scene.mousepressed(b.reset.x + b.reset.w / 2, b.reset.y + b.reset.h / 2);
    expect(state.gold).toBe(0);
  });
});

describe("MainScene toasts, modals and input lanes", () => {
  it("the first click on a welcome-back modal dismisses both reports and toasts the grants", () => {
    const state = createState();
    state.offline_report = { seconds: 90, gold: 12, exp: 5, tokens: 2 };
    const scene = make_scene(state);
    scene.load(state);
    scene.mousepressed(10, 10);
    expect(state.offline_report).toBeNull();
    expect(scene.event_toast_message).toContain("+12");
    expect(scene.event_toast_timer).toBeGreaterThan(0);
  });

  it("a roster card click opens the waifu overlay and any click closes it", () => {
    const state = createState();
    state.waifus = [{ name: "Karen", rarity: "common", bonus_type: "gold", bonus_value: 0.1 } as never];
    const scene = make_scene(state);
    scene.load(state);
    const rail = Layout.zones(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT).rail_r;
    const slot = Layout.roster_slot(rail, Layout.roster_grid(rail.w, rail.h, 1), 1, 0);
    scene.mousepressed(slot.x + slot.w / 2, slot.y + slot.h / 2);
    expect(scene.waifu_detail_index).toBe(1);
    scene.mousepressed(slot.x + slot.w / 2, slot.y + slot.h / 2);
    expect(scene.waifu_detail_index).toBeNull();
  });

  it("wheel scrolls the stats list only while the stats modal is open", () => {
    const state = createState();
    const scene = make_scene(state);
    scene.load(state);
    scene.stats_panel_open = true;
    scene.wheelmoved(0, -120, 400, 300);
    expect(scene.stats_scroll_offset).toBeGreaterThan(0);
    scene.stats_panel_open = false;
    const before = scene.stats_scroll_offset;
    scene.wheelmoved(0, -120, 400, 300);
    expect(scene.stats_scroll_offset).toBe(before);
  });

  it("keypressed s toggles the session stats overlay", () => {
    const scene = make_scene(createState());
    scene.load(createState());
    expect(scene.show_session_stats).toBe(false);
    scene.keypressed("s");
    expect(scene.show_session_stats).toBe(true);
    scene.keypressed("s");
    expect(scene.show_session_stats).toBe(false);
  });

  it("any key closes an open report modal before reaching the debug lane", () => {
    const state = createState();
    state.login_report = { day: 3, tokens: 2 };
    const scene = make_scene(state);
    scene.load(state);
    scene.keypressed("x");
    expect(state.login_report).toBeNull();
    expect(scene.show_session_stats).toBe(false);
  });
});

describe("MainScene rail collapse tabs", () => {
  function tab_center(side: "left" | "right", collapsed: { left?: boolean; right?: boolean }): [number, number] {
    const z = Layout.zones(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT, collapsed);
    const t = Layout.rail_tab(side === "left" ? z.rail_l : z.rail_r, side);
    return [t.x + t.w / 2, t.y + t.h / 2];
  }

  it("a chevron tap collapses its rail and a second tap expands it", () => {
    const scene = make_scene(createState());
    scene.load(createState());
    let [x, y] = tab_center("left", {});
    scene.mousepressed(x, y);
    expect(scene.left_collapsed).toBe(true);
    expect(scene.right_collapsed).toBe(false);
    [x, y] = tab_center("left", { left: true });
    scene.mousepressed(x, y);
    expect(scene.left_collapsed).toBe(false);
  });

  it("while collapsed, any tap on the strip expands the rail", () => {
    const scene = make_scene(createState());
    scene.load(createState());
    scene.right_collapsed = true;
    const z = Layout.zones(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT, { right: true });
    scene.mousepressed(z.rail_r.x + 4, z.rail_r.y + 120);
    expect(scene.right_collapsed).toBe(false);
  });

  it("a tab click never falls through to the monster or the bar", () => {
    const state = createState();
    const scene = make_scene(state);
    scene.load(state);
    const gold_before = state.gold;
    const [x, y] = tab_center("right", {});
    const hit = scene.mousepressed(x, y);
    expect(hit).toBe(true);
    expect(state.gold).toEqual(gold_before);
  });
});

describe("Waifu detail text wrapping", () => {
  it("every drawn row fits the detail panel's inner column", () => {
    const state = createState();
    state.waifus = [{
      name: "Karen the Accountant", rarity: "rare", bonus_type: "gold", bonus_value: 0.15,
    } as never];
    const scene = make_scene(state);
    scene.load(state);
    scene.waifu_detail_index = 1;
    const ctx = stub_ctx();
    scene.draw(ctx, state, Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    const d = Layout.waifu_detail(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    const calls = (ctx as unknown as { calls: string[] }).calls;
    const texts = calls.filter((c) => c.startsWith("fillText:")).map((c) => c.slice("fillText:".length));
    // Compare only the overlay's own rows (from the title onward).
    const overlay = texts.slice(texts.indexOf("Karen the Accountant"));
    expect(overlay.length >= 6).toBe(true); // rarity/bonus/skill + wrapped flavor
    for (const t of overlay) {
      // stub measureText = chars * 7: every row must fit the inner column
      expect(t.length * 7 <= d.inner.w + 0.001).toBe(true);
    }
    // the wrapped flavor really was split into multiple rows
    expect(overlay.some((t) => t.startsWith('"Keeps her feelings'))).toBe(true);
  });
});

describe("Area menu modal and equip lanes", () => {
  function sized_scene(state: GameState): MainScene {
    const scene = make_scene(state);
    scene.load(state);
    scene.draw(stub_ctx(), state, Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    return scene;
  }

  it("empty stage space falls through instead of opening the menu", () => {
    const state = createState();
    const scene = sized_scene(state);
    const z = Layout.zones(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    const meter = Layout.meter_rect(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    // Mid-strip between the chevrons, below the monster hitbox: a dead click
    // now falls through — the Areas button is the one menu entry point.
    const x = z.stage.x + Math.floor(z.stage.w / 2);
    const y = Math.min(z.bar.y - 6, meter.y + meter.h + 40);
    expect(scene.mousepressed(x, y)).toBe(false);
    expect(scene.area_menu_open).toBe(false);
  });

  it("chips walk the position and stay open; an outside tap closes", () => {
    const state = createState();
    state.highest_area = 2;
    state.area_index = 2;
    state.area_kills = 5;
    const scene = sized_scene(state);
    scene.area_menu_open = true;
    const m = Layout.area_menu(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT, state.highest_area + 1);
    expect(m.chips.length).toBe(3);
    const c = m.chips[0];
    expect(scene.mousepressed(c.x + 1, c.y + 1)).toBe(true);
    expect(state.area_index).toBe(0);
    expect(state.area_kills).toBe(0);
    expect(scene.area_menu_open).toBe(true); // chip taps keep the menu open
    expect(scene.mousepressed(2, 2)).toBe(true);
    expect(scene.area_menu_open).toBe(false);
  });

  it("the detail overlay's assign button toggles the current-area lane", () => {
    const state = createState();
    state.waifus = [{ name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.1, rarity: "rare" }];
    const scene = sized_scene(state);
    scene.waifu_detail_index = 1;
    scene.draw(stub_ctx(), state, Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    const btn = scene._equip_btn();
    const cx = btn.x + Math.floor(btn.w / 2);
    const cy = btn.y + Math.floor(btn.h / 2);
    expect(scene.mousepressed(cx, cy)).toBe(true);
    expect(state.assignments?.[0]).toEqual(["Karen the Accountant"]);
    expect(scene.waifu_detail_index).toBe(1); // button keeps the overlay open
    expect(scene.mousepressed(cx, cy)).toBe(true);
    expect(state.assignments?.[0]).toEqual([]);
  });

  it("the header Areas button opens and closes the zone menu", () => {
    const state = createState();
    const scene = sized_scene(state);
    const a = Layout.bar_items(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT).areas;
    const cx = a.x + Math.floor(a.w / 2);
    const cy = a.y + Math.floor(a.h / 2);
    expect(scene.mousepressed(cx, cy)).toBe(true);
    expect(scene.area_menu_open).toBe(true);
    expect(scene.mousepressed(cx, cy)).toBe(true); // second tap closes
    expect(scene.area_menu_open).toBe(false);
  });

  it("assigned hires deal automatic damage on the update tick", () => {
    const state = createState();
    state.waifus = [{ name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.1, rarity: "rare" }];
    state.assignments = { 0: ["Karen the Accountant"] };
    const scene = sized_scene(state);
    const kills_before = state.area_kills;
    scene.update(Config.AUTO_KILL_TICK + 0.01);
    expect(state.area_kills).toBe(kills_before + 1); // one ally, one kill/sec
  });

  it("tapping a ripe Coin pile spot harvests it once", () => {
    const state = createState();
    state.area_gold = Math.ceil(Config.AREA_GOLD_TARGETS[0] / 3); // coins ripe
    const scene = sized_scene(state);
    const s = Layout.pickup_spots(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT).coins;
    const cx = s.x + Math.floor(s.w / 2);
    const cy = s.y + Math.floor(s.h / 2);
    expect(scene.mousepressed(cx, cy)).toBe(true);
    expect(state.gold >= Config.AREA_NODE_GOLD).toBe(true);
    const gold = state.gold;
    expect(scene.mousepressed(cx, cy)).toBe(true); // already harvested
    expect(state.gold).toBe(gold);
  });

  it("tapping the ripe Treasure Chest unlocks the next area", () => {
    const state = createState();
    state.area_gold = Config.AREA_GOLD_TARGETS[0]; // full meter
    const scene = sized_scene(state);
    const s = Layout.pickup_spots(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT).chest;
    expect(scene.mousepressed(s.x + 9, s.y + 7)).toBe(true);
    expect(state.tokens >= Config.AREA_NODE_TOKENS).toBe(true);
    expect(state.highest_area).toBe(1); // unlocked, not automatic
    expect(state.area_index).toBe(0);
  });

  it("duplicate hires merge into one card with an xN badge", () => {
    const state = createState();
    state.waifus = [
      { name: "Dave from IT", bonus_type: "tokens", bonus_value: 0.12, rarity: "common" },
      { name: "Dave from IT", bonus_type: "tokens", bonus_value: 0.15, rarity: "rare" },
    ];
    const scene = sized_scene(state);
    const groups = scene._roster_groups();
    expect(groups.length).toBe(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].waifu.bonus_value).toBeCloseTo(0.15, 5); // best copy represents
    const ctx = stub_ctx();
    scene.draw(ctx, state, Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
    const texts = (ctx as unknown as { calls: string[] }).calls
      .filter((c) => c.startsWith("fillText:")).map((c) => c.slice("fillText:".length));
    expect(texts).toContain("Waifus (1)");
    expect(texts).toContain("x2");
  });
});
