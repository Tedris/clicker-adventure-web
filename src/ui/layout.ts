// src/ui/layout.ts
// Responsive layout core, ported from src/ui/layout.lua (Story 4.2a). PURE
// geometry: no canvas/DOM calls, no state — every rect derives from the
// explicit (ww, wh) window size so the UI can never render cut-off or
// overlapping panels. The only size that keeps legacy pixel geometry exactly
// is the 800x600 design size; everything smaller degrades proportionally
// down to Config.LAYOUT_MIN_*. Rails shrink proportionally below the design
// width but never below LAYOUT_RAIL_MIN_WIDTH; the viewport clamp belongs to
// the host (520x360 minimum), and stats_panel self-enforces its composition
// floor so its children can never cross the panel border below that.

import Config from "../config";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rail_width(ww: number): number {
  let w = Math.floor(ww * Config.LAYOUT_RAIL_RATIO);
  w = Math.max(Config.LAYOUT_RAIL_MIN_WIDTH, w);
  return Math.min(Config.ROSTER_PANEL_WIDTH, w);
}

export interface CollapseOpts {
  left?: boolean;
  right?: boolean;
}

function side_rail_width(ww: number, collapsed?: boolean): number {
  if (collapsed) return Math.min(Config.COLLAPSED_RAIL_WIDTH, rail_width(ww));
  return rail_width(ww);
}

// Top-level zones: hud (window-relative), bottom bar, two content rails, and
// the stage between the rails (monster lives here; session stats center here).
// A collapsed rail shrinks to COLLAPSED_RAIL_WIDTH and the stage absorbs the
// freed width, Clicker Heroes style.
export function zones(ww: number, wh: number, collapsed?: CollapseOpts) {
  const margin = Config.LAYOUT_MARGIN;
  const hud_h = Config.HUD_PANEL_HEIGHT;
  const bar_h = Config.BOTTOM_BAR_HEIGHT;
  const content_top = margin + hud_h + margin;
  const rail_h = Math.max(0, (wh - bar_h) - content_top);
  // The left rail is retired: skills live in their own modal, so the whole
  // content width minus the roster rail is stage. `left` stays accepted in
  // CollapseOpts for call-site compatibility but no longer steers geometry.
  const rw_l = 0;
  const rw_r = side_rail_width(ww, collapsed?.right);
  return {
    margin,
    content_top,
    hud: { x: margin, y: margin, w: ww - margin * 2, h: hud_h },
    bar: { x: 0, y: wh - bar_h, w: ww, h: bar_h },
    rail_l: { x: margin, y: content_top, w: rw_l, h: rail_h },
    rail_r: { x: ww - rw_r - margin, y: content_top, w: rw_r, h: rail_h },
    stage: { x: margin + rw_l, y: content_top, w: ww - margin * 2 - rw_l - rw_r, h: rail_h },
  };
}

// Chevron tab for a rail: the rail's top-inner corner. Same rect feeds the
// tab draw and its hit-test.
export function rail_tab(rail: Rect, side: "left" | "right"): Rect {
  const s = Config.RAIL_TAB_SIZE;
  const x = side === "left" ? rail.x + rail.w - s : rail.x;
  return { x, y: rail.y, w: s, h: s };
}

// Rail body: the area BELOW the chevron tab row. Headers and cards start
// here so the tab square never sits on top of a line of text — the tab owns
// the top strip across the full rail width by construction.
export function rail_body(rail: Rect): Rect {
  const t = Config.RAIL_TAB_SIZE;
  return { x: rail.x, y: rail.y + t, w: rail.w, h: Math.max(0, rail.h - t) };
}

