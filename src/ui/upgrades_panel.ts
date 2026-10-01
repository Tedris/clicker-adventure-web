// src/ui/upgrades_panel.ts
// Port of src/ui/upgrades.lua: the left upgrade rail. Cards are fitted by
// Layout.fit_rail (compressed heights, wheel-scrollable overflow), buy
// buttons route through the Upgrades system, and the FEEL-02 target cue
// comes from next_affordable / save_toward — the UI never re-derives cost
// or order math. Geometry takes explicit (width, height); no DOM access.

import Config from "../config";
import Format from "../format";
import Layout, { type Rect } from "./layout";
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
  opts?: { size?: number; alpha?: number },
): void {
  ctx.fillStyle = rgba(color, opts?.alpha);
  ctx.font = `${opts?.size ?? Config.FONT_SIZE}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(s, Math.round(x), Math.round(y));
}
export class UpgradePanel {
  upgrades: Upgrades;
  event_handler: PurchaseHandler | null;
  hovered_card: number | null = null;
  purchase_animations: Record<string, number> = {};
  shake_animations: Record<string, { timer: number }> = {};
  sparkle_animations: Record<string, number> = {};
  scroll_offset = 0;
  cue_pulse = 0; // FEEL-02: afford-glow pulse clock (runtime-only)
  keys: string[];

  constructor(upgrades: Upgrades, event_handler?: PurchaseHandler | null) {
    this.upgrades = upgrades;
    this.event_handler = event_handler ?? null;
    this.keys = Object.keys(upgrades.Definitions).sort();
  }

  card_keys(): string[] {
    return this.keys;
  }

  // Live rail rect + fitted card size; clamps scroll into the overflow range.
  geometry(width: number, height: number): { rail: Rect; fit: ReturnType<typeof Layout.fit_rail> } {
    const z = Layout.zones(width, height);
    const fit = Layout.fit_rail(z.rail_l.h, this.keys.length);
    this.scroll_offset = Math.max(0, Math.min(fit.overflow, this.scroll_offset));
    return { rail: z.rail_l, fit };
  }

  scroll_by(amount: number, width: number, height: number): Rect {
    const { rail, fit } = this.geometry(width, height);
    this.scroll_offset = Math.max(0, Math.min(fit.overflow, this.scroll_offset + amount));
    return rail;
  }

  is_over_rail(x: number, y: number, width: number, height: number): boolean {
    const rail = Layout.zones(width, height).rail_l;
    return x >= rail.x && x <= rail.x + rail.w && y >= rail.y && y <= rail.y + rail.h;
  }

  // 0-based card slot rect (index scrolls with scroll_offset).
  card_position(index: number, width: number, height: number): Rect {
    const { rail, fit } = this.geometry(width, height);
    return {
      x: rail.x,
      y: rail.y + index * (fit.size + fit.gap) - this.scroll_offset,
      w: rail.w,
      h: fit.size,
    };
  }

  buy_button_position(card: Rect): Rect {
    return {
      x: card.x + 8,
      y: card.y + card.h - Config.UPGRADE_BUY_BTN_HEIGHT - 4,
      w: card.w - 16,
      h: Config.UPGRADE_BUY_BTN_HEIGHT,
    };
  }
  // Hit-test the buy buttons; mirrors the Lua check_click branches:
  // maxed -> sparkle, affordable -> purchase + event, else shake.
  check_click(x: number, y: number, state: GameState, width: number, height: number): boolean {
    for (let i = 0; i < this.keys.length; i++) {
      const card = this.card_position(i, width, height);
      const btn = this.buy_button_position(card);
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        const upgrade_key = this.keys[i];
        if (!upgrade_key) continue;
        if (this.upgrades.is_maxed(upgrade_key)) {
          this.on_sparkle(upgrade_key);
          return true;
        }
        if (this.upgrades.can_afford(upgrade_key, state)) {
          const level = this.upgrades.purchase(upgrade_key, state);
          this.on_purchase(upgrade_key);
          // FEEL-03 (D-11): a purchase spend is a discrete ledger event —
          // the scene fires the coalesced lane + gold flash here.
          if (this.event_handler) {
            this.event_handler(upgrade_key, this.upgrades.Definitions[upgrade_key].name, level);
          }
          return true;
        }
        this.on_shake(upgrade_key);
        return true;
      }
    }
    return false;
  }

  update_hover(x: number, y: number, width: number, height: number): void {
    let new_hovered: number | null = null;
    for (let i = 0; i < this.keys.length; i++) {
      const card = this.card_position(i, width, height);
      if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) {
        new_hovered = i;
        break;
      }
    }
    this.hovered_card = new_hovered;
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
    const { rail, fit } = this.geometry(width, height);
    // FEEL-02 (D-09): one target cue per frame, computed by the pure helpers
    // in systems/upgrades.ts — the UI never re-derives cost/order math.
    const cue = this._target_cue(state);
    for (let i = 0; i < this.keys.length; i++) {
      const pos = this.card_position(i, width, height);
      // Clip to the rail: overflow scrolls, it never bleeds onto the bar/HUD.
      if (pos.y + pos.h > rail.y && pos.y < rail.y + rail.h) {
        this._draw_card(ctx, this.keys[i], pos, state, cue);
      }
    }
  }

  // FEEL-02: the single target cue — cheapest affordable track (glow) or,
  // when none is affordable, the cheapest not-yet-maxed track to bank toward.
  _target_cue(state: GameState | null): TargetCue | null {
    const st = (state ?? {}) as GameState;
    const [key] = this.upgrades.next_affordable(st);
    if (key) return { key, kind: "afford" };
    const toward = this.upgrades.save_toward(st);
    if (toward) return { key: toward.key, kind: "save", deficit: toward.deficit };
    return null;
  }

  private _draw_card(
    ctx: CanvasRenderingContext2D,
    key: string,
    pos: Rect,
    state: GameState | null,
    cue: TargetCue | null,
  ): void {
    const def = this.upgrades.Definitions[key];
    const level = this.upgrades.upgrades[key] || 0;
    const maxed = this.upgrades.is_maxed(key);
    const affordable = !maxed && this.upgrades.can_afford(key, (state ?? {}) as GameState);

    // FEEL-02 afford-glow: pulsing 2px-expanded rect in the track color.
    if (cue && cue.key === key && cue.kind === "afford") {
      const glow = 0.25 + 0.15 * Math.sin(this.cue_pulse * 4);
      ctx.fillStyle = rgba(def.color, glow);
      ctx.fillRect(pos.x - 2, pos.y - 2, pos.w + 4, pos.h + 4);
    }

    // Card background; the save-toward card tints grey ("not yet", not "off").
    if (cue && cue.key === key && cue.kind === "save") {
      ctx.fillStyle = rgba(Config.UPGRADE_DISABLED_COLOR, 0.35);
    } else {
      ctx.fillStyle = rgba(Config.BG_COLOR, 0.15);
    }
    ctx.fillRect(pos.x, pos.y, pos.w, pos.h);

    // Hover border only.
    const index = this.keys.indexOf(key);
    if (this.hovered_card === index) {
      ctx.strokeStyle = rgba([158, 158, 178, 255]);
      ctx.lineWidth = 2;
      ctx.strokeRect(pos.x, pos.y, pos.w, pos.h);
      ctx.lineWidth = 1;
    }

    // Purchase flash / sparkle overlays.
    const flash = this.purchase_animations[key];
    if (flash && flash > 0) {
      ctx.fillStyle = rgba(def.color, (flash / 0.3) * 0.5);
      ctx.fillRect(pos.x - 2, pos.y - 2, pos.w + 4, pos.h + 4);
    }
    const sparkle = this.sparkle_animations[key];
    if (sparkle && sparkle > 0) {
      ctx.fillStyle = rgba(def.color, (sparkle / 0.3) * 0.4);
      ctx.fillRect(pos.x - 1, pos.y - 1, pos.w + 2, pos.h + 2);
    }

    // Icon (1.5x), name, level right-aligned.
    draw_text(ctx, def.icon, pos.x + 8, pos.y + 8, def.color, { size: Config.FONT_SIZE * 1.5 });
    draw_text(ctx, def.name, pos.x + 24, pos.y + 8, Config.POP_COLOR_WHITE);
    draw_text(ctx, `Lv:${level}`, pos.x + pos.w - 60, pos.y + 8, [128, 128, 128, 255]);

    // Cost text only on full-height cards; compact cards show it on the button.
    if (pos.h >= 78) {
      const cost_text = maxed
        ? "MAX"
        : "Cost: " + Format.number(this.upgrades.get_cost(key, level));
      draw_text(ctx, cost_text, pos.x + pos.w - 60, pos.y + 22, [128, 128, 128, 255]);
    }

    // Effect description, kept clear of the buy button on compressed cards.
    const effect_text = maxed ? def.description(level) : def.description(level + 1);
    draw_text(ctx, effect_text, pos.x + 8, pos.y + pos.h - 44, [128, 128, 128, 255]);

    const btn = this.buy_button_position(pos);
    const save_deficit = cue && cue.key === key && cue.kind === "save" ? cue.deficit : undefined;
    this._draw_buy_button(ctx, btn, key, level, maxed, affordable, save_deficit);
  }

  private _draw_buy_button(
    ctx: CanvasRenderingContext2D,
    btn: Rect,
    key: string,
    level: number,
    maxed: boolean,
    affordable: boolean,
    save_deficit?: number,
  ): void {
    let btn_text: string;
    if (maxed) {
      btn_text = "MAX";
    } else if (save_deficit !== undefined) {
      btn_text = "need " + Format.number(save_deficit) + " gold";
    } else if (!affordable) {
      btn_text = "NOT ENOUGH";
    } else {
      btn_text = "BUY " + Format.number(this.upgrades.get_cost(key, level)) + "G";
    }

    if (maxed || !affordable) {
      ctx.strokeStyle = rgba(Config.UPGRADE_DISABLED_COLOR, 0.6);
    } else {
      ctx.strokeStyle = rgba(Config.UPGRADE_BUY_BTN_COLOR, 0.7);
    }
    ctx.lineWidth = 1;
    ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
    draw_text(ctx, btn_text, btn.x + 4, btn.y + 7, Config.POP_COLOR_WHITE);
  }
}

export default UpgradePanel;
