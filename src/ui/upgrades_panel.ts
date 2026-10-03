// src/ui/upgrades_panel.ts
// The Skills modal: the upgrade lattice rendered as its own centered panel
// (same modal family as Stats/Prestige/Area menu). The lattice reads as a
// horizontal chip row — one chip per track in chain order with connector
// segments in the gutters — plus an info block for the selected track and a
// single buy button. All cost/gating math comes from the Upgrades system;
// the UI never re-derives it. Geometry from Layout.skills_panel with
// explicit (width, height); no DOM access.

import Config from "../config";
import Format from "../format";
import Layout, { type Rect } from "./layout";
import { PRIORITY } from "../systems/upgrades";
import type { GameState } from "../state";
import type { Upgrades } from "../systems/upgrades";

export type PurchaseHandler = (key: string, name: string, level: number) => void;

export interface TargetCue {
  key: string;
  kind: "afford" | "save";
  deficit?: number;
}

function rgba(c: readonly number[], alpha?: number): string {
  const a = Math.max(0, Math.min(1, alpha ?? (c.length > 3 ? c[3] / 255 : 1)));
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
}

function draw_text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color: readonly number[],
  opts?: { size?: number; align?: "center"; box?: number },
): void {
  ctx.fillStyle = rgba(color);
  ctx.font = `${opts?.size ?? Config.FONT_SIZE}px sans-serif`;
  ctx.textAlign = opts?.align ?? "left";
  ctx.textBaseline = "top";
  ctx.fillText(s, Math.round(x), Math.round(y), opts?.box);
}

export class UpgradePanel {
  upgrades: Upgrades;
  event_handler: PurchaseHandler | null;
  purchase_animations: Record<string, number> = {};
  shake_animations: Record<string, { timer: number }> = {};
  sparkle_animations: Record<string, number> = {};
  cue_pulse = 0; // afford-glow pulse clock (runtime-only)
  keys: string[];
  // Selected chip key; null falls back to the chain tip (first live track).
  selected: string | null = null;
  // Kept for call-site compatibility with the old rail layout; the modal is
  // always the full panel.
  collapsed = false;

  constructor(upgrades: Upgrades, event_handler?: PurchaseHandler | null) {
    this.upgrades = upgrades;
    this.event_handler = event_handler ?? null;
    // Pets-Go reading order: the row IS the skill chain — each chip sits
    // right of the track that unlocks it (PRIORITY is the chain order).
    this.keys = [...PRIORITY];
  }

  card_keys(): string[] {
    return this.keys;
  }

  geometry(width: number, height: number): ReturnType<typeof Layout.skills_panel> {
    return Layout.skills_panel(width, height, this.keys.length);
  }

  // The modal does not scroll; kept so the wheel router can stay generic.
  scroll_by(_amount: number, width: number, height: number): Rect {
    return this.geometry(width, height).panel;
  }

  is_over_rail(x: number, y: number, width: number, height: number): boolean {
    const p = this.geometry(width, height).panel;
    return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
  }

  selected_key(): string {
    if (this.selected && this.keys.includes(this.selected)) return this.selected;
    for (const key of this.keys) {
      if (!this.upgrades.is_maxed(key) && this.upgrades.is_unlocked(key)) return key;
    }
    return this.keys[0];
  }

