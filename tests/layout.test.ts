// tests/layout.test.ts
// Vitest port of tests/test_layout.lua — the permanent "nothing clips or
// overlaps at any window size" lint for src/ui/layout.ts. Pure geometry:
// zones/bar/fit/grid/slot must be window-derived, never exceed the window,
// never collide, and reproduce the 800x600 design geometry where the old
// fixed constants agreed with it.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import Layout from "../src/ui/layout";

// All sizes must at least satisfy the configured min window; plus one size
// exactly at the minimum and one very short window. Phone landscape rows at
// ~2.06:1 (Phase 15 DISP-01) ride the same sweep: Layout derives live from
// ww/wh, so every rect must stay contained and ordered there too.
const SIZES: Array<[number, number]> = [
  [Config.LAYOUT_MIN_WIDTH, Config.LAYOUT_MIN_HEIGHT],
  [640, 420], [800, 600], [1024, 768], [1152, 864], [1920, 1080], [900, 380],
  [740, 360], [870, 420], [960, 480],
];

function within(r: { x: number; y: number; w: number; h: number }, ww: number, wh: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= ww && r.y + r.h <= wh;
}

describe("Layout zones", () => {
  it("reproduces the 800x600 design geometry where it was sane", () => {
    const z = Layout.zones(800, 600);
    expect(16).toEqual(z.hud.x);
    expect(16).toEqual(z.hud.y);
    expect(800 - 32).toEqual(z.hud.w);
    expect(Config.HUD_PANEL_HEIGHT).toEqual(z.hud.h);
    expect(600 - Config.BOTTOM_BAR_HEIGHT).toEqual(z.bar.y);
    expect(80).toEqual(z.content_top);
    expect(604).toEqual(z.rail_r.x);
    expect(Config.LAYOUT_MARGIN).toEqual(z.rail_l.x);
    // Left rail retired: the stage only loses the roster rail's width now.
    expect(800 - Config.LAYOUT_MARGIN * 2 - Config.ROSTER_PANEL_WIDTH).toEqual(z.stage.w);
    expect(Config.ROSTER_PANEL_WIDTH).toEqual(z.rail_r.w);
    expect(z.bar.y - 80).toEqual(z.rail_r.h);
    expect(z.rail_l.x + z.rail_l.w).toEqual(z.stage.x);
    expect(z.rail_r.x).toEqual(z.stage.x + z.stage.w);
  });

  it("every zone rect fits inside the window at every supported size", () => {
    for (const [ww, wh] of SIZES) {
      const z = Layout.zones(ww, wh);
      expect(within(z.hud, ww, wh)).toBe(true); // hud @ ww x wh
      expect(within(z.bar, ww, wh)).toBe(true);
      expect(within(z.rail_l, ww, wh)).toBe(true);
      expect(within(z.rail_r, ww, wh)).toBe(true);
      expect(within(z.stage, ww, wh)).toBe(true);
    }
  });

  it("rails never overlap each other or the bar", () => {
    for (const [ww, wh] of SIZES) {
      const z = Layout.zones(ww, wh);
      expect(z.rail_l.x + z.rail_l.w <= z.rail_r.x).toBe(true); // rails cross
      expect(z.rail_l.y + z.rail_l.h <= z.bar.y).toBe(true); // rail_l enters bar
      expect(z.rail_r.y + z.rail_r.h <= z.bar.y).toBe(true); // rail_r enters bar
      expect(z.stage.w >= 0).toBe(true); // negative stage
    }
  });

  it("rail width is window-derived but capped at the design width", () => {
    expect(Config.ROSTER_PANEL_WIDTH).toEqual(Layout.rail_width(800));
    expect(Config.ROSTER_PANEL_WIDTH).toEqual(Layout.rail_width(1920));
    expect(Layout.rail_width(640) < Config.ROSTER_PANEL_WIDTH).toBe(true);
    expect(Layout.rail_width(Config.LAYOUT_MIN_WIDTH) >= Config.LAYOUT_RAIL_MIN_WIDTH).toBe(true);
  });
});