// Bottom-bar items, all window-derived: pull (left), pity (reads as the
// pull's price tag, right next to it), stats (Phase 8 info entry, left of
// prestige), prestige (PREST-02 entry, left of reset), reset (right edge).
// The sess/dbg toggles sit above the bar row in the lower-right stage corner
// (Phase 15 INP-04). The same rects feed both drawing and hit-testing.
export function bar_items(ww: number, wh: number, collapsed?: CollapseOpts) {
  const z = zones(ww, wh, collapsed);
  const bar = z.bar;
  const pull_w = Math.min(Config.PULL_BTN_WIDTH, Math.floor(ww * 0.3));
  const pity_x = Config.PULL_BTN_X + pull_w + 12;
  const reset_x = ww - Config.RESET_BTN_WIDTH - Config.RESET_BTN_MARGIN;
  const prestige_w = Math.min(Config.PRESTIGE_BTN_WIDTH, Math.floor(ww * 0.15));
  const prestige_x = reset_x - 8 - prestige_w;
  // Stats entry: right-anchored on the 8px gutter precedent, clamped to the
  // free pity..prestige space — at the 520 minimum the gutter is only ~42px,
  // so the button shrinks into it rather than overlapping.
  const stats_w = Math.max(0, Math.min(Config.STATS_BTN_WIDTH,
    prestige_x - 8 - (pity_x + Config.PITY_TEXT_WIDTH)));
  const stats_x = prestige_x - 8 - stats_w;
  // Toggle widths clamp the Config maxima into 16% of the live stage with a
  // 24px floor; DBG shares the sess sizing/y on the 8px gutter precedent.
  const stage = z.stage;
  const sess_h = Config.TOGGLE_BTN_HEIGHT;
  const sess_w = Math.max(24, Math.min(Config.TOGGLE_BTN_WIDTH, Math.floor(stage.w * 0.16)));
  const sess_x = stage.x + stage.w - sess_w;
  const sess_y = bar.y - 4 - sess_h;
  const dbg_x = sess_x - 8 - sess_w;
  // Batch-summon button shares the toggle lane: one tap runs BATCH_PULL_COUNT
  // pulls, the PS99 "save tokens, open in a batch" rhythm.
  const batch_x = dbg_x - 8 - sess_w;
  // Areas button (header lane): right end of the HUD row, right of the token
  // counter's shrunk column. Opens the area menu; same size language as the
  // toggle buttons.
  const areas_w = Math.max(48, Math.min(88, Math.floor(z.hud.w * 0.18)));
  const areas_h = Config.TOGGLE_BTN_HEIGHT;
  const areas_x = z.hud.x + z.hud.w - areas_w - 8;
  // Skills button: left of Areas, same size language — the entry into the
  // upgrade lattice modal.
  const skills_x = areas_x - 8 - areas_w;
  return {
    bar,
    pull: { x: Config.PULL_BTN_X, y: bar.y, w: pull_w, h: bar.h },
    pity: { x: pity_x, y: bar.y, w: Config.PITY_TEXT_WIDTH, h: bar.h },
    stats: { x: stats_x, y: bar.y, w: stats_w, h: bar.h },
    prestige: { x: prestige_x, y: bar.y, w: prestige_w, h: bar.h },
    reset: { x: reset_x, y: bar.y, w: Config.RESET_BTN_WIDTH, h: bar.h },
    sess: { x: sess_x, y: sess_y, w: sess_w, h: sess_h },
    dbg: { x: dbg_x, y: sess_y, w: sess_w, h: sess_h },
    batch: { x: batch_x, y: sess_y, w: sess_w, h: sess_h },
    areas: {
      x: areas_x,
      y: z.hud.y + Math.floor((z.hud.h - areas_h) / 2),
      w: areas_w,
      h: areas_h,
    },
    skills: {
      x: skills_x,
      y: z.hud.y + Math.floor((z.hud.h - areas_h) / 2),
      w: areas_w,
      h: areas_h,
    },
  };
}

