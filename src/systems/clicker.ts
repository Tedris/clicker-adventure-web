// src/systems/clicker.ts
// Click mechanics: monsters, clicks, rewards, pop feedback, crits.
// Ported from src/systems/clicker.lua. Drawing takes a
// CanvasRenderingContext2D instead of love.graphics; no love.* APIs.

import Config from "../config";
import Format from "../format";
import type { GameState } from "../state";
import Prestige from "./prestige";
import Stats from "./stats";

export interface MonsterDef {
  name: string;
  sprite_key: string;
  color: number[];
  exp_requirement?: number;
  humor_lines: string[];
}

export interface ClickReward {
  gold: number;
  exp: number;
  tokens: number;
}

export interface NumberPop {
  x: number;
  y: number;
  amount: number;
  is_token: boolean;
  is_exp: boolean;
  is_crit: boolean;
  timer: number;
  life: number;
  float_distance: number;
  size: number;
  color: number[];
}

export interface Stage {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Structural contract for the Upgrades instance attached to a Clicker
// (kept optional-method-friendly so UI/sim stubs stay assignable).
export interface UpgradesLike {
  upgrades?: Record<string, number>;
  Definitions?: Record<string, { effect_per_level: (level: number) => number }>;
  get_click_multiplier?: () => number;
  get_crit_chance?: () => number;
  next_affordable?: (state: GameState) => [string | null, number | null];
  save_toward?: (
    state: GameState,
  ) => { key: string; cost: number; deficit: number } | null;
}

export interface KillProgress {
  mode: string;
  target: string | null;
  value: number;
  needed: number | null;
  progress: number;
}

function log(...args: unknown[]): void {
  if (Config.DEBUG_MODE) console.log(...args);
}

export class Clicker {
  upgrades?: UpgradesLike;
  monsters: MonsterDef[] = [
    {
      name: "Placeholder Slime",
      sprite_key: "mon_slime",
      color: [100, 200, 100, 255],
      humor_lines: [
        "I'm just a green rectangle for now. Don't judge.",
        "If the programmer were a better artist, I'd look more like a slime.",
        "My viscosity is my retirement fund. Also my art budget.",
        "I contain multitudes. Mostly pixels.",
        "At least I'm not a goblin. Yet.",
      ],
    },
    {
      name: "Placeholder Goblin",
      sprite_key: "mon_goblin",
      color: [180, 120, 80, 255],
      humor_lines: [
        "I'm just a brown rectangle. Try not to stare.",
        "If the programmer were a better artist, I'd look more like a goblin.",
        "My clipboard is placeholder art. So am I.",
        "I'd complain about my sprite resolution, but I don't have hands.",
        "At least I'm not a slime. Yet.",
      ],
    },
    {
      name: "Spreadsheet Skeleton",
      sprite_key: "mon_skeleton",
      color: [155, 89, 182, 255],
      exp_requirement: Config.EXP_THRESHOLD_1,
      humor_lines: [
        "My ribs are just a filing cabinet.",
        "I put the 'dead' in spreadsheet.",
        "I run on caffeine and compliance reports.",
        "My skeleton key opens zero doors. Just folders.",
        "I've been filing since the dawn of time. Literally.",
      ],
    },
    {
      name: "Compliance Cyclops",
      sprite_key: "mon_cyclops",
      color: [231, 76, 60, 255],
      exp_requirement: Config.EXP_THRESHOLD_2,
      humor_lines: [
        "One eye on the rules, one eye on the clock.",
        "I don't break regulations. I enforce them. Aggressively.",
        "My eye isn't scary. My audit findings are.",
        "I see everything. Especially your policy violations.",
        "Compliance isn't a suggestion. It's my entire personality.",
      ],
    },
    {
      name: "Middle-Manager Mimic",
      sprite_key: "mon_mimic",
      color: [243, 156, 18, 255],
      exp_requirement: Config.EXP_THRESHOLD_3,
      humor_lines: [
        "I'm not a chest. I'm a quarterly review.",
        "My management style is... delegated.",
        "Synergy! Just like a mimic and its trapdoor.",
        "I don't eat adventurers. I eat productivity.",
        "Circle back. Let's take this offline. Also I'm a chest.",
      ],
    },
  ];