describe("Layout bar items", () => {
  it("pull keeps its design geometry at 800", () => {
    const b = Layout.bar_items(800, 600);
    expect(Config.PULL_BTN_X).toEqual(b.pull.x);
    expect(Config.PULL_BTN_WIDTH).toEqual(b.pull.w);
    expect(552).toEqual(b.pull.y);
    expect(800 - Config.RESET_BTN_WIDTH - Config.RESET_BTN_MARGIN).toEqual(b.reset.x);
  });

  it("pity anchors next to pull and nothing overlaps at any size", () => {
    for (const [ww, wh] of SIZES) {
      const b = Layout.bar_items(ww, wh);
      expect(b.pull.x + b.pull.w <= b.pity.x).toBe(true); // pull/pity
      expect(b.pity.x + b.pity.w <= b.reset.x).toBe(true); // pity/reset
      expect(b.reset.x + b.reset.w <= ww).toBe(true); // reset
      expect(within(b.pity, ww, wh)).toBe(true); // pity fits
    }
  });
});

describe("Layout.fit_rail (upgrade cards)", () => {
  const COUNT = 6; // six upgrade definitions

  it("compresses below natural height to fit the design rail, no scroll needed", () => {
    const z = Layout.zones(800, 600);
    const f = Layout.fit_rail(z.rail_l.h, COUNT);
    expect(f.size <= Config.UPGRADE_CARD_HEIGHT).toBe(true);
    expect(f.size >= Config.UPGRADE_CARD_MIN_HEIGHT).toBe(true);
    expect(0).toEqual(f.overflow);
    expect(f.content_h <= z.rail_l.h).toBe(true);
  });

  it("clamps at min height and reports scrollable overflow on short rails", () => {
    const z = Layout.zones(900, 380);
    const f = Layout.fit_rail(z.rail_l.h, COUNT);
    expect(Config.UPGRADE_CARD_MIN_HEIGHT).toEqual(f.size);
    const expected_content = COUNT * f.size + (COUNT - 1) * Config.UPGRADE_CARD_GAP;
    expect(expected_content).toEqual(f.content_h);
    expect(f.content_h - z.rail_l.h).toEqual(f.overflow);
    expect(f.overflow > 0).toBe(true);
  });

  it("overflow never increases as the window grows", () => {
    const by_height = [...SIZES].sort((a, b) => a[1] - b[1]);
    let prev: number | null = null;
    for (const [ww, wh] of by_height) {
      const z = Layout.zones(ww, wh);
      const f = Layout.fit_rail(z.rail_l.h, COUNT);
      if (prev !== null) {
        expect(f.overflow <= prev).toBe(true); // overflow grew with height
      }
      prev = f.overflow;
    }
  });
});

describe("Layout roster grid and slots", () => {
  it("grid columns are honest: a 180px rail fits 2 real cards, not 3 clipped ones", () => {
    const g = Layout.roster_grid(180, 472, 9);
    expect(2).toEqual(g.cols);
    expect(g.cols <= Config.ROSTER_GRID_COLS).toBe(true);
    // A 224px rail finally fits the 3rd column genuinely:
    expect(3).toEqual(Layout.roster_grid(224, 472, 9).cols);
    // Narrow rail degrades: 640px window rail (144px) is one column.
    const z = Layout.zones(640, 420);
    expect(1).toEqual(Layout.roster_grid(z.rail_r.w, z.rail_r.h, 9).cols);
  });

  it("rows derive from rail height, capped at the design row count", () => {
    const g600 = Layout.roster_grid(180, 472, 9);
    expect(g600.rows <= Config.ROSTER_VISIBLE_ROWS).toBe(true);
    expect(g600.rows >= 1).toBe(true);
    const z = Layout.zones(900, 380);
    const gshort = Layout.roster_grid(z.rail_r.w, z.rail_r.h, 9);
    expect(gshort.rows < g600.rows).toBe(true);
    expect(gshort.rows >= 1).toBe(true);
  });

  it("max_scroll matches (content_rows - rows) * pitch", () => {
    const g = Layout.roster_grid(180, 472, 12); // cols2 -> 6 content rows
    const visible_rows = Math.ceil(12 / g.cols);
    expect((visible_rows - g.rows) * g.slot_pitch).toEqual(g.max_scroll);
    expect(0).toEqual(Layout.roster_grid(180, 472, 3).max_scroll); // fits, no scroll
  });

  it("slots tile within the rail and respect scroll", () => {
    const rail = Layout.zones(800, 600).rail_r;
    const g = Layout.roster_grid(rail.w, rail.h, 12);
    const s1 = Layout.roster_slot(rail, g, 1, 0);
    const s2 = Layout.roster_slot(rail, g, 2, 0);
    const s3 = Layout.roster_slot(rail, g, 3, 0);
    expect(rail.x + Config.ROSTER_PANEL_PADDING).toEqual(s1.x);
    expect(rail.y + g.grid_top).toEqual(s1.y);
    expect(Config.ROSTER_CARD_SIZE).toEqual(s1.w);
    expect(s1.y).toEqual(s3.y - g.slot_pitch); // index 3 wraps to row 1
    expect(s1.x + Config.ROSTER_CARD_SIZE + Config.ROSTER_CARD_SPACING).toEqual(s2.x);
    expect(s1.y + s1.h <= rail.y + rail.h).toBe(true);
    const scrolled = Layout.roster_slot(rail, g, 3, 40);
    expect(s3.y - 40).toEqual(scrolled.y);
    // every first-page slot fits:
    for (let i = 1; i <= g.visible; i++) {
      const s = Layout.roster_slot(rail, g, i, 0);
      expect(s.y + s.h <= rail.y + rail.h).toBe(true); // slot i overflows rail bottom
    }
  });
});