// Prestige review modal geometry (PREST-02): centered panel with a two-step
// confirm button and two side-by-side list columns (keep | reset, 8px
// gutter). Design maxima are clamped against the window; column tops sit
// below the title + two info lines + gap.
export function prestige_panel(ww: number, wh: number) {
  const pad = Config.LAYOUT_MARGIN;
  const pw = Math.min(Config.PRESTIGE_PANEL_WIDTH, ww - pad * 2);
  const ph = Math.min(Config.PRESTIGE_PANEL_HEIGHT, wh - pad * 2);
  const px = Math.floor((ww - pw) / 2);
  const py = Math.floor((wh - ph) / 2);
  const bh = Config.SUMMON_PULL_BTN_HEIGHT;
  const bw = Math.min(Config.PRESTIGE_BTN_WIDTH, pw - pad * 2);
  const list_top = py + pad + 18 + Config.PRESTIGE_PANEL_LINE_HEIGHT * 2 + 8;
  const colw = Math.floor((pw - pad * 2 - 8) / 2);
  const confirm = { x: px + Math.floor((pw - bw) / 2), y: py + ph - pad - bh, w: bw, h: bh };
  return {
    panel: { x: px, y: py, w: pw, h: ph },
    keep_col: { x: px + pad, y: list_top, w: colw, h: Math.max(0, confirm.y - 8 - list_top) },
    reset_col: { x: px + pad + colw + 8, y: list_top, w: colw, h: Math.max(0, confirm.y - 8 - list_top) },
    confirm,
  };
}

// Stats/achievements modal geometry (Phase 8): centered panel with a fixed
// non-scrolling stats block stacked on top and the wheel-scrollable badge
// list below. Children derive ONLY from the clamped panel, never from the
// window — and because the list absorbs every height clamp (floored at one
// visible row), block and list can never collide by construction. The panel
// itself is floored (WR-07) at the height that fits title + block + header +
// gutter + one list row, so the promise is self-enforcing even when the host
// drags the viewport below the nominal minimum.
export function stats_panel(ww: number, wh: number, count?: number) {
  const pad = Config.LAYOUT_MARGIN;
  const lh = Config.STATS_PANEL_LINE_HEIGHT;
  const block_rows = 16;
  const title_offset = 18; // prestige list_top idiom (declared UI-SPEC exception)
  const header_row = lh; // "Achievements" section-header row
  const gutter = 8; // sm gutter before the list
  const min_panel_h = pad * 2 + title_offset + block_rows * lh + header_row + gutter + lh;
  const pw = Math.min(Config.STATS_PANEL_WIDTH, ww - pad * 2);
  let ph = Math.min(Config.STATS_PANEL_HEIGHT, wh - pad * 2);
  ph = Math.max(ph, min_panel_h);
  const px = Math.floor((ww - pw) / 2);
  const py = Math.floor((wh - ph) / 2);
  const block_top = py + pad + title_offset;
  const list_top = block_top + block_rows * lh + header_row + gutter;
  const row_h = lh;
  const list_h = Math.max(row_h, py + ph - pad - list_top); // 1-row floor
  const visible = Math.max(1, Math.floor(list_h / row_h));
  return {
    panel: { x: px, y: py, w: pw, h: ph },
    // Block budget (WR-02): the draw path reads these back instead of
    // re-deriving its own copies, so reserved and drawn height share one source.
    block: {
      y: block_top,
      rows: block_rows,
      line_height: lh,
      header_y: block_top + block_rows * lh,
    },
    list: {
      x: px + pad,
      y: list_top,
      w: pw - pad * 2,
      h: list_h,
      row_h,
      visible,
      max_scroll: Math.max(0, ((count ?? 0) - visible) * row_h), // roster idiom
    },
  };
}

// Session-stats overlay: centered on the stage so it can never sit on top of
// the roster rail (the classic 4.x-era overlap bug).
export function stats_rect(ww: number, wh: number, collapsed?: CollapseOpts): Rect {
  const stage = zones(ww, wh, collapsed).stage;
  // 216 fits the full 8-line readout (stats + streak/pity, Story polish).
  const w = 200;
  const h = 216;
  const x = stage.x + Math.floor(Math.max(0, stage.w - w) / 2);
  return { x, y: stage.y + 16, w, h };
}

