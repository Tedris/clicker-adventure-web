// src/ui/pull_screen.ts
// Port of src/ui/pull_screen.lua: the summoning overlay state machine.
// waiting -> circle_appear -> circle_rotating (pulse + orbit symbols) ->
// particle_burst -> waifu_reveal (shake) -> waifu_display -> dismissed.
// The reveal always reads the PULLED waifu's OWN personality entry from
// Config.WAIFU_PERSONALITY — never another waifu's lines. Geometry from
// Layout.pull_geometry with explicit (width, height); no love.* calls.

import Config from "../config";
import Layout from "./layout";
import { createSpriteCanvas } from "../pixelart";
import type { GameState, WaifuInstance } from "../state";
import type { WaifuPersonality } from "../config";
import type { Gacha, PullResult } from "../systems/gacha";
import Mastery from "../systems/mastery";
import type { Waifu } from "../systems/waifu";

const STATE_WAITING = "waiting";
const STATE_CIRCLE_APPEARING = "circle_appear";
const STATE_CIRCLE_ROTATING = "circle_rotating";
const STATE_PARTICLE_BURST = "particle_burst";
const STATE_WAIFU_REVEAL = "waifu_reveal";
const STATE_WAIFU_DISPLAY = "waifu_display";
const STATE_DISMISSED = "dismissed";

// Animation-phase timings (seconds) — mirrors the Lua module locals.
const TIMING_WAITING = 0.2;
const TIMING_CIRCLE_APPEAR = 0.3;
const TIMING_CIRCLE_ROTATING = 3.0;
const TIMING_PARTICLE_BURST = 0.5;
const TIMING_WAIFU_REVEAL = 0.3;

interface OrbitSymbol {
  type: string;
  angle: number;
  distance: number;
  local_rotation: number;
  scale_pulse: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  alpha: number;
  type: string;
  rotation: number;
  rotation_speed: number;
}

function rgba(c: readonly number[], alpha?: number): string {
  const a = Math.max(0, Math.min(1, alpha ?? (c.length > 3 ? c[3] / 255 : 1)));
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
}
export class PullScreen {
  gacha: Gacha | null;
  state: GameState;
  waifu: Waifu | null;
  pull_result: PullResult | null;
  pulled_waifu: WaifuInstance | null = null;
  current_state = STATE_WAITING;
  state_timer = 0;
  circle_scale = 0;
  circle_rotation = 0;
  inner_ring_rotation = 0;
  circle_progress = 0;
  // Live viewport size, stamped by draw()/mousepressed() so geometry helpers
  // stay window-derived without threading (w, h) through every private call.
  _w: number = Config.WINDOW_WIDTH;
  _h: number = Config.WINDOW_HEIGHT;
  particles: Particle[] = [];
  revealed = false;
  dismissed = false;
  humor_line: string | null = null;
  first_pull_line: string | null = null;
  happy_timer = 0;
  shake_offset_x = 0;
  shake_offset_y = 0;
  shake_timer = 0;
  shake_active = false;
  shake_amount = 0;
  shake_duration = 0;
  shake_frame = 0;
  pulled_personality: WaifuPersonality | null = null;
  orbit_symbols: OrbitSymbol[];

  constructor(gacha: Gacha | null, state: GameState, waifu: Waifu | null, result: PullResult | null) {
    this.gacha = gacha;
    this.state = state;
    this.waifu = waifu;
    this.pull_result = result;
    // Orbiting office-supply symbols, at the Config orbit distance.
    const d = Config.SUMMON_ORBIT_DISTANCE;
    this.orbit_symbols = [
      { type: "paperclip", angle: 0, distance: d, local_rotation: 0, scale_pulse: 1 },
      { type: "calculator", angle: Math.PI / 2, distance: d * 0.9, local_rotation: 0, scale_pulse: 1 },
      { type: "stapler", angle: Math.PI, distance: d * 1.1, local_rotation: 0, scale_pulse: 1 },
      { type: "plus", angle: Math.PI * 1.5, distance: d * 0.8, local_rotation: 0, scale_pulse: 1 },
      { type: "clipboard", angle: Math.PI * 0.3, distance: d * 1.0, local_rotation: 0, scale_pulse: 1 },
      { type: "ink_drop", angle: Math.PI * 0.7, distance: d * 1.05, local_rotation: 0, scale_pulse: 1 },
      { type: "paper", angle: Math.PI * 1.2, distance: d * 0.95, local_rotation: 0, scale_pulse: 1 },
      { type: "stapler", angle: Math.PI * 0.5, distance: d * 1.15, local_rotation: 0, scale_pulse: 1 },
    ];
  }