describe("Layout config", () => {
  it("min-size constants match Config.LAYOUT_MIN_* and the layout clamp respects them", () => {
    // conf.lua drift idea: the min window is single-source here (Config), so
    // pin the values and prove the layout clamp honors them — stats_panel at
    // the nominal minimum renders the design-size panel, exactly as pinned.
    expect(520).toBe(Config.LAYOUT_MIN_WIDTH);
    expect(360).toBe(Config.LAYOUT_MIN_HEIGHT);
    const p = Layout.stats_panel(Config.LAYOUT_MIN_WIDTH, Config.LAYOUT_MIN_HEIGHT, Config.ACHIEVEMENTS.length);
    expect(Config.STATS_PANEL_WIDTH).toEqual(p.panel.w);
    expect(Config.STATS_PANEL_HEIGHT).toEqual(p.panel.h);
  });
});

describe("Layout waifu_detail", () => {
  it("panel, sprite and done button fit inside the window at every size", () => {
    for (const [ww, wh] of SIZES) {
      const d = Layout.waifu_detail(ww, wh);
      expect(within(d.panel, ww, wh)).toBe(true); // panel
      expect(within(d.sprite, ww, wh)).toBe(true); // sprite
      expect(within(d.done, ww, wh)).toBe(true); // done
      expect(d.sprite.w > 0 && d.panel.w > 0).toBe(true); // zero rect
    }
  });

  it("keeps children inside the panel with breathing room for the info block", () => {
    for (const [ww, wh] of SIZES) {
      const d = Layout.waifu_detail(ww, wh);
      expect(d.sprite.x >= d.panel.x && d.sprite.x + d.sprite.w <= d.panel.x + d.panel.w).toBe(true);
      expect(d.done.x >= d.panel.x && d.done.x + d.done.w <= d.panel.x + d.panel.w).toBe(true);
      expect(d.done.y + d.done.h <= d.panel.y + d.panel.h).toBe(true); // done below panel
      expect(d.info_top >= d.sprite.y + d.sprite.h).toBe(true); // info rows climb over sprite
      expect(d.done.y >= d.info_top + Config.WAIFU_DETAIL_INFO_RESERVE).toBe(true); // info collides with done
    }
  });

  it("centers the design-size panel exactly at 800x600", () => {
    const d = Layout.waifu_detail(800, 600);
    expect(Config.WAIFU_DETAIL_PANEL_WIDTH).toEqual(d.panel.w);
    expect(Config.WAIFU_DETAIL_PANEL_HEIGHT).toEqual(d.panel.h);
    expect((800 - Config.WAIFU_DETAIL_PANEL_WIDTH) / 2).toEqual(d.panel.x);
    expect((600 - Config.WAIFU_DETAIL_PANEL_HEIGHT) / 2).toEqual(d.panel.y);
    expect(Config.WAIFU_DETAIL_SPRITE_SIZE).toEqual(d.sprite.w);
  });

  it("shrinks the sprite honestly at the minimum window instead of clipping", () => {
    const d = Layout.waifu_detail(Config.LAYOUT_MIN_WIDTH, Config.LAYOUT_MIN_HEIGHT);
    expect(d.sprite.y + d.sprite.h <= d.panel.y + d.panel.h).toBe(true); // sprite escapes panel
    expect(d.sprite.w <= d.panel.w - 2 * Config.LAYOUT_MARGIN).toBe(true);
  });

  it("inner text column stays inside the panel", () => {
    for (const [ww, wh] of SIZES) {
      const d = Layout.waifu_detail(ww, wh);
      expect(d.inner.x >= d.panel.x && d.inner.x + d.inner.w <= d.panel.x + d.panel.w).toBe(true);
    }
  });
});