// Kill-progress meter (FEEL-01): always-alive bar under the monster. Width is
// clamped to 60% of the stage (capped at the design max), y sits below the
// monster's rest position at the stage centre, clamped so it never reaches
// the bottom bar.
export function meter_rect(ww: number, wh: number, collapsed?: CollapseOpts): Rect {
  const z = zones(ww, wh, collapsed);
  const stage = z.stage;
  const w = Math.min(Config.KILL_METER_MAX_WIDTH, Math.floor(stage.w * 0.6));
  const h = Config.KILL_METER_HEIGHT;
  const x = stage.x + Math.floor(Math.max(0, stage.w - w) / 2);
  // 20px below the stage centre: monster half-height (16) + 4px clearance,
  // enough to clear the idle bob (±4px).
  let y = Math.floor(stage.y + stage.h / 2) + 20;
  if (y + h > z.bar.y) y = z.bar.y - h;
  if (y < stage.y) y = stage.y;
  return { x, y, w, h };
}

// Upgrade-rail card sizing: compress cards (down to a min height) to fit the
// rail; whatever still cannot fit becomes wheel-scrollable overflow.
export function fit_rail(rail_h: number, count: number) {
  const gap = Config.UPGRADE_CARD_GAP;
  const natural = Config.UPGRADE_CARD_HEIGHT;
  const min_h = Config.UPGRADE_CARD_MIN_HEIGHT;
  let size = Math.floor((rail_h - (count - 1) * gap) / Math.max(1, count));
  size = Math.min(natural, Math.max(min_h, size));
  const content_h = count * size + (count - 1) * gap;
  return { size, gap, content_h, overflow: Math.max(0, content_h - rail_h) };
}

export interface RosterGrid {
  cols: number;
  rows: number;
  slot_pitch: number;
  slot_h: number;
  grid_top: number;
  visible: number;
  max_scroll: number;
}

// Roster grid: columns are HONEST (a card column is counted only when it
// truly fits, so the legacy phantom 3rd column at width 180 is gone). The
// pitch (sprite + label rows + gap) fixes rows and scroll range.
export function roster_grid(rail_w: number, rail_h: number, count: number): RosterGrid {
  const pad = Config.ROSTER_PANEL_PADDING;
  const cs = Config.ROSTER_CARD_SIZE;
  const gap = Config.ROSTER_CARD_SPACING;
  const slot = cs + Config.ROSTER_LABEL_HEIGHT; // card visual height
  const slot_pitch = slot + gap;
  const col_pitch = cs + gap; // horizontal pitch
  const grid_top = pad + Config.ROSTER_HEADER_HEIGHT;
  const cols = Math.max(1, Math.min(Config.ROSTER_GRID_COLS,
    Math.floor((rail_w - pad * 2 + gap) / col_pitch)));
  const rows = Math.max(1, Math.min(Config.ROSTER_VISIBLE_ROWS,
    Math.floor((rail_h - grid_top + gap) / slot_pitch)));
  const content_rows = Math.ceil((count ?? 0) / cols);
  return {
    cols, rows, slot_pitch, slot_h: slot,
    grid_top, visible: cols * rows,
    max_scroll: Math.max(0, (content_rows - rows) * slot_pitch),
  };
}

// 1-based card slot rect inside the right rail (index scrolls with `scroll`).
export function roster_slot(rail: Rect, grid: RosterGrid, index: number, scroll?: number): Rect {
  const pad = Config.ROSTER_PANEL_PADDING;
  const col = (index - 1) % grid.cols;
  const row = Math.floor((index - 1) / grid.cols);
  return {
    x: rail.x + pad + col * (Config.ROSTER_CARD_SIZE + Config.ROSTER_CARD_SPACING),
    y: rail.y + grid.grid_top + row * grid.slot_pitch - (scroll ?? 0),
    w: Config.ROSTER_CARD_SIZE,
    h: grid.slot_h,
  };
}