  private transition_to(new_state: string): void {
    this.current_state = new_state;
    this.state_timer = 0;
  }

  update(dt: number): void {
    this.state_timer = this.state_timer + dt;

    if (this.current_state === STATE_WAITING) {
      if (this.state_timer >= TIMING_WAITING) this.transition_to(STATE_CIRCLE_APPEARING);
    } else if (this.current_state === STATE_CIRCLE_APPEARING) {
      if (this.state_timer >= TIMING_CIRCLE_APPEAR) {
        this.state_timer = 0;
        this.circle_scale = 1;
        this.transition_to(STATE_CIRCLE_ROTATING);
      } else {
        this.circle_scale = this.state_timer / TIMING_CIRCLE_APPEAR;
      }
    } else if (this.current_state === STATE_CIRCLE_ROTATING) {
      this.circle_rotation = this.circle_rotation + Config.SUMMON_ROTATION_SPEED * dt;
      this.inner_ring_rotation = this.inner_ring_rotation + Config.SUMMON_INNER_ROTATION_SPEED * dt;
      this.circle_progress = this.state_timer / TIMING_CIRCLE_ROTATING;
      for (const sym of this.orbit_symbols) {
        sym.angle = sym.angle + Config.SUMMON_ROTATION_SPEED * 0.5 * dt;
        sym.local_rotation = sym.local_rotation + Config.SUMMON_PARTICLE_ROTATION_SPEED * dt;
        sym.scale_pulse = Math.sin(this.state_timer * 3.0 + sym.angle) * 0.1 + 1.0;
      }
      if (this.state_timer >= TIMING_CIRCLE_ROTATING) {
        this._spawn_particles();
        this.transition_to(STATE_PARTICLE_BURST);
      }
    } else if (this.current_state === STATE_PARTICLE_BURST) {
      this._update_particles(dt);
      if (this.state_timer >= TIMING_PARTICLE_BURST) {
        this._reveal_waifu();
        this.transition_to(STATE_WAIFU_REVEAL);
      }
    } else if (this.current_state === STATE_WAIFU_REVEAL) {
      if (!this.shake_active) {
        this.shake_active = true;
        this.shake_timer = 0;
        this.shake_amount = Config.SUMMON_REVEAL_SHAKE_AMOUNT;
        this.shake_duration = Config.SUMMON_REVEAL_SHAKE_DURATION;
        this.shake_frame = 0;
      }
      this.shake_timer = this.shake_timer + dt;
      this.shake_frame = this.shake_frame + 1;
      const falloff = 1 - this.shake_timer / this.shake_duration;
      this.shake_offset_x = Math.sin(this.shake_frame * 2.5) * this.shake_amount * falloff;
      this.shake_offset_y = Math.cos(this.shake_frame * 3.7) * this.shake_amount * falloff;
      if (this.shake_timer >= this.shake_duration) this.shake_active = false;
      if (this.state_timer >= TIMING_WAIFU_REVEAL) {
        this.shake_active = false;
        this.shake_offset_x = 0;
        this.shake_offset_y = 0;
        this.revealed = true;
        if (this.waifu) {
          this.waifu.set_animation_state("happy");
          this.happy_timer = 0;
        }
        this.transition_to(STATE_WAIFU_DISPLAY);
      }
    } else if (this.current_state === STATE_WAIFU_DISPLAY) {
      this.happy_timer = this.happy_timer + dt;
      if (this.happy_timer >= Config.WAIFU_HAPPY_COLOR_DURATION && this.waifu) {
        this.waifu.set_animation_state("idle");
      }
      // Wait for player input (dismissal handled in mousepressed).
    }
    // STATE_DISMISSED: no update needed.
  }