describe("Layout meter_rect", () => {
  it("sits inside the stage and above the bar at every size", () => {
    for (const [ww, wh] of SIZES) {
      const z = Layout.zones(ww, wh);
      const r = Layout.meter_rect(ww, wh);
      expect(r.x >= z.stage.x).toBe(true); // meter over left rail
      expect(r.x + r.w <= z.stage.x + z.stage.w).toBe(true); // meter over right rail
      expect(r.y >= z.stage.y).toBe(true); // meter above stage
      expect(r.y + r.h <= z.bar.y).toBe(true); // meter over bar
      expect(r.w > 0 && r.h > 0).toBe(true); // zero-size meter
    }
  });

  it("never overflows the stage width and clamps below the monster", () => {
    for (const [ww, wh] of SIZES) {
      const z = Layout.zones(ww, wh);
      const r = Layout.meter_rect(ww, wh);
      expect(r.w <= z.stage.w * 0.6 + 1).toBe(true); // meter wider than 60% of stage
      // monster rests at the stage centre; the bar must start below it
      expect(r.y >= z.stage.y + Math.floor(z.stage.h / 2)).toBe(true);
    }
  });

  it("hits the design clamps at 800x600", () => {
    const z = Layout.zones(800, 600);
    const r = Layout.meter_rect(800, 600);
    expect(Config.KILL_METER_MAX_WIDTH).toEqual(r.w);
    expect(Config.KILL_METER_HEIGHT).toEqual(r.h);
    expect(z.stage.x + Math.floor((z.stage.w - r.w) / 2)).toEqual(r.x);
  });
});

describe("Layout stats_rect", () => {
  it("sits inside the stage (never over the rails) at every size", () => {
    for (const [ww, wh] of SIZES) {
      const z = Layout.zones(ww, wh);
      const r = Layout.stats_rect(ww, wh);
      expect(r.x >= z.stage.x).toBe(true); // stats over left rail
      expect(r.x + r.w <= z.stage.x + z.stage.w).toBe(true); // stats over right rail
      expect(r.y + r.h <= z.bar.y).toBe(true); // stats over bar
    }
  });
});

// PREST-02: prestige review modal geometry. The SIZES sweep is the
// containment authority: panel/columns/confirm must stay inside the window
// and the two list columns must never overlap, down to the minimum size.
describe("Layout.prestige_panel (PREST-02)", () => {
  it("panel, columns and confirm stay inside the window at every SIZES entry", () => {
    for (const [ww, wh] of SIZES) {
      const p = Layout.prestige_panel(ww, wh);
      expect(within(p.panel, ww, wh)).toBe(true); // panel
      expect(within(p.confirm, ww, wh)).toBe(true); // confirm
      expect(within(p.keep_col, ww, wh)).toBe(true); // keep_col
      expect(within(p.reset_col, ww, wh)).toBe(true); // reset_col
    }
  });

  it("columns sit inside the panel and never overlap each other", () => {
    for (const [ww, wh] of SIZES) {
      const p = Layout.prestige_panel(ww, wh);
      expect(p.keep_col.x >= p.panel.x && p.keep_col.x + p.keep_col.w <= p.panel.x + p.panel.w).toBe(true);
      expect(p.keep_col.y >= p.panel.y && p.keep_col.y + p.keep_col.h <= p.panel.y + p.panel.h).toBe(true);
      expect(p.reset_col.x >= p.panel.x && p.reset_col.x + p.reset_col.w <= p.panel.x + p.panel.w).toBe(true);
      expect(p.keep_col.x + p.keep_col.w <= p.reset_col.x).toBe(true); // columns overlap
      expect(p.confirm.y + p.confirm.h <= p.panel.y + p.panel.h).toBe(true); // confirm escapes panel
    }
  });

  it("hits the design maxima exactly at 800x600", () => {
    const p = Layout.prestige_panel(800, 600);
    expect(Config.PRESTIGE_PANEL_WIDTH).toEqual(p.panel.w);
    expect(Config.PRESTIGE_PANEL_HEIGHT).toEqual(p.panel.h);
    expect((800 - Config.PRESTIGE_PANEL_WIDTH) / 2).toEqual(p.panel.x);
    expect((600 - Config.PRESTIGE_PANEL_HEIGHT) / 2).toEqual(p.panel.y);
    expect(Config.PRESTIGE_BTN_WIDTH).toEqual(p.confirm.w);
  });
});