// Pull-screen (summoning) geometry: circle center/size plus the reveal
// button row, window-derived. The design circle fits unmodified at 800x600;
// the row centers on the window bottom margin so it stays tappable at the
// minimum window size.
export function pull_geometry(ww: number, wh: number) {
  const margin = Config.LAYOUT_MARGIN;
  const bh = Config.SUMMON_PULL_BTN_HEIGHT;
  const bw = Math.min(Config.SUMMON_PULL_BTN_WIDTH, Math.floor((ww - margin * 3) / 2));
  const bx = Math.floor((ww - (bw * 2 + margin)) / 2);
  const circle = Math.min(Config.SUMMON_CIRCLE_SIZE, ww - margin * 2, Math.floor(wh * 0.45));
  return {
    cx: Math.floor(ww / 2),
    cy: Math.floor(wh * 0.38),
    circle,
    orbit_scale: circle / Config.SUMMON_CIRCLE_SIZE,
    pull_again: { x: bx, y: wh - margin - bh, w: bw, h: bh },
    done: { x: Math.floor(bx + bw + margin), y: wh - margin - bh, w: bw, h: bh },
  };
}

// Waifu status-screen overlay geometry: centered panel, title row, big
// centered portrait, reserved info block, bottom Done button. Children are
// capped so they can NEVER collide: the sprite absorbs all shrink.
export function waifu_detail(ww: number, wh: number) {
  const pad = Config.LAYOUT_MARGIN;
  const title_h = 18;
  const gap = 6;
  const bh = Config.SUMMON_PULL_BTN_HEIGHT;
  const reserve = Config.WAIFU_DETAIL_INFO_RESERVE;
  const pw = Math.min(Config.WAIFU_DETAIL_PANEL_WIDTH, ww - pad * 2);
  const ph = Math.min(Config.WAIFU_DETAIL_PANEL_HEIGHT, wh - pad * 2);
  const px = Math.floor((ww - pw) / 2);
  const py = Math.floor((wh - ph) / 2);
  const sprite_size = Math.min(
    Config.WAIFU_DETAIL_SPRITE_SIZE,
    pw - pad * 2,
    ph - pad - title_h - gap - reserve - pad - bh - pad);
  const bw = Math.min(Config.SUMMON_PULL_BTN_WIDTH, pw - pad * 2);
  const title_y = py + pad;
  const sprite_y = title_y + title_h + gap;
  const info_top = sprite_y + sprite_size + 4;
  const done_y = py + ph - pad - bh;
  return {
    panel: { x: px, y: py, w: pw, h: ph },
    inner: { x: px + pad, w: pw - pad * 2 },
    title: { x: px + pad, y: title_y, w: pw - pad * 2, h: title_h },
    sprite: {
      x: px + Math.floor((pw - sprite_size) / 2), y: sprite_y,
      w: sprite_size, h: sprite_size,
    },
    info_top,
    done: { x: px + Math.floor((pw - bw) / 2), y: done_y, w: bw, h: bh },
  };
}

// Area menu modal (Clicker Heroes zone picker): centered panel with one chip
// per unlocked area, then the info lines below. Chips are returned as ready
// rects so draw and hit-test share one row geometry; at least one chip is
// always laid out, and the row shrinks chips honestly when the panel gets
// narrow (never wraps — the count is capped by AREAS.length anyway).
export function area_menu(ww: number, wh: number, count: number) {
  const pad = Config.LAYOUT_MARGIN;
  const pw = Math.min(Config.AREA_MENU_WIDTH, ww - pad * 2);
  const ph = Math.min(Config.AREA_MENU_HEIGHT, wh - pad * 2);
  const px = Math.floor((ww - pw) / 2);
  const py = Math.floor((wh - ph) / 2);
  const n = Math.max(1, count | 0);
  const gap = 6;
  const chip_w = Math.max(24, Math.min(56, Math.floor((pw - pad * 2 - gap * (n - 1)) / n)));
  const chips_h = Math.max(22, Config.FONT_SIZE + 8);
  const chips_y = py + pad + Config.FONT_SIZE + 8;
  const chips: Rect[] = [];
  for (let i = 0; i < n; i++) {
    chips.push({ x: px + pad + i * (chip_w + gap), y: chips_y, w: chip_w, h: chips_h });
  }
  return {
    panel: { x: px, y: py, w: pw, h: ph },
    chips,
    info_top: chips_y + chips_h + 10,
    info_w: pw - pad * 2,
  };
}