  // Chip select -> buy button routing. Returns true when the click landed on
  // the modal's own controls (the scene closes on any other click).
  check_click(x: number, y: number, state: GameState, width: number, height: number): boolean {
    const p = this.geometry(width, height);
    for (let i = 0; i < this.keys.length; i++) {
      const c = p.chips[i];
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        this.selected = this.keys[i];
        return true;
      }
    }
    const b = p.buy;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      const key = this.selected_key();
      if (this.upgrades.is_maxed(key)) {
        this.on_sparkle(key);
        return true;
      }
      if (!this.upgrades.is_unlocked(key)) {
        this.on_shake(key);
        return true;
      }
      if (this.upgrades.can_afford(key, state)) {
        const level = this.upgrades.purchase(key, state);
        this.on_purchase(key);
        // FEEL-03 (D-11): a purchase spend is a discrete ledger event —
        // the scene fires the coalesced lane + gold flash here.
        if (this.event_handler) {
          this.event_handler(key, this.upgrades.Definitions[key].name, level);
        }
        return true;
      }
      this.on_shake(key);
      return true;
    }
    return false;
  }

  update_hover(_x: number, _y: number, _width: number, _height: number): void {
    // Modal chips need no hover lane; kept for the shared hover router.
  }

  update(dt: number): void {
    this.cue_pulse = this.cue_pulse + dt;
    for (const [key, timer] of Object.entries(this.purchase_animations)) {
      const next = Math.max(0, timer - dt);
      if (next <= 0) delete this.purchase_animations[key];
      else this.purchase_animations[key] = next;
    }
    for (const [key, anim] of Object.entries(this.shake_animations)) {
      anim.timer = Math.max(0, anim.timer - dt);
      if (anim.timer <= 0) delete this.shake_animations[key];
    }
    for (const [key, timer] of Object.entries(this.sparkle_animations)) {
      const next = Math.max(0, timer - dt);
      if (next <= 0) delete this.sparkle_animations[key];
      else this.sparkle_animations[key] = next;
    }
  }

  on_purchase(key: string): void { this.purchase_animations[key] = 0.3; }
  on_shake(key: string): void { this.shake_animations[key] = { timer: 0.3 }; }
  on_sparkle(key: string): void { this.sparkle_animations[key] = 0.3; }

  draw(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number): void {
    const p = this.geometry(width, height);

    // Dim + panel: the shared modal language.
    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_DIM_COLOR);
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_PANEL_COLOR);
    ctx.fillRect(p.panel.x, p.panel.y, p.panel.w, p.panel.h);
    ctx.strokeStyle = rgba(Config.OFFLINE_REPORT_BORDER_COLOR);
    ctx.lineWidth = 2;
    ctx.strokeRect(p.panel.x, p.panel.y, p.panel.w, p.panel.h);
    ctx.lineWidth = 1;

    draw_text(ctx, "Skills", p.panel.x, p.panel.y + Config.LAYOUT_MARGIN,
      Config.OFFLINE_REPORT_TITLE_COLOR, { align: "center", box: p.panel.w });

    const cue = this._target_cue(state);
    const selected = this.selected_key();

    // Connectors first so chips sit on top of the chain line.
    ctx.strokeStyle = rgba([158, 158, 178, 255], 0.5);
    ctx.lineWidth = 2;
    for (let i = 1; i < p.chips.length; i++) {
      const a = p.chips[i - 1];
      const b = p.chips[i];
      const mid_y = a.y + Math.floor(a.h / 2);
      ctx.beginPath();
      ctx.moveTo(a.x + a.w, mid_y);
      ctx.lineTo(b.x, mid_y);
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    for (let i = 0; i < this.keys.length; i++) {
      this._draw_chip(ctx, this.keys[i], p.chips[i], selected, cue);
    }

    this._draw_info(ctx, p, state, selected, cue);

    draw_text(ctx, "tap outside to close", p.panel.x, p.panel.y + p.panel.h + 6,
      Config.OFFLINE_REPORT_HINT_COLOR, { align: "center", box: p.panel.w });
  }

  private _draw_chip(
    ctx: CanvasRenderingContext2D,
    key: string,
    c: Rect,
    selected: string,
    cue: TargetCue | null,
  ): void {
    const def = this.upgrades.Definitions[key];
    const level = this.upgrades.upgrades[key] || 0;
    const maxed = this.upgrades.is_maxed(key);
    const unlocked = this.upgrades.is_unlocked(key);

    if (cue && cue.key === key && cue.kind === "afford") {
      const glow = 0.25 + 0.15 * Math.sin(this.cue_pulse * 4);
      ctx.fillStyle = rgba(def.color, glow);
      ctx.fillRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
    }

    if (!unlocked) {
      ctx.fillStyle = rgba(Config.UPGRADE_DISABLED_COLOR, 0.5);
    } else {
      ctx.fillStyle = rgba(def.color, maxed ? 0.95 : 0.8);
    }
    ctx.fillRect(c.x, c.y, c.w, c.h);

    if (key === selected) {
      ctx.strokeStyle = rgba(Config.POP_COLOR_WHITE);
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.lineWidth = 1;
    }

    const flash = this.purchase_animations[key];
    if (flash && flash > 0) {
      ctx.fillStyle = rgba(def.color, (flash / 0.3) * 0.5);
      ctx.fillRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
    }

    const icon_y = c.y + 6;
    draw_text(ctx, def.icon, c.x, icon_y, Config.POP_COLOR_WHITE,
      { size: Config.FONT_SIZE * 1.5, align: "center", box: c.w });
    const lv_text = maxed ? "MAX" : `${Format.number(level)}`;
    draw_text(ctx, lv_text, c.x, c.y + c.h - Config.FONT_SIZE - 6,
      unlocked ? Config.POP_COLOR_WHITE : Config.OFFLINE_REPORT_HINT_COLOR,
      { align: "center", box: c.w });
  }

  private _draw_info(
    ctx: CanvasRenderingContext2D,
    p: ReturnType<typeof Layout.skills_panel>,
    state: GameState,
    key: string,
    cue: TargetCue | null,
  ): void {
    const def = this.upgrades.Definitions[key];
    const level = this.upgrades.upgrades[key] || 0;
    const maxed = this.upgrades.is_maxed(key);
    const lh = Config.FONT_SIZE + 5;
    let y = p.info_top;

    draw_text(ctx, `${def.name}  Lv ${Format.number(level)}/${Format.number(def.max_level)}`,
      p.chips[0].x, y, Config.POP_COLOR_WHITE);
    y = y + lh + 4;

    const locked = !maxed && !this.upgrades.is_unlocked(key);
    if (locked) {
      const gate = this.upgrades.locked_by(key);
      draw_text(ctx, gate ? `Needs ${gate[0]} Lv${gate[1]}` : "Locked",
        p.chips[0].x, y, Config.OFFLINE_REPORT_HINT_COLOR);
    } else {
      draw_text(ctx, maxed ? def.description(level) : def.description(level + 1),
        p.chips[0].x, y, Config.POP_COLOR_WHITE);
    }
    y = p.buy.y - lh - 4;
    if (cue && cue.key === key && cue.kind === "save" && cue.deficit !== undefined) {
      draw_text(ctx, `Bank ${Format.number(cue.deficit)} more gold`,
        p.chips[0].x, y, Config.OFFLINE_REPORT_HINT_COLOR);
    }

    // Buy button: one lane, same wording ladder as the old rail cards.
    const b = p.buy;
    const affordable = !maxed && !locked && this.upgrades.can_afford(key, state ?? ({} as GameState));
    let btn_text: string;
    if (maxed) {
      btn_text = "MAX";
    } else if (locked) {
      const gate = this.upgrades.locked_by(key);
      btn_text = gate ? `Needs ${gate[0]} Lv${gate[1]}` : "Locked";
    } else if (!affordable) {
      btn_text = "NOT ENOUGH";
    } else {
      btn_text = "BUY " + Format.number(this.upgrades.get_cost(key, level)) + "G";
    }
    ctx.strokeStyle = rgba(
      maxed || locked || !affordable ? Config.UPGRADE_DISABLED_COLOR : Config.UPGRADE_BUY_BTN_COLOR,
      0.7,
    );
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    draw_text(ctx, btn_text, b.x, b.y + 7, Config.POP_COLOR_WHITE,
      { align: "center", box: b.w });
  }

  // FEEL-02: the single target cue — cheapest affordable live track (glow)
  // or, when none is affordable, the cheapest live track to bank toward.
  _target_cue(state: GameState | null): TargetCue | null {
    const st = (state ?? {}) as GameState;
    const [key] = this.upgrades.next_affordable(st);
    if (key) return { key, kind: "afford" };
    const toward = this.upgrades.save_toward(st);
    if (toward) return { key: toward.key, kind: "save", deficit: toward.deficit };
    return null;
  }
}

export default UpgradePanel;