  current_monster: MonsterDef | null = null;
  monster_state = "alive"; // alive, dead, respawning
  anim_timer = 0;
  idle_offset = 0;
  humor_line = "";
  humor_timer = 0;
  humor_visible = false;
  pops: NumberPop[] = [];
  // FEEL-04: death-fade click buffer. Runtime-only, never persisted.
  pending_clicks: Record<string, never>[] = [];
  flushed_results: ClickReward[] = [];
  crit_flash_timer = 0;
  shake_timer = 0;
  shake_offset_x = 0;
  shake_offset_y = 0;
  compression_timer = 0;
  compression_amount = 0;
  compression_phase = "none"; // compressing, rebounding
  fade_timer = 0;
  fade_alpha = 1.0;
  fade_direction = "in"; // in, out
  pos_x = 0;
  pos_y = 0;
  hit_flash_timer = 0;
  unlock_message = "";
  unlock_message_timer = 0;

  constructor(upgrades?: UpgradesLike) {
    this.upgrades = upgrades;
    log("[INFO] [CLICKER] Module loaded successfully");
    this.spawn_new_monster(); // pre-state contract, see method doc
  }

  // state is OPTIONAL and null only at construction, before the game has a
  // state to hand; after boot every respawn path passes it.
  spawn_new_monster(state?: GameState): void {
    const exp = state ? state.exp || 0 : 0;

    const available: MonsterDef[] = [];
    for (const monster of this.monsters) {
      if (!monster.exp_requirement || exp >= monster.exp_requirement) {
        available.push(monster);
      }
    }

    if (available.length === 0 && this.monsters.length > 0) {
      available.push(...this.monsters.slice(0, Math.min(2, this.monsters.length)));
    }

    const idx = Math.floor(Math.random() * available.length);
    this.current_monster = available[idx];
    const lines = this.current_monster.humor_lines;
    this.humor_line = lines[Math.floor(Math.random() * lines.length)];
    this.humor_timer = 0;
    this.humor_visible = true;
    this.monster_state = "alive";
    this.fade_alpha = 0.0;
    this.fade_direction = "in";
    this.fade_timer = 0;
    this.compression_amount = 0;
    this.compression_phase = "none";
    this.pos_x = 0;
    this.pos_y = 0;

    log(
      `[INFO] [CLICKER] Monster spawned: ${this.current_monster.name} at (${this.pos_x}, ${this.pos_y})`,
    );
  }

  // Integer crit roll, 1..100 like Lua math.random(1, 100).
  private _roll(): number {
    return Math.floor(Math.random() * 100) + 1;
  }