describe("Layout.bar_items prestige entry (PREST-02)", () => {
  it("prestige rect exists, is bar-aligned, and stays clear of pity and reset at every width", () => {
    for (const [ww, wh] of SIZES) {
      const b = Layout.bar_items(ww, wh);
      expect(b.prestige).toBeTruthy();
      expect(within(b.prestige, ww, wh)).toBe(true); // prestige outside window
      expect(b.prestige.y === b.bar.y && b.prestige.h === b.bar.h).toBe(true); // not bar-aligned
      expect(b.prestige.x + b.prestige.w <= b.reset.x - 8).toBe(true); // prestige touches reset
      expect(b.pity.x + b.pity.w <= b.prestige.x).toBe(true); // pity touches prestige
    }
  });

  it("legacy pull/pity/reset rects are byte-unchanged by the new key", () => {
    const b = Layout.bar_items(800, 600);
    expect(Config.PULL_BTN_X).toEqual(b.pull.x);
    expect(Config.PULL_BTN_WIDTH).toEqual(b.pull.w);
    expect(Config.PULL_BTN_X + Config.PULL_BTN_WIDTH + 12).toEqual(b.pity.x);
    expect(Config.PITY_TEXT_WIDTH).toEqual(b.pity.w);
    expect(800 - Config.RESET_BTN_WIDTH - Config.RESET_BTN_MARGIN).toEqual(b.reset.x);
    expect(Config.RESET_BTN_WIDTH).toEqual(b.reset.w);
  });
});