// Pickup spots (PS99 harvest layout): Coin pile hugs the left edge of the
// stage, EXP orb sits centered under the kill meter, treasure chest hugs the
// right edge - the pickups surround the monster instead of crowding one row.
// Same rects feed draw and hit-test, so lit pixels are tappable pixels.
export function pickup_spots(ww: number, wh: number, collapsed?: CollapseOpts) {
  const z = zones(ww, wh, collapsed);
  const meter = meter_rect(ww, wh, collapsed);
  const stage = z.stage;
  const mid_y = Math.floor(stage.y + stage.h / 2) - 7;
  const side_w = 22;
  return {
    coins: { x: stage.x + 12, y: mid_y, w: side_w, h: 16 },
    exp: {
      x: Math.floor(stage.x + stage.w / 2) - 9,
      y: meter.y + meter.h + 4 + Config.FONT_SIZE + 3,
      w: 18,
      h: 14,
    },
    chest: { x: stage.x + stage.w - side_w - 12, y: mid_y, w: side_w, h: 16 },
  };
}

// Skills modal geometry: centered panel holding the upgrade lattice as a
// horizontal chip row (one chip per track, connectors in the gutters), an
// info block for the selected track, and one buy button on the base line.
// Chips are returned as ready rects so draw and hit-test share one row; the
// row shrinks chip widths honestly at narrow windows (never wraps).
export function skills_panel(ww: number, wh: number, count: number) {
  const pad = Config.LAYOUT_MARGIN;
  const pw = Math.min(Config.SKILLS_PANEL_WIDTH, ww - pad * 2);
  const ph = Math.min(Config.SKILLS_PANEL_HEIGHT, wh - pad * 2);
  const px = Math.floor((ww - pw) / 2);
  const py = Math.floor((wh - ph) / 2);
  const n = Math.max(1, count | 0);
  const gap = Config.SKILLS_CHIP_GAP;
  const chip_w = Math.max(36, Math.floor((pw - pad * 2 - gap * (n - 1)) / n));
  const chip_h = Config.SKILLS_CHIP_HEIGHT;
  const chips_y = py + pad + Config.FONT_SIZE + 10;
  const chips: Rect[] = [];
  for (let i = 0; i < n; i++) {
    chips.push({ x: px + pad + i * (chip_w + gap), y: chips_y, w: chip_w, h: chip_h });
  }
  const bh = Config.UPGRADE_BUY_BTN_HEIGHT;
  const info_top = chips_y + chip_h + 12;
  const buy = {
    x: px + pad, y: py + ph - pad - Config.FONT_SIZE - 10 - bh,
    w: pw - pad * 2, h: bh,
  };
  return {
    panel: { x: px, y: py, w: pw, h: ph },
    chips,
    info_top,
    info_w: pw - pad * 2,
    buy,
  };
}

// Head offsets around the stage center for a monster pack: symmetric around
// 0 so the middle head sits on the old single-monster spot. Clicker.draw and
// the MainScene hit-test share this so visuals and clicks never disagree.
export function party_offsets(count: number, spacing: number): number[] {
  const n = Math.max(1, count | 0);
  const offs: number[] = [];
  for (let i = 0; i < n; i++) offs.push(Math.round((i - (n - 1) / 2) * spacing));
  return offs;
}

const Layout = {
  rail_width,
  rail_tab,
  rail_body,
  zones,
  bar_items,
  prestige_panel,
  stats_panel,
  stats_rect,
  meter_rect,
  pickup_spots,
  party_offsets,
  fit_rail,
  roster_grid,
  roster_slot,
  pull_geometry,
  waifu_detail,
  area_menu,
  skills_panel,
};

export default Layout;