  click(state: GameState): ClickReward {
    if (!state) throw new Error("State must be provided");
    if (this.monster_state !== "alive") {
      throw new Error("Can only click alive monsters");
    }
    if (Config.DEBUG_MODE) {
      console.log(`[DEBUG] Clicker:click called, monster_state=${this.monster_state}`);
    }

    let click_mult = 1;
    if (this.upgrades?.get_click_multiplier) {
      click_mult = this.upgrades.get_click_multiplier();
    }
    const base_gold = Config.BASE_CLICK_VALUE * click_mult;
    const base_exp = Config.EXP_PER_CLICK;
    let exp_mult = 1;
    if (this.upgrades?.Definitions?.exp_multiplier) {
      const exp_mult_level = this.upgrades.upgrades?.exp_multiplier || 0;
      exp_mult = this.upgrades.Definitions.exp_multiplier.effect_per_level(
        exp_mult_level,
      );
    }

    // Crit chance comes from the upgrade line (base + per-level bump);
    // Config.CRIT_CHANCE is the fallback floor for callers without upgrades.
    let crit_chance = Config.CRIT_CHANCE;
    if (typeof this.upgrades?.get_crit_chance === "function") {
      try {
        const value = this.upgrades.get_crit_chance();
        if (typeof value === "number") crit_chance = value;
      } catch {
        // pcall-equivalent: a broken stub falls back to the config floor.
      }
    }
    const is_crit = this._roll() <= crit_chance;
    const multiplier = is_crit ? Config.CRIT_MULTIPLIER : 1;

    // D-02: prestige multiplier amplifies gold ONLY; exp/tokens stay on the
    // pre-prestige line. Derived live from prestige_points, never stored.
    const prestige_mult = Prestige.gold_multiplier(state);
    const gold_earned = base_gold * multiplier * prestige_mult;
    const exp_earned = base_exp * exp_mult * multiplier;

    // `|| 0` guards and the max(0, ...) clamp normalize nil/negative
    // currency (dirty save) at the gain site.
    state.gold = Math.max(0, (state.gold || 0) + gold_earned);
    state.exp = Math.max(0, (state.exp || 0) + exp_earned);
    state.prestige_gold_since_rebirth =
      (state.prestige_gold_since_rebirth || 0) + gold_earned;

    const tokens_earned = Config.TOKEN_PER_CLICK * multiplier;
    state.tokens = (state.tokens || 0) + tokens_earned;

    state.session_clicks = (state.session_clicks || 0) + 1;
    if (is_crit) {
      state.session_crits = (state.session_crits || 0) + 1;
    }
    // STATS-01/02: lifetime counters ride the SAME payment path as the
    // session pair — one recorder call reads is_crit once.
    Stats.record_click(state, is_crit);

    log(
      `[INFO] [CLICKER] Clicked for ${gold_earned} gold, ${exp_earned} exp, ${tokens_earned} tokens`,
    );
    if (is_crit) {
      log(
        `[WARN] [CLICKER] Crit hit! 2x rewards: ${gold_earned} gold, ${exp_earned} exp, ${tokens_earned} tokens`,
      );
    }

    this._spawn_pop(gold_earned, false, false, is_crit);
    if (exp_earned > 0) {
      this._spawn_pop(exp_earned, false, true, false);
    }
    this._spawn_pop(tokens_earned, true, false, false);

    if (is_crit) {
      this.crit_flash_timer = Config.CRIT_FLASH_DURATION;
      this.shake_timer = Config.SCREEN_SHAKE_DURATION;
    }
    this.hit_flash_timer = 0.1;

    this.compression_phase = "compressing";
    this.compression_timer = 0;
    this.compression_amount = 0.15;

    this.monster_state = "dead";
    this.fade_direction = "out";
    this.fade_timer = 0;

    return { gold: gold_earned, exp: exp_earned, tokens: tokens_earned };
  }
  // FEEL-04: queue a click intent that arrived while the monster was dead.
  // Capped FIFO: when full, the OLDEST intent is evicted and the eviction
  // count (1) is returned; 0 when the token was accepted. Payment still
  // happens only in click() via _flush_click_buffer.
  buffer_click(): number {
    let evictions = 0;
    if (this.pending_clicks.length >= Config.CLICK_BUFFER_CAPACITY) {
      this.pending_clicks.shift();
      evictions = 1;
    }
    this.pending_clicks.push({});
    return evictions;
  }

  // Drain-and-clear view of the results produced by the last flush.
  take_flushed_results(): ClickReward[] {
    const out = this.flushed_results;
    this.flushed_results = [];
    return out;
  }

  // Re-drive buffered intents at the true alive flip. Each intent is paid
  // through the real click() path; successive payments re-spawn between
  // tokens so click() is never entered while dead.
  private _flush_click_buffer(state: GameState): void {
    if (this.pending_clicks.length === 0) return;
    const n = this.pending_clicks.length;
    this.pending_clicks = [];
    for (let i = 0; i < n; i++) {
      const r = this.click(state);
      this.flushed_results.push(r);
      if (i < n - 1) {
        this.spawn_new_monster(state);
      }
    }
  }