  // Rarity of whatever this screen reveals (or already shows). Reads
  // pull_result too: the burst fires BEFORE _reveal_waifu, so pulled_waifu
  // may still be nil while the result is set.
  _pulled_rarity(): (typeof Config.WAIFU_RARITIES)[number] | null {
    const waifu = this.pulled_waifu ?? this.pull_result?.waifu ?? null;
    if (waifu && waifu.rarity) return Config.WAIFU_RARITY_BY_KEY[waifu.rarity] ?? null;
    return null;
  }
  private _spawn_particles(): void {
    this.particles = [];
    const types = ["paperclip", "calculator", "stapler", "paper", "ink_drop"];
    const rnd = Math.random;
    // Burst spawns around the summon circle's live center (shared geometry).
    const count0 = Config.SUMMON_PARTICLE_COUNT;
    let count = count0;
    const rarity = this._pulled_rarity();
    if (rarity && rarity.key === "legendary") count = count * 2;
    // Circle metrics for the spawn ring — same formula as draw's geometry.
    const g = this._geometry();
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: g.cx + (rnd() - 0.5) * g.circle * 0.2,
        y: g.cy + (rnd() - 0.5) * g.circle * 0.2,
        vx: (rnd() - 0.5) * 200,
        vy: (rnd() - 0.5) * 200 - 30,
        life: 0.8 + rnd() * 0.6,
        size: 2 + rnd() * 6,
        alpha: 1.0,
        type: types[Math.floor(rnd() * types.length)],
        rotation: rnd() * Math.PI * 2,
        rotation_speed: (rnd() - 0.5) * Config.SUMMON_PARTICLE_ROTATION_SPEED * 2,
      });
    }
  }

  private _update_particles(dt: number): void {
    for (const p of this.particles) {
      p.x = p.x + p.vx * dt;
      p.y = p.y + p.vy * dt;
      p.vy = p.vy + Config.SUMMON_PARTICLE_GRAVITY * dt;
      p.rotation = p.rotation + p.rotation_speed * dt;
      p.life = p.life - dt;
      p.alpha = Math.max(0, p.life / 0.8);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  _reveal_waifu(): void {
    const result = this.pull_result;
    if (result && result.success && result.waifu) {
      this.pulled_waifu = result.waifu;
    } else {
      // A re-pull can miss (BASE_DROP_RATE is 2%). Must NOT fall back to
      // the last roster waifu: that replays the previous summon.
      this.pulled_waifu = null;
    }

    if (this.pulled_waifu) {
      this.pulled_personality = Config.WAIFU_PERSONALITY[this.pulled_waifu.name] ?? {};
      if (this.waifu && !this.waifu.first_pull_shown) {
        this.waifu.first_pull_shown = true;
        this.first_pull_line = this.waifu.get_first_pull_line();
      } else if (this.waifu) {
        this.humor_line = this.waifu.get_periodic_line();
      }
    }
  }

  // All overlay geometry from the shared pure layout; draw and hit-test
  // share one rect source. Live size is stamped by draw()/mousepressed().
  private _geometry(): ReturnType<typeof Layout.pull_geometry> {
    return Layout.pull_geometry(this._w, this._h);
  }
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this._w = width;
    this._h = height;
    // Background fade in
    let bg_alpha = 0.85;
    if (this.current_state === STATE_WAITING) {
      bg_alpha = Math.min(1, this.state_timer / TIMING_WAITING) * 0.85;
    }
    ctx.fillStyle = rgba(Config.SUMMON_PULL_BG, bg_alpha);
    ctx.fillRect(0, 0, width, height);

    if (this.current_state === STATE_WAITING) return;

    const g = this._geometry();
    const cx = g.cx;
    const cy = g.cy;

    ctx.save();
    if (this.shake_active) ctx.translate(this.shake_offset_x, this.shake_offset_y);

    {
      ctx.save();
      ctx.translate(cx, cy);
      const radius = (g.circle / 2) * this.circle_scale;
      if (radius > 0) {
        const circle_color = this._lerp_circle_color();
        let circle_alpha = circle_color[3] / 255;
        const fade = this.circle_progress > Config.SUMMON_CIRCLE_FADE_START
          ? 1 - ((this.circle_progress - Config.SUMMON_CIRCLE_FADE_START) /
              (1 - Config.SUMMON_CIRCLE_FADE_START))
          : 1;

        if (this.current_state === STATE_CIRCLE_ROTATING) {
          const pulse = Math.sin(this.state_timer * Config.SUMMON_CIRCLE_PULSE_SPEED * Math.PI * 2) * 0.2 + 0.8;
          this._circle(ctx, radius, circle_color, Config.SUMMON_CIRCLE_GLOW_ALPHA * pulse,
            3 + Config.SUMMON_CIRCLE_GLOW_SIZE);
          this._circle(ctx, radius, circle_color, circle_alpha * pulse, 3);
        } else {
          circle_alpha = circle_alpha * fade;
          this._circle(ctx, radius, circle_color, circle_alpha, 3);
        }

        // Inner rotating ring.
        const inner_color = Config.SUMMON_INNER_RING_COLOR;
        this._circle(ctx, radius * Config.SUMMON_INNER_RING_RATIO, inner_color,
          (inner_color[3] / 255) * fade, Config.SUMMON_INNER_RING_WIDTH);
      }

      // Orbiting office-supply symbols (distance scales with the circle).
      for (const sym of this.orbit_symbols) {
        const ox = Math.cos(sym.angle) * sym.distance * g.orbit_scale;
        const oy = Math.sin(sym.angle) * sym.distance * g.orbit_scale;
        this._draw_office_symbol(ctx, sym.type, ox, oy, 8, sym.local_rotation, sym.scale_pulse, 0.7);
      }
      ctx.restore();
    }

    // Themed particles.
    for (const p of this.particles) {
      this._draw_office_symbol(ctx, p.type, p.x, p.y, p.size, p.rotation, 1, p.alpha);
    }

    // Waifu reveal — the PULLED waifu's own name/skill/bonus lines.
    if (this.revealed && this.pulled_waifu) {
      const w = Config.WAIFU_SPRITE_SIZE;
      const wx = cx - w / 2;
      const wy = cy - w / 2;
      const personality = this.pulled_personality ??
        Config.WAIFU_PERSONALITY[this.pulled_waifu.name];

      // Glow behind the waifu, in the pulled waifu's reveal color.
      const glow_color = personality?.reveal_color ?? Config.WAIFU_REACTION_COLOR;
      const glow_intensity = personality?.glow_intensity ?? 0.5;
      const glow_size = w * 1.5;
      ctx.fillStyle = rgba(glow_color, glow_intensity);
      ctx.fillRect(cx - glow_size / 2, cy - glow_size / 2, glow_size, glow_size);

      // Sprite: neutral-gray map modulated by the pulled personality color;
      // rect fallback keeps no-DOM hosts honest.
      const tint = personality?.reveal_color ?? Config.WAIFU_IDLE_COLOR;
      const sprite = createSpriteCanvas(this.pulled_waifu.name, w / Config.SPRITE_PIXEL_SIZE);
      if (sprite && ctx.drawImage) {
        ctx.drawImage(sprite, wx, wy);
      } else {
        ctx.fillStyle = rgba(tint);
        ctx.fillRect(wx, wy, w, w);
      }

      const iw = Math.min(320, width - 2 * Config.LAYOUT_MARGIN);
      const ix = cx - iw / 2;
      const label = personality?.reveal_label ?? this.waifu?.get_state_label() ?? "";
      this._center_text(ctx, label, ix, wy - 18, iw);

      let info_y = wy + w + 10;
      this._center_text(ctx, this.pulled_waifu.name, ix, info_y, iw);
      const rarity = this._pulled_rarity();
      if (rarity) {
        info_y = info_y + 18;
        this._center_text(ctx, `${rarity.stars} ${rarity.name}`, ix, info_y, iw, rarity.color);
      }
      info_y = info_y + 18;
      this._center_text(ctx, "Cheat Skill: " + (personality?.skill ?? "Office Synergy"), ix, info_y, iw);
      info_y = info_y + 16;
      this._center_text(ctx, this._bonus_text(this.pulled_waifu), ix, info_y, iw);

      if (this.first_pull_line || this.humor_line) {
        info_y = info_y + 16;
        const line = `'${this.first_pull_line ?? this.humor_line}'`;
        this._center_text(ctx, line, ix, info_y, iw, Config.WAIFU_HUMOR_COLOR);
      }

      // Buttons: shared-layout rects; Pull Again dims without tokens.
      const can_again = (this.state.tokens ?? 0) >= Config.PULL_COST;
      const again_label = "Pull Again" + (can_again ? "" : ` (${Config.PULL_COST}T)`);
      this._draw_button(ctx, again_label, g.pull_again, can_again);
      this._draw_button(ctx, "Done", g.done, true);
    }

    // Missed re-pull (2% drop rate): show the miss note in place of the
    // waifu and keep both buttons live, or the overlay would sit there with
    // nothing to click. Text mirrors the main-scene pull-fail toast.
    if (this.revealed && !this.pulled_waifu) {
      const iw = Math.min(320, width - 2 * Config.LAYOUT_MARGIN);
      const luck = Mastery.luck_multiplier(this.state);
      const luck_note = luck > 1 ? ` Luck ${luck.toFixed(2)}x` : "";
      this._center_text(ctx, `No summon... Pity: ${this.state.pity_counter ?? 0}/${Config.PITY_HARD}${luck_note}`,
        cx - iw / 2, cy - 8, iw);
      const can_again = (this.state.tokens ?? 0) >= Config.PULL_COST;
      this._draw_button(ctx, "Pull Again" + (can_again ? "" : ` (${Config.PULL_COST}T)`), g.pull_again, can_again);
      this._draw_button(ctx, "Done", g.done, true);
    }

    ctx.restore();
  }
  // Rarity stars + bonus line shared by roster cards and reveals.
  private _bonus_text(waifu: WaifuInstance): string {
    const label = Config.WAIFU_BONUS_LABELS[waifu.bonus_type as keyof typeof Config.WAIFU_BONUS_LABELS];
    if (label) {
      return `+${Math.round((waifu.bonus_value ?? 0) * 100)}% ${label}`;
    }
    return `+${waifu.bonus_value ?? 0} bonus`;
  }

  // Circle outline helper (line-mode love circle -> canvas arc + stroke).
  private _circle(
    ctx: CanvasRenderingContext2D,
    radius: number,
    color: readonly number[],
    alpha: number,
    line_width: number,
  ): void {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = line_width;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(0.5, radius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Circle color lerps SUMMON_CIRCLE_COLOR -> INNER_RING_COLOR -> pink over
  // the rotating phase, mirroring the Lua two-leg lerp.
  private _lerp_circle_color(): number[] {
    const c1 = Config.SUMMON_CIRCLE_COLOR;
    const c2 = Config.SUMMON_INNER_RING_COLOR;
    const c3 = [255, 107, 157, 255];
    const t = this.circle_progress ?? 0;
    const mix = (a: number, b: number, lt: number): number =>
      a + (b - a) * lt;
    if (t < 0.5) {
      const lt = t / 0.5;
      return [mix(c1[0], c2[0], lt), mix(c1[1], c2[1], lt), mix(c1[2], c2[2], lt), mix(c1[3], c2[3], lt)];
    }
    const lt = (t - 0.5) / 0.5;
    return [mix(c2[0], c3[0], lt), mix(c2[1], c3[1], lt), mix(c2[2], c3[2], lt), mix(c2[3], c3[3], lt)];
  }

  // Consolidated office-symbol / themed-particle renderer: the Lua drew the
  // same shapes twice (orbit + burst lanes); one switch covers both.
  private _draw_office_symbol(
    ctx: CanvasRenderingContext2D,
    type: string,
    x: number,
    y: number,
    size: number,
    rotation: number,
    scale: number,
    alpha: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation || 0);
    ctx.scale(scale || 1, scale || 1);
    ctx.strokeStyle = rgba(Config.SUMMON_PARTICLE_COLOR, alpha);
    ctx.fillStyle = rgba(Config.SUMMON_PARTICLE_COLOR, alpha);
    ctx.lineWidth = 1.5;
    const s = size;
    ctx.beginPath();
    if (type === "paperclip") {
      ctx.moveTo(-s / 2, 0); ctx.lineTo(s / 2, 0);
      ctx.moveTo(-s / 2, 0); ctx.lineTo(-s / 2, s);
      ctx.moveTo(-s / 2, s); ctx.lineTo(s / 2, s);
      ctx.moveTo(s / 2, s); ctx.lineTo(s / 2, 0);
      ctx.stroke();
    } else if (type === "calculator") {
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      for (let row = 0; row <= 1; row++) {
        for (let col = 0; col <= 2; col++) {
          const dx = -s / 3 + col * (s / 3);
          const dy = -s / 4 + row * (s / 2);
          ctx.fillRect(dx - 1, dy - 1, 2, 2);
        }
      }
    } else if (type === "stapler") {
      ctx.fillRect(-s, -s / 3, s * 2, s * 0.6);
      ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
      ctx.stroke();
    } else if (type === "plus") {
      ctx.moveTo(-s / 2, 0); ctx.lineTo(s / 2, 0);
      ctx.moveTo(0, -s / 2); ctx.lineTo(0, s / 2);
      ctx.stroke();
    } else if (type === "clipboard") {
      ctx.strokeRect(-s / 2, -s / 3, s, s * 0.8);
      ctx.beginPath();
      ctx.arc(0, -s / 3 - 2, 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === "ink_drop") {
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.5, s * 0.4), 0, Math.PI * 2);
      ctx.fill();
    } else if (type === "paper") {
      ctx.fillRect(-s / 2, -s / 2, s, s);
    }
    ctx.lineWidth = 1;
    ctx.restore();
  }

  private _center_text(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    box_w: number,
    color?: readonly number[],
  ): void {
    ctx.fillStyle = rgba(color ?? Config.POP_COLOR_WHITE);
    ctx.font = `px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(text, Math.round(x + box_w / 2), Math.round(y));
  }

  // Styled button: fill + border + centered label; disabled draws
  // translucent so the dimmed Pull Again reads as inert.
  private _draw_button(
    ctx: CanvasRenderingContext2D,
    text: string,
    r: { x: number; y: number; w: number; h: number },
    enabled: boolean,
  ): void {
    const c = enabled ? Config.PULL_BTN_COLOR : Config.UPGRADE_DISABLED_COLOR;
    ctx.fillStyle = rgba(c, (c[3] / 255) * (enabled ? 1 : 0.6));
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = rgba([255, 255, 255, 255], enabled ? 0.9 : 0.4);
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 1;
    ctx.fillStyle = rgba(Config.POP_COLOR_WHITE, enabled ? 1 : 0.5);
    ctx.font = `${Config.FONT_SIZE}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2));
  }

  // In the display state a click elsewhere is swallowed (must not leak to
  // the monster/bar underneath the overlay); elsewhere a click skips the
  // animation. Returns true when the click was consumed.
  mousepressed(x: number, y: number, width?: number, height?: number): boolean {
    if (width !== undefined) this._w = width;
    if (height !== undefined) this._h = height;
    if (this.dismissed) return false;

    if (this.current_state === STATE_WAIFU_DISPLAY) {
      const g = this._geometry();
      const again = g.pull_again;
      const done = g.done;
      if (x >= again.x && x <= again.x + again.w && y >= again.y && y <= again.y + again.h) {
        if (this.gacha && (this.state.tokens ?? 0) >= Config.PULL_COST) {
          this._reset_for_new_pull();
        }
        return true;
      }
      if (x >= done.x && x <= done.x + done.w && y >= done.y && y <= done.y + done.h) {
        this.dismissed = true;
        return true;
      }
      return true;
    }
    this.dismissed = true;
    return true;
  }

  private _reset_for_new_pull(): void {
    if (!this.gacha) return;
    this.current_state = STATE_CIRCLE_APPEARING;
    this.state_timer = 0;
    this.circle_scale = 0;
    this.circle_rotation = 0;
    this.inner_ring_rotation = 0;
    this.circle_progress = 0;
    this.particles = [];
    this.revealed = false;
    this.dismissed = false;
    this.shake_active = false;
    this.shake_offset_x = 0;
    this.shake_offset_y = 0;
    this.shake_timer = 0;
    this.pulled_personality = null;
    this.humor_line = null;
    this.first_pull_line = null;
    this.happy_timer = 0;
    for (const sym of this.orbit_symbols) {
      sym.local_rotation = 0;
      sym.scale_pulse = 1.0;
    }

    // pull_result MUST be swapped here: the animation's _reveal_waifu step
    // reads it, so leaving the previous result in place would replay the
    // same summon on every "Pull Again". Humor lines roll at reveal time.
    const result = this.gacha.pull(this.state);
    this.pull_result = result;
    this.pulled_waifu = result && result.success && result.waifu ? result.waifu : null;
  }
}

export default PullScreen;