// Phase 8 UI-01/UI-04: stats/achievements modal geometry. The SIZES sweep is
// the containment authority: the panel stays inside the window, the list
// stays inside the panel on all four edges, and the fixed stats block can
// never collide with the list because the list absorbs every height clamp.
describe("Layout.stats_panel (Phase 8)", () => {
  const COUNT = Config.ACHIEVEMENTS.length; // pinned by test_config D05_IDS

  it("panel and list stay inside the window and the list inside the panel at every SIZES entry", () => {
    for (const [ww, wh] of SIZES) {
      const p = Layout.stats_panel(ww, wh, COUNT);
      expect(within(p.panel, ww, wh)).toBe(true); // panel
      expect(p.list.x >= p.panel.x).toBe(true); // list left
      expect(p.list.x + p.list.w <= p.panel.x + p.panel.w).toBe(true); // list right
      expect(p.list.y >= p.panel.y).toBe(true); // list top
      expect(p.list.y + p.list.h <= p.panel.y + p.panel.h).toBe(true); // list bottom
      expect(p.list.max_scroll >= 0).toBe(true); // negative max_scroll
      expect(p.list.visible >= 1).toBe(true); // zero visible rows
    }
  });

  it("hits the design maxima exactly at 800x600", () => {
    const p = Layout.stats_panel(800, 600, COUNT);
    expect(Config.STATS_PANEL_WIDTH).toEqual(p.panel.w);
    expect(Config.STATS_PANEL_HEIGHT).toEqual(p.panel.h);
    expect((800 - Config.STATS_PANEL_WIDTH) / 2).toEqual(p.panel.x);
    expect((600 - Config.STATS_PANEL_HEIGHT) / 2).toEqual(p.panel.y);
    expect(Config.STATS_PANEL_LINE_HEIGHT).toEqual(p.list.row_h);
    expect(1).toEqual(p.list.visible);
    expect((COUNT - 1) * Config.STATS_PANEL_LINE_HEIGHT).toEqual(p.list.max_scroll);
  });

  it("renders the design-size panel at the 520x360 minimum window (UI-SPEC pinned contract)", () => {
    const p = Layout.stats_panel(Config.LAYOUT_MIN_WIDTH, Config.LAYOUT_MIN_HEIGHT, COUNT);
    expect(380).toEqual(p.panel.w);
    expect(70).toEqual(p.panel.x);
    expect(320).toEqual(p.panel.h);
    expect(20).toEqual(p.panel.y);
    expect(1).toEqual(p.list.visible);
    expect((COUNT - 1) * Config.STATS_PANEL_LINE_HEIGHT).toEqual(p.list.max_scroll); // wheel scroll is live at every size
  });

  it("exposes a single-source block budget the list derives from (WR-02)", () => {
    // The reserved block height and the drawn block share ONE source: the
    // draw path reads p.block.{y,rows,line_height,header_y} and the list top
    // is pinned to header_y + one row + the 8px gutter.
    for (const [ww, wh] of SIZES) {
      const p = Layout.stats_panel(ww, wh, COUNT);
      expect(p.block).toBeTruthy(); // block budget missing
      expect(16).toEqual(p.block.rows); // block row count drifted
      expect(Config.STATS_PANEL_LINE_HEIGHT).toEqual(p.block.line_height);
      expect(p.block.y + p.block.rows * p.block.line_height).toEqual(p.block.header_y);
      expect(p.block.header_y + p.block.line_height + 8).toEqual(p.list.y);
      expect(p.list.y >= p.panel.y).toBe(true); // list above panel top
    }
  });

  it("floors the composition so block, header and list never cross the panel border below the nominal minimum (WR-07)", () => {
    // The host may drag the viewport below the nominal minimum; prove the
    // composition floor keeps everything inside the panel border anyway.
    for (const wh of [360, 320, 300, 284, 270, 262, 240, 200]) {
      const p = Layout.stats_panel(520, wh, COUNT);
      const pb = p.panel.y + p.panel.h;
      expect(p.block.y >= p.panel.y).toBe(true); // block top above panel
      expect(p.block.y + p.block.rows * p.block.line_height <= pb).toBe(true); // block crossed border
      expect(p.block.header_y + p.block.line_height <= pb).toBe(true); // header crossed border
      expect(p.list.y + p.list.h <= pb).toBe(true); // list crossed border
      expect(p.list.y >= p.block.header_y + p.block.line_height).toBe(true); // list collided with header
      expect(p.list.h >= p.list.row_h).toBe(true); // list lost its one-row floor
    }
  });
});

// Phase 8 UI-01: the stats bar entry (order pull | pity | stats | prestige |
// reset). Single rect source for draw AND hit-test; the chain stays clear at
// every swept size (Pitfall 7: the 520-wide free gutter clamps the width).
describe("Layout.bar_items stats entry (Phase 8)", () => {
  it("stats rect exists, is bar-aligned and chained clear of pity, prestige and reset at every size", () => {
    for (const [ww, wh] of SIZES) {
      const b = Layout.bar_items(ww, wh);
      expect(b.stats).toBeTruthy(); // missing stats
      expect(within(b.stats, ww, wh)).toBe(true); // stats outside window
      expect(b.stats.y === b.bar.y && b.stats.h === b.bar.h).toBe(true); // not bar-aligned
      expect(b.pity.x + b.pity.w <= b.stats.x).toBe(true); // pity touches stats
      expect(b.stats.x + b.stats.w <= b.prestige.x).toBe(true); // stats touches prestige
      expect(b.prestige.x + b.prestige.w <= b.reset.x - 8).toBe(true); // prestige touches reset
    }
  });

  it("clamps the button width to the free gutter at the 520 minimum (Pitfall 7 pin)", () => {
    const b = Layout.bar_items(Config.LAYOUT_MIN_WIDTH, Config.LAYOUT_MIN_HEIGHT);
    expect(312).toEqual(b.stats.x);
    expect(34).toEqual(b.stats.w);
  });
});