  private _spawn_pop(
    amount: number,
    is_token: boolean,
    is_exp: boolean,
    is_crit: boolean,
  ): void {
    const center_x = Config.WINDOW_WIDTH / 2 + this.pos_x;
    const center_y =
      Config.WINDOW_HEIGHT / 2 +
      this.pos_y -
      Config.MONSTER_SIZE / 2 -
      10;

    // Stack vertically
    const offset_y = this.pops.length * Config.POP_GAP;

    let pop_life = is_crit ? Config.POP_CRIT_LIFE : Config.POP_NORMAL_LIFE;
    let pop_float = is_crit ? Config.POP_CRIT_FLOAT : Config.POP_NORMAL_FLOAT;
    let pop_size = is_crit ? Config.POP_CRIT_SIZE : Config.POP_NORMAL_SIZE;
    let pop_color = Config.POP_COLOR_WHITE;

    if (is_token) {
      pop_life = Config.POP_TOKEN_LIFE;
      pop_float = Config.POP_TOKEN_FLOAT;
      pop_size = Config.POP_TOKEN_SIZE;
      pop_color = Config.POP_COLOR_TOKEN;
    } else if (is_exp) {
      pop_color = Config.POP_COLOR_EXP;
    } else if (is_crit) {
      pop_color = Config.POP_COLOR_CRIT_GOLD;
    } else {
      pop_color = Config.POP_COLOR_GOLD;
    }

    this.pops.push({
      x: center_x,
      y: center_y - offset_y,
      amount,
      is_token,
      is_exp,
      is_crit,
      timer: 0,
      life: pop_life,
      float_distance: pop_float,
      size: pop_size,
      color: pop_color,
    });
  }
  update(dt: number, state: GameState): void {
    this.anim_timer = this.anim_timer + dt;

    // Idle bob: sinusoidal 4px amplitude, 1s cycle
    this.idle_offset =
      Math.sin((this.anim_timer * Math.PI * 2) / Config.MONSTER_IDLE_CYCLE) *
      Config.MONSTER_IDLE_AMPLITUDE;

    // Humor bubble timer
    if (this.humor_visible) {
      this.humor_timer = this.humor_timer + dt;
      if (this.humor_timer >= Config.HUMOR_BUBBLE_LIFETIME) {
        this.humor_visible = false;
      }
    }

    this._check_exp_unlocks(state);

    // Fade out (monster death)
    if (this.fade_direction === "out") {
      this.fade_timer = this.fade_timer + dt;
      this.fade_alpha = Math.max(
        0,
        1.0 - this.fade_timer / Config.MONSTER_FADE_DURATION,
      );
      if (this.fade_alpha <= 0) {
        this.spawn_new_monster(state);
        this.fade_direction = "in";
        this.fade_timer = 0;
        this._flush_click_buffer(state);
      }
    }

    // Fade in (respawn)
    if (this.fade_direction === "in") {
      this.fade_timer = this.fade_timer + dt;
      this.fade_alpha = Math.min(
        1.0,
        this.fade_timer / Config.MONSTER_FADE_DURATION,
      );
      if (this.fade_alpha >= 1.0) {
        this.fade_direction = "none";
        this.monster_state = "alive";
      }
    }

    // Hit flash decay
    if (this.hit_flash_timer > 0) {
      this.hit_flash_timer = this.hit_flash_timer - dt;
    }

    // Compression animation
    if (this.compression_phase === "compressing") {
      this.compression_timer = this.compression_timer + dt;
      const t = this.compression_timer / Config.MONSTER_COMPRESS_DURATION;
      this.compression_amount = 0.15 * (1 - t);
      if (t >= 1) {
        this.compression_phase = "rebounding";
        this.compression_timer = 0;
      }
    } else if (this.compression_phase === "rebounding") {
      this.compression_timer = this.compression_timer + dt;
      const t = this.compression_timer / Config.MONSTER_REBOUND_DURATION;
      this.compression_amount = -0.05 * Math.sin((t * Math.PI) / 2);
      if (t >= 1) {
        this.compression_amount = 0;
        this.compression_phase = "none";
      }
    }

    // Crit flash timer
    if (this.crit_flash_timer > 0) {
      this.crit_flash_timer = this.crit_flash_timer - dt;
    }

    // Screen shake
    if (this.shake_timer > 0) {
      this.shake_timer = this.shake_timer - dt;
      const remaining_frames = Math.ceil(this.shake_timer * 60);
      this.shake_offset_x = (Math.random() * 2 - 1) * Config.SCREEN_SHAKE_AMOUNT;
      this.shake_offset_y = (Math.random() * 2 - 1) * Config.SCREEN_SHAKE_AMOUNT;
      if (remaining_frames <= 0) {
        this.shake_timer = 0;
        this.shake_offset_x = 0;
        this.shake_offset_y = 0;
      }
    }

    // Update number pops
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const pop = this.pops[i];
      pop.timer = pop.timer + dt;
      const progress = pop.timer / pop.life;
      pop.y = pop.y - pop.float_distance * (dt / pop.life);
      pop.color[3] = 255 * (1 - progress);
      if (progress >= 1.0) {
        this.pops.splice(i, 1);
      }
    }

    // Update unlock message timer
    if (this.unlock_message_timer > 0) {
      this.unlock_message_timer = this.unlock_message_timer - dt;
      if (this.unlock_message_timer <= 0) {
        this.unlock_message = "";
        this.unlock_message_timer = 0;
      }
    }
  }

  private _check_exp_unlocks(state: GameState): void {
    const unlocked_set: Record<string, true> =
      state.exp_thresholds_unlocked || {};
    const new_unlocks: MonsterDef[] = [];

    for (const monster of this.monsters) {
      if (
        monster.exp_requirement &&
        !unlocked_set[monster.name] &&
        state.exp >= monster.exp_requirement
      ) {
        unlocked_set[monster.name] = true;
        new_unlocks.push(monster);
      }
    }

    state.exp_thresholds_unlocked = unlocked_set;

    if (new_unlocks.length > 0) {
      const monster = new_unlocks[0];
      this.unlock_message = `New monster unlocked: ${monster.name}!`;
      this.unlock_message_timer = Config.UNLOCK_MESSAGE_LIFETIME;
      log(`[INFO] [CLICKER] Monster unlocked: ${monster.name}`);
    }
  }
  // Kill-progress meter helper (FEEL-01): while a gated tier remains locked,
  // mode = "exp" tracks state.exp toward that threshold over the band since
  // the previous one. Once every gated tier is unlocked the bar repurposes to
  // mode = "purchase" toward the recommended next buy. Pure: never mutates
  // state; recomputed per call.
  get_kill_progress(state: GameState): KillProgress {
    if (!state) throw new Error("State must be provided");
    const exp = state.exp || 0;
    const unlocked: Record<string, true> = state.exp_thresholds_unlocked || {};

    // Walk monsters in definition order; the first gated monster not yet in
    // the unlocked set is the target. prev_threshold tracks the band start.
    let prev_threshold = 0;
    for (const monster of this.monsters) {
      if (monster.exp_requirement) {
        if (!unlocked[monster.name]) {
          const denom = monster.exp_requirement - prev_threshold;
          const raw = denom > 0 ? (exp - prev_threshold) / denom : 0;
          return {
            mode: "exp",
            target: monster.name,
            value: exp,
            needed: monster.exp_requirement,
            progress: Math.max(0, Math.min(1, raw)),
          };
        }
        prev_threshold = monster.exp_requirement;
      }
    }

    // All gated tiers unlocked: repurpose to the recommended next purchase.
    // Null-safe: works with a real Upgrades instance, a stub, or no upgrades.
    let key: string | null | undefined;
    let cost: number | null | undefined;
    if (this.upgrades) {
      if (typeof this.upgrades.next_affordable === "function") {
        [key, cost] = this.upgrades.next_affordable(state);
      }
      if (!key && typeof this.upgrades.save_toward === "function") {
        const toward = this.upgrades.save_toward(state);
        if (toward) {
          key = toward.key;
          cost = toward.cost;
        }
      }
    }
    if (key && cost && cost > 0) {
      return {
        mode: "purchase",
        target: key,
        value: state.gold || 0,
        needed: cost,
        progress: Math.max(0, Math.min(1, (state.gold || 0) / cost)),
      };
    }
    return {
      mode: "purchase",
      target: null,
      value: state.gold || 0,
      needed: null,
      progress: 0,
    };
  }
  // Bubble geometry clamp: long humor lines shrink/slide to stay inside the
  // stage rect; the tail keeps pointing at the monster. Returns [x, width].
  _clamp_bubble(cx: number, width: number, stage?: Stage): [number, number] {
    if (!stage) return [cx - width / 2, width];
    const w = Math.min(width, stage.w - 8);
    let x = cx - w / 2;
    const min_x = stage.x + 4;
    const max_x = stage.x + stage.w - 4 - w;
    if (x < min_x) {
      x = min_x;
    } else if (x > max_x) {
      x = max_x;
    }
    return [x, w];
  }