// Collapsible rails (Clicker Heroes pattern): collapsed sides shrink to the
// strip width, the stage absorbs the freed space, and containment/order hold
// for every collapse combination.
describe("Layout collapsible rails", () => {
  const combos: Array<[{ left?: boolean; right?: boolean }, string]> = [
    [{}, "both expanded"],
    [{ left: true }, "left collapsed"],
    [{ right: true }, "right collapsed"],
    [{ left: true, right: true }, "both collapsed"],
  ];

  it("collapsed rails use the strip width and the stage absorbs the freed space", () => {
    const open = Layout.zones(800, 600);
    const lc = Layout.zones(800, 600, { left: true });
    expect(0).toEqual(lc.rail_l.w); // retired left rail: zero-width seam
    expect(lc.stage.w).toEqual(open.stage.w); // the left flag no longer steers geometry
    expect(lc.stage.x).toEqual(lc.rail_l.x + lc.rail_l.w);
    const rc = Layout.zones(800, 600, { right: true });
    expect(Config.COLLAPSED_RAIL_WIDTH).toEqual(rc.rail_r.w);
    expect(rc.stage.w > open.stage.w).toBe(true); // stage absorbs the freed strip
    const both = Layout.zones(800, 600, { left: true, right: true });
    expect(both.stage.w).toEqual(rc.stage.w);
  });

  it("every collapse combo keeps rails, stage and bar contained and ordered", () => {
    for (const [ww, wh] of SIZES) {
      for (const [opts] of combos) {
        const z = Layout.zones(ww, wh, opts);
        expect(within(z.rail_l, ww, wh)).toBe(true); // rail_l escapes
        expect(within(z.rail_r, ww, wh)).toBe(true); // rail_r escapes
        expect(within(z.stage, ww, wh)).toBe(true); // stage escapes
        expect(z.rail_l.x + z.rail_l.w <= z.stage.x + 0.001).toBe(true); // l/stage
        expect(z.stage.x + z.stage.w <= z.rail_r.x + 0.001).toBe(true); // stage/r
        expect(z.stage.x + z.stage.w <= z.rail_r.x + 0.001).toBe(true);
        expect(z.stage.w >= 0).toBe(true); // negative stage
      }
    }
  });

  it("rail_tab sits in the rail's top-inner corner at the config size", () => {
    const z = Layout.zones(800, 600);
    const rt = Layout.rail_tab(z.rail_r, "right");
    expect(Config.RAIL_TAB_SIZE).toEqual(rt.w);
    expect(Config.RAIL_TAB_SIZE).toEqual(rt.h);
    expect(rt.x).toEqual(z.rail_r.x); // right tab hugs inner edge
    expect(rt.y).toEqual(z.rail_r.y);
    expect(within(rt, 800, 600)).toBe(true);
    // a collapsed rail keeps its tab inside the strip
    const rc = Layout.zones(800, 600, { right: true });
    const rct = Layout.rail_tab(rc.rail_r, "right");
    expect(rct.x >= rc.rail_r.x).toBe(true);
    expect(rct.x + rct.w <= rc.rail_r.x + rc.rail_r.w + 0.001).toBe(true);
  });
});