  draw(ctx: CanvasRenderingContext2D, stage?: Stage): void {
    const cx = Config.WINDOW_WIDTH / 2 + this.pos_x;
    const cy = Config.WINDOW_HEIGHT / 2 + this.pos_y + this.idle_offset;
    const S = Config.MONSTER_SIZE;

    ctx.save();
    // Apply screen shake
    if (this.shake_timer > 0) {
      ctx.translate(this.shake_offset_x, this.shake_offset_y);
    }

    // Apply compression scale (squash and stretch)
    const scale_x = 1.0 - this.compression_amount;
    const scale_y = 1.0 + this.compression_amount * 0.5;

    // Monster: colored rectangle with fade; the pixel-art sprite lookup of
    // the LÖVE build is replaced by the plain canvas rect here.
    const mc = this.current_monster ? this.current_monster.color : Config.POP_COLOR_WHITE;
    ctx.fillStyle = rgba(mc, (mc[3] / 255) * this.fade_alpha);
    ctx.fillRect(
      cx - (S * scale_x) / 2,
      cy - (S * scale_y) / 2,
      S * scale_x,
      S * scale_y,
    );

    // Hit flash overlay
    if (this.hit_flash_timer > 0) {
      const flash_alpha = (this.hit_flash_timer / 0.1) * 0.7;
      ctx.fillStyle = rgba([255, 255, 255], flash_alpha);
      ctx.fillRect(cx - S / 2, cy - S / 2, S, S);
    }

    // Crit flash (render white overlay)
    if (this.crit_flash_timer > 0) {
      ctx.fillStyle =
        rgba([255, 255, 255], (this.crit_flash_timer / Config.CRIT_FLASH_DURATION) * 0.5);
      ctx.fillRect(cx - S / 2, cy - S / 2, S, S);
    }

    ctx.restore();

    if (this.humor_visible) {
      this._draw_humor_bubble(ctx, cx, cy - Config.MONSTER_SIZE - 10, stage);
    }
    for (const pop of this.pops) {
      this._draw_pop(ctx, pop);
    }
  }

  private _draw_humor_bubble(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    stage?: Stage,
  ): void {
    const text = this.humor_line;
    const padding = 16;
    const tail_width = 6;
    const tail_height = 8;

    // Calculate width based on character count with extra padding
    let bubble_width = Math.max(120, text.length * 7 + padding * 2 + 30);
    let [bubble_x, w] = this._clamp_bubble(x, bubble_width, stage);
    bubble_width = w;
    // Clamped bubbles wrap; grow the body with the line count.
    const inner = Math.max(40, bubble_width - padding * 2);
    const lines = Math.max(1, Math.ceil((text.length * 7) / inner));
    const bubble_height = 12 + lines * 13;
    const bubble_y = y - bubble_height;

    // Bubble body
    ctx.fillStyle = rgba([255, 255, 255], 0.86);
    ctx.fillRect(bubble_x, bubble_y, bubble_width, bubble_height);

    // Tail, kept on the bubble even when the body was clamped away.
    const tail_x = Math.max(
      bubble_x + tail_width + 4,
      Math.min(x, bubble_x + bubble_width - tail_width - 4),
    );
    ctx.beginPath();
    ctx.moveTo(tail_x, bubble_y + bubble_height);
    ctx.lineTo(tail_x - tail_width, bubble_y + bubble_height + tail_height);
    ctx.lineTo(tail_x + tail_width, bubble_y + bubble_height + tail_height);
    ctx.closePath();
    ctx.fill();

    // Text (single centered line; canvas fillText does not wrap)
    ctx.fillStyle = rgba([0, 0, 0], 0.86);
    ctx.font = `${Config.FONT_SIZE}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(text, bubble_x + bubble_width / 2, bubble_y + bubble_height / 2 + Config.FONT_SIZE / 3);
  }

  private _draw_pop(ctx: CanvasRenderingContext2D, pop: NumberPop): void {
    const c = pop.color;
    ctx.fillStyle = rgba(c, c[3] / 255);
    const text = `+${Format.number(pop.amount)}`;
    const scale = (pop.size || Config.FONT_SIZE) / Config.FONT_SIZE;
    ctx.font = `${Config.FONT_SIZE * scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(text, pop.x, pop.y);
  }
}

function rgba(c: number[], alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

export default Clicker;