// Phase 15 (DISP-01): pure-function geometry sweep at phone aspect. Every
// predicate mirrors the UI-SPEC acceptance list (E1-E4, E10); within() + the
// house sweep style stays the containment authority.
describe("Phase 15 phone-aspect sweep", () => {
  // Clamp identity of the toggle widths (mirrors Layout.bar_items): Config
  // holds the maxima, Layout clamps against the live stage.
  function clamp_toggle_w(stage_w: number): number {
    return Math.max(24, Math.min(Config.TOGGLE_BTN_WIDTH, Math.floor(stage_w * 0.16)));
  }

  it("E1: bar chain pull->pity->stats->prestige->reset stays ordered, every rect fits", () => {
    for (const [ww, wh] of SIZES) {
      const b = Layout.bar_items(ww, wh);
      expect(b.pull.x + b.pull.w <= b.pity.x).toBe(true); // pull/pity
      expect(b.pity.x + b.pity.w <= b.stats.x).toBe(true); // pity/stats
      expect(b.stats.x + b.stats.w <= b.prestige.x).toBe(true); // stats/prestige
      expect(b.prestige.x + b.prestige.w <= b.reset.x).toBe(true); // prestige/reset
      expect(within(b.bar, ww, wh)).toBe(true);
      expect(within(b.pull, ww, wh)).toBe(true);
      expect(within(b.pity, ww, wh)).toBe(true);
      expect(within(b.stats, ww, wh)).toBe(true);
      expect(within(b.prestige, ww, wh)).toBe(true);
      expect(within(b.reset, ww, wh)).toBe(true);
      expect(within(b.dbg, ww, wh)).toBe(true);
      expect(within(b.sess, ww, wh)).toBe(true);
    }
  });

  it("E2: toggle rects clear the right edge, the 8px gutter and the kill meter", () => {
    for (const [ww, wh] of SIZES) {
      const b = Layout.bar_items(ww, wh);
      expect(b.dbg.w >= 24).toBe(true); // dbg.w floor
      expect(b.sess.w >= 24).toBe(true); // sess.w floor
      expect(b.sess.x + b.sess.w <= ww).toBe(true); // sess right edge
      expect(b.sess.x - 8 - b.sess.w).toEqual(b.dbg.x);
      expect(b.dbg.y + b.dbg.h <= b.bar.y).toBe(true); // dbg enters bar
      expect(b.sess.y + b.sess.h <= b.bar.y).toBe(true); // sess enters bar
      const m = Layout.meter_rect(ww, wh);
      expect(b.dbg.y >= m.y + m.h).toBe(true); // dbg under the meter
    }
  });

  it("E3: toggle width equals the Config-maxima clamp against the live stage", () => {
    for (const [ww, wh] of SIZES) {
      const b = Layout.bar_items(ww, wh);
      const stage_w = Layout.zones(ww, wh).stage.w;
      expect(clamp_toggle_w(stage_w)).toEqual(b.dbg.w);
      expect(clamp_toggle_w(stage_w)).toEqual(b.sess.w);
    }
  });

  it("E4: touch floor — bar rows are bar-height tall, toggles are toggle-height", () => {
    for (const [ww, wh] of SIZES) {
      const b = Layout.bar_items(ww, wh);
      expect(Config.BOTTOM_BAR_HEIGHT).toEqual(b.pull.h);
      expect(Config.BOTTOM_BAR_HEIGHT).toEqual(b.pity.h);
      expect(Config.BOTTOM_BAR_HEIGHT).toEqual(b.stats.h);
      expect(Config.BOTTOM_BAR_HEIGHT).toEqual(b.prestige.h);
      expect(Config.BOTTOM_BAR_HEIGHT).toEqual(b.reset.h);
      expect(Config.TOGGLE_BTN_HEIGHT).toEqual(b.dbg.h);
      expect(Config.TOGGLE_BTN_HEIGHT).toEqual(b.sess.h);
    }
  });

  it("E10: the 520x360 floor holds — rails at the min width, stats >= 34", () => {
    const ww = Config.LAYOUT_MIN_WIDTH;
    const wh = Config.LAYOUT_MIN_HEIGHT;
    const z = Layout.zones(ww, wh);
    expect(0).toEqual(z.rail_l.w); // retired left rail: zero-width seam
    expect(Config.LAYOUT_RAIL_MIN_WIDTH).toEqual(z.rail_r.w);
    expect(within(z.hud, ww, wh)).toBe(true);
    expect(within(z.bar, ww, wh)).toBe(true);
    expect(within(z.rail_l, ww, wh)).toBe(true);
    expect(within(z.rail_r, ww, wh)).toBe(true);
    expect(within(z.stage, ww, wh)).toBe(true);
    expect(Layout.bar_items(ww, wh).stats.w >= 34).toBe(true); // pitfall-7 stats floor
  });
});

describe("Layout.pickup_spots", () => {
  it("spreads the pickups around the stage instead of one row", () => {
    const ww = Config.WINDOW_WIDTH;
    const wh = Config.WINDOW_HEIGHT;
    const z = Layout.zones(ww, wh);
    const p = Layout.pickup_spots(ww, wh);
    const stage_cx = z.stage.x + z.stage.w / 2;
    expect(p.coins.x < stage_cx).toBe(true); // pile hugs the left edge
    expect(p.chest.x > stage_cx).toBe(true); // chest hugs the right edge
    // The orb stays under the meter, centered on the stage.
    const meter = Layout.meter_rect(ww, wh);
    expect(Math.abs(p.exp.x + p.exp.w / 2 - (meter.x + meter.w / 2)) <= 1).toBe(true);
    expect(p.exp.y > meter.y + meter.h).toBe(true);
    // Spots sit inside the stage and clear the bottom bar.
    for (const r of [p.coins, p.exp, p.chest]) {
      expect(r.x >= z.stage.x && r.x + r.w <= z.stage.x + z.stage.w).toBe(true);
      expect(r.y + r.h <= z.bar.y).toBe(true);
    }
  });
});
