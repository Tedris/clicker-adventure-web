// src/ui/main_scene.ts
// Port of src/ui/main.lua: the whole clicker screen. Background, HUD chips,
// monster (via Clicker.draw), kill meter, upgrade rail (UpgradePanel),
// roster rail, bottom bar, toast lanes, modals and the click/hover/wheel
// routing. All numbers come from Config, geometry from Layout with explicit
// (width, height) — never hardcoded here. No DOM access: draw() takes the
// canvas context directly.

import Config from "../config";
import Format from "../format";
import Layout, { type CollapseOpts, type Rect, type RosterGrid } from "./layout";
import createState from "../state";
import { createSpriteCanvas } from "../pixelart";
import Achievements from "../systems/achievements";
import Areas, { type NodeFlags } from "../systems/areas";
import Prestige from "../systems/prestige";
import UpgradePanel from "./upgrades_panel";
import type { Clicker } from "../systems/clicker";
import type { Passive } from "../systems/passive";
import type { Upgrades } from "../systems/upgrades";
import type { Debug } from "../systems/debug";
import type { Gacha } from "../systems/gacha";
import type { Waifu } from "../systems/waifu";
import type { Save } from "../systems/save";
import type { GameState } from "../state";
import PullScreen from "./pull_screen";

// PREST-02: PERSIST_SCHEME key -> short human label for the prestige panel's
// keep/reset columns. Unknown keys fall back to the raw key.
const PRESTIGE_LABELS: Record<string, string> = {
  waifus: "Waifus", equipped: "Equipped waifus", tokens: "Tokens",
  last_login_day: "Daily streak", login_streak: "Daily streak",
  total_gold_earned: "Lifetime stats", total_exp_earned: "Lifetime stats",
  total_tokens_earned: "Lifetime stats",
  prestige_points: "Rebirth points", prestige_rebirths: "Rebirth points",
  gold: "Gold", exp: "EXP", upgrades: "Upgrade levels",
  passive_unlocked: "Idle unlock", pity_counter: "Pity",
  exp_thresholds_unlocked: "Monster tiers",
  last_save_time: "(save time)", prestige_gold_since_rebirth: "(rebirth counter)",
};

// Phase 8 Copywriting contract: ONE shared row-string builder so a badge's
// panel row and the unlock toast can never diverge. play_time renders both
// sides clock-form; everything else is plain floored integers.
function achv_progress_text(row: { metric: string; current: number; goal: number }): string {
  if (row.metric === "play_time") {
    return Format.clock(row.current) + "/" + Format.clock(row.goal);
  }
  return String(Math.floor(row.current ?? 0)) + "/" + String(row.goal);
}

// Phase 8 Plan 3 (UI-03, D-09): the O(1) dirty-signature vocabulary. Only
// the ten discrete counter keys — play_time is deliberately excluded so a
// moving every-frame counter cannot degenerate the sweep into a 60fps
// evaluate.
const ACHV_SIG_KEYS = [
  "clicks", "kills", "crits",
  "pulls_total", "pulls_common", "pulls_rare", "pulls_epic", "pulls_legendary",
  "upgrades_bought", "rebirths",
];

// Phase 11 (D-01/D-06): O(1) badge-id -> tier lookup, built once at module
// load. Both the toast suffix and the panel renderer read tier through it.
const tier_by_id: Record<string, string> = {};
for (const def of Config.ACHIEVEMENTS) tier_by_id[def.id] = def.tier;

// Phase 11 (D-06): the reward-amount string, reading the BASE tier amount
// from Config.ACHV_REWARDS (the toast shows the base, not the post-prestige
// actual).
function reward_text(tier: string): string {
  const amounts = Config.ACHV_REWARDS[tier as keyof typeof Config.ACHV_REWARDS];
  return "+" + Format.number(amounts.gold) + "g +" + Format.number(amounts.tokens) + "t";
}

function rgba(c: readonly number[], alpha?: number): string {
  const a = Math.max(0, Math.min(1, alpha ?? (c.length > 3 ? c[3] / 255 : 1)));
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
}
export interface MainSceneDeps {
  clicker?: Clicker | null;
  passive?: Passive | null;
  upgrades?: Upgrades | null;
  debug?: Debug | null;
  gacha?: Gacha | null;
  waifu?: Waifu | null;
  save?: Save | null;
}

export class MainScene {
  clicker: Clicker | null;
  passive: Passive | null;
  upgrades: Upgrades | null;
  debug: Debug | null;
  gacha: Gacha | null;
  waifu: Waifu | null;
  save: Save | null;
  state: GameState | null = null;
  upgrade_ui: UpgradePanel | null = null;
  // Live viewport size, stamped by resize()/draw(); hit-tests read it so
  // draw and hit-testing share one geometry source at ANY window size.
  _w: number = Config.WINDOW_WIDTH;
  _h: number = Config.WINDOW_HEIGHT;

  // Rail collapse state (Clicker Heroes style). Runtime-only, never persisted.
  left_collapsed = false;
  right_collapsed = false;

  show_session_stats = false;
  showing_pull_screen = false;
  pull_screen: PullScreen | null = null;
  humor_timer = 0;
  humor_line: string | null = null;
  humor_lifetime = 0;
  karen_humor_shown: Record<string, true> = {};
  humor_shown_count = 0;
  roster_scroll_offset = 0;
  roster_hover_index: number | null = null;
  // Waifu status overlay: 1-based roster index, null while hidden.
  waifu_detail_index: number | null = null;
  // Story 4.4 AC5: two-step reset confirmation state.
  reset_armed = false;
  // PREST-02 / Phase 8: review modals. Runtime-only, never persisted.
  prestige_panel_open = false;
  prestige_armed = false;
  prestige_confirm_hover = false;
  stats_panel_open = false;
  stats_scroll_offset = 0;
  // Area menu modal (zone picker + area info + quest). Runtime-only.
  area_menu_open = false;
  // Assigned-hire automatic damage accumulator (PS99 idle loop), seconds.
  auto_accum = 0;
  // Respawn countdown per harvestable pickup spot (Coin pile / EXP orb).
  // Runtime-only: the row re-ripens on its own timer, not on the chest.
  pickup_cooldown: Record<"coins" | "exp", number> = { coins: 0, exp: 0 };
  // Last hover position, for wheel routing without an explicit cursor arg.
  _hover_x: number | null = null;
  _hover_y: number | null = null;

  // FEEL-03: coalesced event lane (one message + timer, never a stack) and
  // per-currency HUD value flashes. Runtime-only, never persisted.
  event_toast_message: string | null = null;
  event_toast_timer = 0;
  value_flash: Record<"gold" | "exp" | "token", number> = { gold: 0, exp: 0, token: 0 };
  // Story 4.4 AC7: save-recovery warning + failed-pull toast lanes.
  save_warning_text: string | null = null;
  save_warning_lifetime = 0;
  pull_fail_message: string | null = null;
  pull_fail_timer = 0;
  // Phase 8 Plan 3: unlock punctuation queue + O(1) dirty-signature cache.
  achv_queue: string[] = [];
  _achv_sig = 0;

  constructor(deps: MainSceneDeps = {}) {
    this.clicker = deps.clicker ?? null;
    this.passive = deps.passive ?? null;
    this.upgrades = deps.upgrades ?? null;
    this.debug = deps.debug ?? null;
    this.gacha = deps.gacha ?? null;
    this.waifu = deps.waifu ?? null;
    this.save = deps.save ?? null;
  }

  resize(width: number, height: number): void {
    this._w = width;
    this._h = height;
  }

  load(state: GameState): void {
    this.state = state;
    if (this.upgrades) {
      this.upgrade_ui = new UpgradePanel(this.upgrades, (key, name, level) => {
        // FEEL-03 (D-11): purchase spend is a discrete ledger event. `level`
        // is the NEW level, so the cost just paid is get_cost(key, level - 1).
        const cost = this.upgrades!.get_cost(key, level - 1);
        this.fire_event(
          `Bought ${name} Lv${Format.number(level)} (-${Format.number(cost)} gold)`,
          ["gold"],
        );
        // D-09 purchase site: this callback only runs after a SUCCESSFUL
        // purchase, so record_upgrade has landed and the check is synchronous.
        this._check_unlocks();
      });
    }
    // Consume state.save_warning into a temporary toast and clear the state
    // field so it can never leak into a future save snapshot.
    if (state.save_warning) {
      this.save_warning_text = state.save_warning;
      this.save_warning_lifetime = Config.SAVE_WARNING_LIFETIME;
      state.save_warning = null;
    }
    // Phase 8 Plan 3 (D-10): install the play_time cadence carrier on the
    // save object. force=true: the play_time check runs even though the
    // discrete-counter signature is stable by definition here.
    if (this.save) {
      this.save.on_saved = () => this._check_unlocks(true);
    }
    // D-09 boot site: heal persisted-but-unmarked crossings (ACHV-03).
    this._check_unlocks();
  }
  update(dt: number): void {
    const state = this.state;
    let scaled_dt = dt;
    if (this.debug) scaled_dt = this.debug.getScaledDt();

    if (this.save_warning_lifetime > 0) {
      this.save_warning_lifetime = this.save_warning_lifetime - scaled_dt;
      if (this.save_warning_lifetime <= 0) {
        this.save_warning_lifetime = 0;
        this.save_warning_text = null;
      }
    }
    if (this.pull_fail_timer > 0) {
      this.pull_fail_timer = this.pull_fail_timer - scaled_dt;
      if (this.pull_fail_timer <= 0) {
        this.pull_fail_timer = 0;
        this.pull_fail_message = null;
      }
    }
    // FEEL-03: coalesced event-lane + HUD value-flash decay (D-10/D-11).
    if (this.event_toast_timer > 0) {
      this.event_toast_timer = this.event_toast_timer - scaled_dt;
      if (this.event_toast_timer <= 0) {
        this.event_toast_timer = 0;
        this.event_toast_message = null;
      }
    }
    for (const cur of ["gold", "exp", "token"] as const) {
      if (this.value_flash[cur] > 0) {
        this.value_flash[cur] = Math.max(0, this.value_flash[cur] - scaled_dt);
      }
    }
    // Pickup respawn countdown: piles and orbs re-ripe on their own timer.
    for (const key of ["coins", "exp"] as const) {
      if (this.pickup_cooldown[key] > 0) {
        this.pickup_cooldown[key] = Math.max(0, this.pickup_cooldown[key] - scaled_dt);
      }
    }

    if (this.showing_pull_screen && this.pull_screen) {
      this.pull_screen.update(scaled_dt);
      if (this.pull_screen.dismissed) {
        this.showing_pull_screen = false;
        this.pull_screen = null;
      }
      return;
    }

    if (this.clicker && state) {
      this.clicker.update(scaled_dt, state);
      // FEEL-03 (D-10): coalesce the clicker's transient unlock banner into
      // the single event lane. Read-and-consume so the old dedicated banner
      // lane never double-draws.
      if (this.clicker.unlock_message_timer > 0 && this.clicker.unlock_message !== "") {
        this.fire_event(this.clicker.unlock_message, ["exp"]);
        this.clicker.unlock_message = "";
        this.clicker.unlock_message_timer = 0;
      }
    }
    if (this.upgrade_ui) this.upgrade_ui.update(scaled_dt);

    // PS99 idle loop: hires assigned to the CURRENT area land a click's worth
    // of automatic damage per second, chipping monsters without any input.
    if (state && this.clicker && this.waifu) {
      this.auto_accum = this.auto_accum + scaled_dt;
      if (this.auto_accum >= Config.AUTO_KILL_TICK) {
        this.auto_accum = this.auto_accum % Config.AUTO_KILL_TICK;
        const allies = this.waifu.effective_assigned(state).length;
        if (allies > 0) this.clicker.auto_tick(state, allies);
      }
    }

    // Rail scroll clamping (grid bounds come from the live window size).
    const grid = this._roster_grid();
    this.roster_scroll_offset = Math.max(0, Math.min(grid.max_scroll, this.roster_scroll_offset));
    // Same idiom for the stats badge list (Scroll Contract).
    const sp = Layout.stats_panel(this._w, this._h, Config.ACHIEVEMENTS.length);
    this.stats_scroll_offset = Math.max(0, Math.min(sp.list.max_scroll, this.stats_scroll_offset));

    // Waifu humor system.
    if (this.waifu) {
      this.waifu.update(scaled_dt);
      if (this.waifu.check_humor_trigger(this.humor_timer)) {
        this.humor_timer = 0;
        if (this.humor_shown_count >= 10) {
          this.karen_humor_shown = {};
          this.humor_shown_count = 0;
        }
        const line = this.waifu.get_periodic_line();
        if (line && !this.karen_humor_shown[line]) {
          this.karen_humor_shown[line] = true;
          this.humor_shown_count = this.humor_shown_count + 1;
          this.humor_line = line;
          this.humor_lifetime = Config.WAIFU_HUMOR_LIFETIME;
        }
      }
    }
    if (this.humor_lifetime > 0) {
      this.humor_lifetime = this.humor_lifetime - scaled_dt;
      if (this.humor_lifetime <= 0) {
        this.humor_line = null;
        this.humor_lifetime = 0;
      }
    }

    // Phase 8 Plan 3 (UI-03): counter sweep + queue drain at the FUNCTION
    // TAIL, behind the pull-screen early-return so claims never burn invisibly
    // under the summon animation; at most ONE claim per frame, and the claim
    // waits while a welcome-back report is up (WR-08).
    this._check_unlocks();
    if (this.event_toast_timer <= 0 && this.achv_queue.length > 0 &&
        !(state && (state.offline_report || state.login_report))) {
      this.fire_event(this.achv_queue.shift() ?? "", ["gold", "token"]);
    }
  }

  // FEEL-03 (D-11): light the coalesced event lane + the named currency
  // value-flashes. Called from the explicit grant/spend sites only. A re-fire
  // while the lane is alive resets timer and text — never stacks (D-10).
  fire_event(message: string, currencies?: readonly string[]): void {
    this.event_toast_message = message;
    this.event_toast_timer = Config.EVENT_TOAST_LIFETIME;
    if (currencies) {
      for (const cur of currencies) {
        if (cur === "gold" || cur === "exp" || cur === "token") {
          this.value_flash[cur] = Config.HUD_FLASH_DURATION;
        }
      }
    }
  }
  // Phase 8 Plan 3 (UI-03, D-06/D-09): counter sweep + queue producer. The
  // dirty test is an O(1) sum over ACHV_SIG_KEYS; evaluate -> mark runs only
  // when the signature moved. Ordering is the contract: pending rows are
  // consumed into the queue FIRST, and only then is the id set handed to the
  // sole writer mark_unlocked. `force` bypasses ONLY the sig gate.
  _check_unlocks(force?: boolean): void {
    const state = this.state;
    const s = state?.stats;
    if (!s) return;
    let sum = 0;
    for (const key of ACHV_SIG_KEYS) sum = sum + (s[key] ?? 0);
    if (!force && sum === this._achv_sig) return;
    this._achv_sig = sum;
    const newly = Achievements.evaluate(state);
    if (newly.length === 0) return;
    // ACHV-06: accumulate-then-append-one. One qualifying pass writes exactly
    // ONE merged queue entry — first badge's full row plus " (and N more)".
    let first: string | null = null;
    let count = 0;
    for (const id of newly) {
      const row = Achievements.get_progress(state, id);
      if (row) {
        count = count + 1;
        if (!first) {
          // WR-04: mirror the panel draw path label fallback into the shared
          // producer so a label-less row can never blank the toast.
          const tier = tier_by_id[id] ?? "bronze";
          first = `${row.label ?? row.id}  ${achv_progress_text(row)} · ${reward_text(tier)}`;
        }
      }
    }
    if (first) {
      if (count > 1) {
        first = first + Config.ACHV_TOAST_MORE_SUFFIX.replace("%d", String(count - 1));
      }
      this.achv_queue.push(first);
    }
    // SOLE writer — after consumption, never before (T-08-08 mitigation).
    Achievements.mark_unlocked(state, newly);
  }

  private _collapse(): CollapseOpts {
    return { left: this.left_collapsed, right: this.right_collapsed };
  }

  private _zones(): ReturnType<typeof Layout.zones> {
    return Layout.zones(this._w, this._h, this._collapse());
  }

  private _roster_grid(): RosterGrid {
    const rail = this._zones().rail_r;
    return Layout.roster_grid(rail.w, rail.h - Config.RAIL_TAB_SIZE, this._roster_groups().length);
  }

  // Duplicate hires merge into ONE card (Pet Simulator 99 pet-bag model):
  // representative = the best copy by bonus_value, count feeds the xN badge.
  _roster_groups(): Array<{ name: string; count: number; waifu: GameState["waifus"][number] }> {
    const out: Array<{ name: string; count: number; waifu: GameState["waifus"][number] }> = [];
    const at: Record<string, number> = {};
    for (const w of this.state?.waifus ?? []) {
      if (!w || !w.name) continue;
      const seen = at[w.name];
      if (seen === undefined) {
        at[w.name] = out.length;
        out.push({ name: w.name, count: 1, waifu: w });
      } else {
        out[seen].count += 1;
        if ((w.bonus_value ?? 0) > (out[seen].waifu.bonus_value ?? 0)) out[seen].waifu = w;
      }
    }
    return out;
  }

  draw(ctx: CanvasRenderingContext2D, state: GameState, width: number, height: number): void {
    this.state = state;
    this._w = width;
    this._h = height;

    if (this.showing_pull_screen && this.pull_screen) {
      this.pull_screen.draw(ctx, width, height);
      this._draw_debug_overlay(ctx);
      return;
    }

    // Background (area tint when the ladder has moved past the first area).
    ctx.fillStyle = rgba(Areas.area_bg(state) as number[]);
    ctx.fillRect(0, 0, width, height);

    // Upgrade panel (left rail, behind the monster).
    if (this.upgrade_ui) {
      this.upgrade_ui.collapsed = this.left_collapsed;
      this.upgrade_ui.draw(ctx, state, width, height);
    }

    this._draw_roster(ctx);
    this._draw_rail_tabs(ctx);

    // Monster + pop effects + humor bubble (handled by the clicker system;
    // idle bob, squash-on-click and respawn fade all live there).
    this.clicker?.draw(ctx, this._zones().stage);
    this._draw_assigned_helpers(ctx, state);

    this._draw_kill_meter(ctx, state);
    this._draw_area_line(ctx, state);
    this._draw_next_goal_line(ctx);
    this._draw_hud(ctx, state);
    this._draw_bottom_bar(ctx, state);

    if (this.humor_line && this.humor_lifetime > 0) this._draw_waifu_humor(ctx);
    if (this.clicker && this.clicker.unlock_message_timer > 0) this._draw_unlock_message(ctx);
    if (this.save_warning_text && this.save_warning_lifetime > 0) this._draw_save_warning(ctx);
    if (this.pull_fail_message && this.pull_fail_timer > 0) this._draw_pull_fail_toast(ctx);
    if (this.show_session_stats) this._draw_session_stats(ctx, state);
    if (this.waifu_detail_index) this._draw_waifu_detail(ctx);
    if (this.prestige_panel_open) this._draw_prestige_panel(ctx, state);
    if (this.stats_panel_open) this._draw_stats_panel(ctx, state);
    if (this.area_menu_open) this._draw_area_menu(ctx, state);

    // FEEL-03: coalesced event lane drawn ABOVE every panel tier (it must
    // stay visible while a modal is open) but BELOW the welcome-back modal.
    if (this.event_toast_message && this.event_toast_timer > 0) this._draw_event_toast(ctx);

    // Welcome-back modal: topmost layer.
    if (state.offline_report || state.login_report) this._draw_offline_report(ctx, state);

    this._draw_debug_overlay(ctx);
  }
  private _text(
    ctx: CanvasRenderingContext2D,
    s: string,
    x: number,
    y: number,
    color: readonly number[],
    opts?: { size?: number; alpha?: number; align?: "left" | "center" | "right"; box?: number },
  ): void {
    ctx.fillStyle = rgba(color, opts?.alpha);
    ctx.font = `${opts?.size ?? Config.FONT_SIZE}px sans-serif`;
    const align = opts?.align ?? "left";
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    const box = opts?.box ?? 0;
    const tx = align === "center" ? x + box / 2 : align === "right" ? x + box : x;
    ctx.fillText(s, Math.round(tx), Math.round(y));
  }

  // Measured-width truncation (Story 4.1 screenshot review): never wider
  // than max_w; overflow collapses to "<head>..".
  _fit_text(ctx: CanvasRenderingContext2D, text: string, max_w: number): string {
    ctx.font = `${Config.FONT_SIZE}px sans-serif`;
    if (ctx.measureText(text).width <= max_w) return text;
    let base = text;
    while (base.length > 1 && ctx.measureText(base + "..").width > max_w) {
      base = base.slice(0, base.length - 1);
    }
    return base + "..";
  }

  // Measured greedy word wrap (mirrors Clicker._wrap_lines): every returned
  // row fits max_w; an over-long single word gets its own row.
  _wrap_text(ctx: CanvasRenderingContext2D, text: string, max_w: number): string[] {
    ctx.font = `${Config.FONT_SIZE}px sans-serif`;
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const cand = cur === "" ? word : cur + " " + word;
      if (cur === "" || ctx.measureText(cand).width <= max_w) {
        cur = cand;
      } else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur !== "") lines.push(cur);
    return lines.length > 0 ? lines : [""];
  }

  // Centered wrapped paragraph inside a max_w column; returns the next row y.
  private _text_lines(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    max_w: number,
    color: readonly number[],
  ): number {
    const lh = Config.FONT_SIZE + 2;
    const lines = this._wrap_text(ctx, text, max_w);
    lines.forEach((line, i) => {
      this._text(ctx, line, x, y + i * lh, color, { align: "center", box: max_w });
    });
    return y + lines.length * lh + 3;
  }

  private _hud_rates(): [string, string, string] {
    const state = this.state;
    let idle_mult = 1;
    if (this.upgrades) {
      try {
        const mult = this.upgrades.get_passive_multiplier();
        if (typeof mult === "number") idle_mult = mult;
      } catch { /* keep the 1x default */ }
    }
    let token_mult = 0, gold_mult = 0, exp_mult = 0;
    if (this.waifu && state) {
      try {
        [token_mult, gold_mult, exp_mult] = this.waifu.get_bonus_multiplier(state);
      } catch { /* bonuses stay 0 */ }
    }
    const labels: [string, string, string] = [
      `${(Config.PASSIVE_GOLD_RATE * idle_mult * (1 + gold_mult)).toFixed(1)} gold/sec`,
      `${(Config.PASSIVE_EXP_RATE * idle_mult * (1 + exp_mult)).toFixed(1)} exp/sec`,
      `${(Config.PASSIVE_TOKEN_RATE * (1 + token_mult)).toFixed(1)} tokens/sec`,
    ];
    if (!state?.passive_unlocked) {
      labels[0] = "---"; labels[1] = "---"; labels[2] = "Locked";
    }
    return labels;
  }

  private _draw_hud(ctx: CanvasRenderingContext2D, state: GameState): void {
    const hud = this._zones().hud;
    this._panel_chrome(ctx, hud);

    const rates = this._hud_rates();
    this._draw_currency_item(ctx, hud.x + 12, hud.y + 10, "G", state.gold ?? 0, Config.HUD_COLOR_GOLD, rates[0], this.value_flash.gold);
    this._draw_currency_item(ctx, hud.x + hud.w / 2 - 50, hud.y + 10, "E", state.exp ?? 0, Config.HUD_COLOR_EXP, rates[1], this.value_flash.exp);
    this._draw_currency_item(ctx, hud.x + hud.w - 215, hud.y + 10, "T", state.tokens ?? 0, Config.HUD_COLOR_TOKEN, rates[2], this.value_flash.token);

    // Areas button: the header entry into the zone menu. Shares the toggle
    // button sizing language so it reads as chrome, not content. It glows
    // once the current area's chest is ready — the cue to go looking.
    const b = Layout.bar_items(this._w, this._h, this._collapse());
    const a = b.areas;
    const ready = Areas.next_ready(state);
    ctx.fillStyle = rgba(ready
      ? Config.POP_COLOR_GOLD
      : Config.BG_COLOR.map((v) => v * 1.6) as number[], ready ? 0.9 : 0.95);
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = rgba(Config.BG_COLOR.map((v) => v * 2.2) as number[]);
    ctx.strokeRect(a.x, a.y, a.w, a.h);
    this._text(ctx, `Areas ${Areas.progress(state).index + 1} >`, a.x, a.y + (a.h - Config.FONT_SIZE) / 2,
      Config.POP_COLOR_WHITE, { align: "center", box: a.w });
  }

  // Panel fill + border pair used by HUD / roster / bars.
  private _panel_chrome(ctx: CanvasRenderingContext2D, r: Rect): void {
    ctx.fillStyle = rgba(Config.BG_COLOR.map((v) => v * 0.7) as number[], 0.92);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = rgba(Config.BG_COLOR.map((v) => v * 1.5) as number[]);
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 1;
  }

  // Chevron tabs in each rail's top-inner corner; a collapsed rail also gets
  // its background strip here (the card/list lanes skip drawing when collapsed).
  private _draw_rail_tabs(ctx: CanvasRenderingContext2D): void {
    const z = this._zones();
    if (this.left_collapsed) this._panel_chrome(ctx, z.rail_l);
    const tabs: Array<[Rect, string]> = [
      [Layout.rail_tab(z.rail_l, "left"), this.left_collapsed ? "<" : ">"],
      [Layout.rail_tab(z.rail_r, "right"), this.right_collapsed ? ">" : "<"],
    ];
    for (const [t, glyph] of tabs) {
      ctx.fillStyle = rgba(Config.BG_COLOR.map((v) => v * 1.5) as number[], 0.95);
      ctx.fillRect(t.x, t.y, t.w, t.h);
      this._text(ctx, glyph, t.x, t.y + 5, Config.POP_COLOR_WHITE,
        { align: "center", box: t.w });
    }
  }

  // Currency row: colored chip icon + amount + rate line. `flash` drives the
  // discrete-ledger value flash (D-11): brief brighten + enlarge on purchase/
  // unlock/pull/grant sites only — never per-click gold, never the drip.
  private _draw_currency_item(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    icon: string,
    amount: number,
    color: readonly number[],
    rate_text: string,
    flash: number,
  ): void {
    const chip = 12;
    ctx.fillStyle = rgba(color);
    ctx.fillRect(x, y + 6, chip, chip);
    ctx.fillStyle = rgba([26, 26, 38, 255]);
    ctx.font = `${Config.FONT_SIZE}px sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(icon, x + 3, y + 7);

    let frac = 0;
    if (flash > 0) frac = Math.min(1, flash / Config.HUD_FLASH_DURATION);
    const bright = (v: number): number => Math.round(v + (255 - v) * 0.5 * frac);
    const bright_color = bright_color_of(color, bright);
    const scale = 1 + 0.5 * frac;
    this._text(ctx, Format.number(amount), x + chip + 6, y, bright_color, { size: Config.FONT_SIZE * scale });
    this._text(ctx, rate_text, x, y + 24, [102, 102, 102, 255]);
  }

  private _draw_kill_meter(ctx: CanvasRenderingContext2D, state: GameState): void {
    const rect = Layout.meter_rect(this._w, this._h, this._collapse());
    let progress = 0;
    let fill = Config.KILL_METER_FILL_COLOR;
    if (this.clicker) {
      const p = this.clicker.get_kill_progress(state);
      progress = p.progress ?? 0;
      if (p.mode === "purchase") fill = Config.KILL_METER_PURCHASE_FILL_COLOR;
    }
    ctx.fillStyle = rgba(Config.KILL_METER_TRACK_COLOR);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const fw = Math.floor(rect.w * Math.max(0, Math.min(1, progress)));
    if (fw > 0) {
      ctx.fillStyle = rgba(fill);
      ctx.fillRect(rect.x, rect.y, fw, rect.h);
    }
  }

  // Areas ladder line: current area + how much in-area gold is still missing
  // before the Treasure Chest ripens, centered under the kill meter. Side
  // chevrons walk the position back and forth through unlocked areas.
  private _draw_area_line(ctx: CanvasRenderingContext2D, state: GameState): void {
    const z = this._zones();
    const p = Areas.progress(state);
    const remaining = Math.max(0, p.gold_target - p.gold);
    const meter = Layout.meter_rect(this._w, this._h, this._collapse());
    const tail = remaining > 0
      ? `${p.gold}/${p.gold_target} gold`
      : "Treasure ready!";
    const text = `Area ${p.index + 1}: ${p.name} · ${tail}`;
    const row_y = meter.y + meter.h + 4;
    this._text(ctx, this._fit_text(ctx, text, z.stage.w), z.stage.x, row_y,
      Config.PITY_NORMAL_COLOR, { align: "center", box: z.stage.w });

    const nav = this._area_nav();
    const highest = Math.max(state.highest_area ?? p.index, p.index);
    this._text(ctx, p.index > 0 ? "<" : "-", nav.prev.x, nav.prev.y + 5,
      Config.PITY_NORMAL_COLOR, { align: "center", box: nav.prev.w });
    this._text(ctx, p.index < highest ? ">" : "-", nav.next.x, nav.next.y + 5,
      Config.PITY_NORMAL_COLOR, { align: "center", box: nav.next.w });

    // PS99-style pickups around the stage edge: coin pile left, EXP orb
    // under the readout, treasure chest right. Bright when ripe (tap to
    // harvest), faded while locked or on respawn cooldown; the chest lights
    // with the full gold meter. Hidden when a spot would touch the bar.
    const spots = Layout.pickup_spots(this._w, this._h, this._collapse());
    if (spots.exp.y + spots.exp.h <= z.bar.y) {
      this._draw_node_icons(ctx, spots, this._pickup_flags(state));
    }
  }

  // Gold ripeness from Areas, dimmed while a picked-up spot is counting
  // down its respawn. The chest ignores cooldowns - it gates on its own.
  private _pickup_flags(state: GameState): NodeFlags {
    const p = Areas.progress(state);
    const ripe = Areas.node_flags(p.gold, p.gold_target);
    return {
      coins: ripe.coins && this.pickup_cooldown.coins <= 0,
      exp: ripe.exp && this.pickup_cooldown.exp <= 0,
      chest: ripe.chest,
    };
  }

  // Coin pile (stacked circles), EXP orb (ringed circle) and treasure chest
  // (lid + box) drawn centered on their Layout.pickup_spots rects — same
  // geometry the click router hit-tests, so lit pixels are tappable pixels.
  private _draw_node_icons(
    ctx: CanvasRenderingContext2D,
    spots: ReturnType<typeof Layout.pickup_spots>,
    flags: NodeFlags,
  ): void {
    const keys = ["coins", "exp", "chest"] as const;
    const colors = [Config.POP_COLOR_GOLD, Config.POP_COLOR_EXP, Config.POP_COLOR_TOKEN];
    for (let i = 0; i < keys.length; i++) {
      const r = spots[keys[i]];
      const cx = Math.floor(r.x + r.w / 2);
      const cy = Math.floor(r.y + r.h / 2);
      ctx.fillStyle = rgba(colors[i], flags[keys[i]] ? 0.95 : 0.35);
      if (keys[i] === "coins") {
        ctx.beginPath(); ctx.arc(cx - 4, cy + 2, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 4, cy + 2, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy - 2, 3, 0, Math.PI * 2); ctx.fill();
      } else if (keys[i] === "exp") {
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(colors[i], flags[keys[i]] ? 0.95 : 0.35);
        ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillRect(cx - 6, cy - 3, 12, 7);
        ctx.fillRect(cx - 6, cy - 6, 12, 2);
      }
    }
  }

  // The assigned crew, drawn as tiny sprites orbiting the monster so the
  // automatic damage has a face. Duplicate hires collapse to one sprite.
  private _draw_assigned_helpers(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (!this.clicker || !this.waifu) return;
    const seen = new Set<string>();
    const allies = this.waifu.effective_assigned(state).filter((w) => {
      if (!w.name || seen.has(w.name)) return false;
      seen.add(w.name);
      return true;
    }).slice(0, 4);
    if (allies.length === 0) return;
    const stage = this._zones().stage;
    const cx = stage.x + stage.w / 2 + this.clicker.pos_x;
    const cy = stage.y + stage.h / 2 + this.clicker.pos_y + this.clicker.idle_offset;
    const r = Config.MONSTER_SIZE / 2 + 12;
    const size = Config.SPRITE_PIXEL_SIZE;
    for (let i = 0; i < allies.length; i++) {
      const a = (i / allies.length) * Math.PI * 2 + this.clicker.anim_timer * 0.8;
      const x = cx + Math.cos(a) * r - size / 2;
      const y = cy + Math.sin(a) * r * 0.6 - size / 2;
      const sprite = createSpriteCanvas(allies[i].name, 1);
      if (sprite && ctx.drawImage) {
        ctx.drawImage(sprite, x, y);
      } else {
        ctx.fillStyle = rgba(Config.WAIFU_IDLE_COLOR);
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  // Area menu modal: chips pick any unlocked area (instant travel), info
  // lines narrate the selected area, and the area's quest shows its live
  // progress. Same chrome language as the stats modal.
  private _draw_area_menu(ctx: CanvasRenderingContext2D, state: GameState): void {
    const p = Areas.progress(state);
    const highest = Math.max(state.highest_area ?? p.index, p.index);
    const m = Layout.area_menu(this._w, this._h, highest + 1);
    const pad = Config.LAYOUT_MARGIN;

    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_DIM_COLOR);
    ctx.fillRect(0, 0, this._w, this._h);
    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_PANEL_COLOR);
    ctx.fillRect(m.panel.x, m.panel.y, m.panel.w, m.panel.h);
    ctx.strokeStyle = rgba(Config.OFFLINE_REPORT_BORDER_COLOR);
    ctx.lineWidth = 2;
    ctx.strokeRect(m.panel.x, m.panel.y, m.panel.w, m.panel.h);
    ctx.lineWidth = 1;

    this._text(ctx, "Areas", m.panel.x + pad, m.panel.y + pad,
      Config.OFFLINE_REPORT_TITLE_COLOR, { align: "center", box: m.info_w });

    for (let i = 0; i < m.chips.length; i++) {
      const c = m.chips[i];
      ctx.fillStyle = rgba(i === p.index
        ? Config.SUMMON_CIRCLE_COLOR
        : Config.BG_COLOR.map((v) => v * 1.3) as number[], 0.95);
      ctx.fillRect(c.x, c.y, c.w, c.h);
      this._text(ctx, String(i + 1), c.x, c.y + Math.floor((c.h - Config.FONT_SIZE) / 2),
        Config.POP_COLOR_WHITE, { align: "center", box: c.w });
    }

    const lh = Config.FONT_SIZE + 4;
    let y = m.info_top;
    this._text(ctx, this._fit_text(ctx, `${p.name} · Boss: ${p.boss}`, m.info_w),
      m.panel.x + pad, y, Config.POP_COLOR_WHITE, { align: "center", box: m.info_w });
    y = y + lh;
    this._text(ctx, `${p.gold}/${p.gold_target} gold in area`,
      m.panel.x + pad, y, Config.OFFLINE_REPORT_TEXT_COLOR, { align: "center", box: m.info_w });
    y = y + lh;
    const hires = Areas.def(p.index).pool.join(", ");
    this._text(ctx, this._fit_text(ctx, `Hires: ${hires}`, m.info_w),
      m.panel.x + pad, y, Config.OFFLINE_REPORT_HINT_COLOR, { align: "center", box: m.info_w });
    y = y + lh;
    // The chest loop hires from this area's pool - show the newest face.
    const latest = state.waifus[state.waifus.length - 1];
    if (latest) {
      this._text(ctx, this._fit_text(ctx, `Latest hire: ${latest.name} (${latest.rarity})`, m.info_w),
        m.panel.x + pad, y, Config.OFFLINE_REPORT_HINT_COLOR, { align: "center", box: m.info_w });
      y = y + lh;
    }
    const quest = Config.ACHIEVEMENTS.find((d) => d.area === p.index);
    if (quest) {
      const prog = Achievements.get_progress(state, quest.id);
      const done = Achievements.is_unlocked(state, quest.id);
      const right = done
        ? "done"
        : `${Math.floor(prog?.current ?? 0)}/${quest.goal}`;
      this._text(ctx, this._fit_text(ctx, `${quest.label} (${right})`, m.info_w),
        m.panel.x + pad, y, Config.OFFLINE_REPORT_HINT_COLOR, { align: "center", box: m.info_w });
    }

    this._text(ctx, "tap a chip to travel · tap outside to close", m.panel.x + pad,
      m.panel.y + m.panel.h + 6, Config.OFFLINE_REPORT_HINT_COLOR,
      { align: "center", box: m.panel.w });
  }

  // Chevron hitboxes flanking the area line, shared by draw and click so a
  // pixel that lights up is exactly a pixel that walks.
  private _area_nav(): { prev: Rect; next: Rect } {
    const z = this._zones();
    const meter = Layout.meter_rect(this._w, this._h, this._collapse());
    const size = Config.RAIL_TAB_SIZE;
    const y = meter.y + meter.h + 2;
    return {
      prev: { x: z.stage.x, y, w: size, h: size },
      next: { x: z.stage.x + z.stage.w - size, y, w: size, h: size },
    };
  }

  // FEEL-02/D-08: plain text line under the HUD while a gated tier remains;
  // hidden in purchase mode where the rail cue carries the target.
  private _draw_next_goal_line(ctx: CanvasRenderingContext2D): void {
    const state = this.state;
    if (!this.clicker || !state) return;
    const p = this.clicker.get_kill_progress(state);
    if (!p || p.mode !== "exp" || !p.target) return;
    const z = this._zones();
    const deficit = Math.max(0, (p.needed ?? 0) - (p.value ?? 0));
    const text = `Next: ${p.target} in ${Format.number(deficit)} EXP`;
    this._text(ctx, this._fit_text(ctx, text, z.stage.w), z.stage.x, z.hud.y + z.hud.h + 6,
      Config.PITY_NORMAL_COLOR, { align: "center", box: z.stage.w });
  }

  private _draw_bottom_bar(ctx: CanvasRenderingContext2D, state: GameState): void {
    const b = Layout.bar_items(this._w, this._h, this._collapse());
    this._panel_chrome(ctx, b.bar);

    // Pull button (label centered so it survives narrow rails).
    const enabled = (state.tokens ?? 0) >= Config.PULL_COST;
    const btn_color = enabled ? Config.PULL_BTN_COLOR : Config.PULL_BTN_DISABLED_COLOR;
    ctx.fillStyle = rgba(btn_color);
    ctx.fillRect(b.pull.x, b.pull.y, b.pull.w, b.pull.h);
    this._text(ctx, `PULL (${Config.PULL_COST}T)`, b.pull.x, b.pull.y + 16, Config.POP_COLOR_WHITE,
      { align: "center", box: b.pull.w });

    // Pity counter reads as the pull button's price tag, anchored next to it.
    const pity_counter = state.pity_counter ?? 0;
    const warning = pity_counter >= Config.PITY_SOFT;
    this._text(ctx, `Pity: ${pity_counter}/${Config.PITY_HARD}${warning ? "!!!" : ""}`,
      b.pity.x, b.pity.y + 16, warning ? Config.PITY_WARNING_COLOR : Config.PITY_NORMAL_COLOR);

    // Stats entry: always-live info button (FEEL-02), static fill, same
    // Layout rect the hit-test reads.
    ctx.fillStyle = rgba(Config.RESET_BTN_COLOR);
    ctx.fillRect(b.stats.x, b.stats.y, b.stats.w, b.stats.h);
    this._text(ctx, "Stats", b.stats.x, b.stats.y + 16, Config.POP_COLOR_WHITE,
      { align: "center", box: b.stats.w });

    // Phase 15 (INP-04): INFO/DBG toggle cluster above the bar row; active
    // states are the overlay flag and Config.DEBUG_MODE.
    ctx.fillStyle = rgba(this.show_session_stats ? Config.PULL_BTN_COLOR : Config.RESET_BTN_COLOR);
    ctx.fillRect(b.sess.x, b.sess.y, b.sess.w, b.sess.h);
    this._text(ctx, this._fit_text(ctx, "INFO", b.sess.w), b.sess.x,
      b.sess.y + Math.floor((Config.TOGGLE_BTN_HEIGHT - Config.FONT_SIZE) / 2), Config.POP_COLOR_WHITE,
      { align: "center", box: b.sess.w });
    ctx.fillStyle = rgba(Config.DEBUG_MODE ? Config.PULL_BTN_COLOR : Config.RESET_BTN_COLOR);
    ctx.fillRect(b.dbg.x, b.dbg.y, b.dbg.w, b.dbg.h);
    this._text(ctx, this._fit_text(ctx, "DBG", b.dbg.w), b.dbg.x,
      b.dbg.y + Math.floor((Config.TOGGLE_BTN_HEIGHT - Config.FONT_SIZE) / 2), Config.POP_COLOR_WHITE,
      { align: "center", box: b.dbg.w });

    // Prestige button: enabled only when a rebirth point is earnable.
    const prestige_enabled = Prestige.earnable_points(state) >= 1;
    ctx.fillStyle = rgba(prestige_enabled ? Config.PULL_BTN_COLOR : Config.PULL_BTN_DISABLED_COLOR);
    ctx.fillRect(b.prestige.x, b.prestige.y, b.prestige.w, b.prestige.h);
    this._text(ctx, "Prestige", b.prestige.x, b.prestige.y + 16, Config.POP_COLOR_WHITE,
      { align: "center", box: b.prestige.w });

    // Reset button: first click arms (red "Sure?"), second confirms.
    ctx.fillStyle = rgba(this.reset_armed ? Config.RESET_ARMED_COLOR : Config.RESET_BTN_COLOR);
    ctx.fillRect(b.reset.x, b.reset.y, b.reset.w, b.reset.h - 8);
    this._text(ctx, this.reset_armed ? "Sure?" : "Reset", b.reset.x + 8, b.reset.y + 12, Config.POP_COLOR_WHITE);

    // PREST-02 disabled-state legibility: narrate what the rebirth still
    // needs - cleared areas and badges - while no point is earnable yet.
    if (Prestige.earnable_points(state) < 1) {
      const cleared = Math.max(0, state.highest_area ?? 0);
      const badges = Object.keys(state.achievements ?? {}).length;
      const z = this._zones();
      this._text(ctx, this._fit_text(ctx,
        `Rebirth: ${cleared} areas cleared, ${badges} badges`, z.stage.w),
        z.stage.x, b.bar.y - 14, Config.OFFLINE_REPORT_HINT_COLOR,
        { align: "center", box: z.stage.w });
    }
  }

  private _draw_roster(ctx: CanvasRenderingContext2D): void {
    const rail = this._zones().rail_r;
    // Cards and header live BELOW the chevron tab row so the tab square
    // never sits on top of text.
    const body = Layout.rail_body(rail);
    const groups = this._roster_groups();
    const total = groups.length;
    // Dot on the crew actually assigned to the CURRENT area (per-area lanes).
    const lane = this.state?.assignments?.[this.state.area_index ?? 0] ?? [];
    const g = Layout.roster_grid(body.w, body.h, total);
    const scroll = this.roster_scroll_offset;
    const pad = Config.ROSTER_PANEL_PADDING;
    const cs = Config.ROSTER_CARD_SIZE;
    const ss = Config.ROSTER_SPRITE_SIZE;

    this._panel_chrome(ctx, rail);
    if (this.right_collapsed) return;
    this._text(ctx, `Waifus (${total})`, body.x + pad, body.y + pad, Config.POP_COLOR_WHITE);

    // Cards: every slot from Layout.roster_slot, clipped below the header so
    // scrolling never smears onto it. Cull first, clip second — no bleed at
    // either boundary.
    ctx.save();
    ctx.beginPath();
    ctx.rect(body.x, body.y + g.grid_top, body.w, body.h - g.grid_top);
    ctx.clip();
    ctx.lineWidth = 2;
    for (let i = 1; i <= total; i++) {
      const s_rect = Layout.roster_slot(body, g, i, scroll);
      if (s_rect.y + s_rect.h >= body.y + g.grid_top && s_rect.y <= body.y + body.h) {
        const group = groups[i - 1];
        if (group && group.name) {
          const waifu = group.waifu;
          const is_hovered = this.roster_hover_index === i;

          ctx.fillStyle = rgba(Config.BG_COLOR, 0.92);
          ctx.fillRect(s_rect.x, s_rect.y, cs, cs + Config.ROSTER_LABEL_HEIGHT);

          // Border precedence: hover > rarity > neutral.
          const border = this._card_border_color(waifu, is_hovered);
          ctx.strokeStyle = rgba(border);
          ctx.strokeRect(s_rect.x, s_rect.y, cs, cs + Config.ROSTER_LABEL_HEIGHT);

          // Sprite: gray map tinted with the personality color; rect fallback.
          const personality = Config.WAIFU_PERSONALITY[waifu.name];
          const sprite_color = personality?.reveal_color ?? Config.WAIFU_IDLE_COLOR;
          const sprite = createSpriteCanvas(waifu.name, ss / Config.SPRITE_PIXEL_SIZE);
          if (sprite && ctx.drawImage) {
            ctx.drawImage(sprite, s_rect.x + (cs - ss) / 2, s_rect.y + (cs - ss) / 2);
          } else {
            ctx.fillStyle = rgba(sprite_color);
            ctx.fillRect(s_rect.x + (cs - ss) / 2, s_rect.y + (cs - ss) / 2, ss, ss);
          }

          // Name + bonus, measured to fit the card.
          this._text(ctx, this._fit_text(ctx, waifu.name, cs - 4), s_rect.x + 2, s_rect.y + cs + 1,
            is_hovered ? Config.POP_COLOR_WHITE : [128, 128, 140, 255]);

          let bonus_color: readonly number[] = [200, 200, 200, 255];
          let bonus_text: string;
          const pct = Math.round((waifu.bonus_value ?? 0) * 100);
          if (waifu.bonus_type === "tokens") {
            bonus_color = Config.POP_COLOR_TOKEN;
            bonus_text = `+${pct}% ${Config.ROSTER_BONUS_SHORT.tokens}`;
          } else if (waifu.bonus_type === "gold") {
            bonus_color = Config.POP_COLOR_GOLD;
            bonus_text = `+${pct}% ${Config.ROSTER_BONUS_SHORT.gold}`;
          } else if (waifu.bonus_type === "exp") {
            bonus_color = Config.POP_COLOR_EXP;
            bonus_text = `+${pct}% ${Config.ROSTER_BONUS_SHORT.exp}`;
          } else {
            bonus_text = `+${waifu.bonus_value ?? 0}`;
          }
          this._text(ctx, this._fit_text(ctx, bonus_text, cs - 4), s_rect.x + 2, s_rect.y + cs + 13, bonus_color);

          // Equip dot + duplicate badge: who is on the clock, and how many
          // copies back it up — both without leaving the card.
          if (lane.includes(waifu.name)) {
            ctx.fillStyle = rgba(Config.POP_COLOR_GOLD);
            ctx.fillRect(s_rect.x + cs / 2 - 2, s_rect.y + 2, 4, 4);
          }
          if (group.count > 1) {
            this._text(ctx, `x${group.count}`, s_rect.x + 2, s_rect.y + cs + 13,
              Config.POP_COLOR_GOLD, { align: "right", box: cs - 4 });
          }
        }
      }
    }
    ctx.lineWidth = 1;

    // Empty slot placeholders (only while the roster does not fill its
    // visible grid — exactly when max_scroll is 0, so no scroll term).
    for (let i = total + 1; i <= g.visible; i++) {
      const s_rect = Layout.roster_slot(body, g, i, 0);
      ctx.fillStyle = rgba(Config.BG_COLOR.map((v) => v * 0.85) as number[], 0.5);
      ctx.fillRect(s_rect.x, s_rect.y, cs, cs + Config.ROSTER_LABEL_HEIGHT);
      ctx.fillStyle = rgba([102, 102, 115, 153]);
      ctx.beginPath();
      ctx.arc(s_rect.x + cs / 2, s_rect.y + cs / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Card frame color precedence: hover highlight (interaction) > rarity
  // (identity) > neutral panel line.
  _card_border_color(waifu: { rarity?: string } | null, hovered: boolean): readonly number[] {
    if (hovered) return Config.SUMMON_CIRCLE_COLOR;
    const rarity = waifu?.rarity ? Config.WAIFU_RARITY_BY_KEY[waifu.rarity] : null;
    if (rarity) return rarity.color;
    return [Config.BG_COLOR[0] * 1.5, Config.BG_COLOR[1] * 1.5, Config.BG_COLOR[2] * 1.5, 255];
  }

  // Front door for "which roster card is under this point" — hover, card
  // clicks and tooltips all share it, matching the Layout slots _draw_roster
  // paints (same rects at any window size).
  _roster_slot_at(x: number, y: number): number | null {
    const rail = this._zones().rail_r;
    if (x < rail.x || x > rail.x + rail.w || y < rail.y || y > rail.y + rail.h) return null;
    const groups = this._roster_groups();
    const body = Layout.rail_body(rail);
    const grid = Layout.roster_grid(body.w, body.h, groups.length);
    for (let i = 1; i <= groups.length; i++) {
      const s_rect = Layout.roster_slot(body, grid, i, this.roster_scroll_offset);
      if (x >= s_rect.x && x <= s_rect.x + s_rect.w && y >= s_rect.y && y <= s_rect.y + s_rect.h) {
        const group = groups[i - 1];
        return group && group.name ? i : null;
      }
    }
    return null;
  }
  // Failed-pull toast: same fade shape as the save warning, own line below
  // it so both can coexist. Alpha ramps in the last quarter of the lifetime.
  private _fade_alpha(timer: number, lifetime: number): number {
    const t = timer / lifetime;
    return Math.max(0, Math.min(1, t / 0.25));
  }

  private _draw_pull_fail_toast(ctx: CanvasRenderingContext2D): void {
    const alpha = this._fade_alpha(this.pull_fail_timer, Config.PULL_FAIL_TOAST_LIFETIME);
    this._text(ctx, this.pull_fail_message ?? "", 0, Config.PULL_FAIL_TOAST_Y,
      Config.PULL_FAIL_TOAST_COLOR, { alpha, align: "center", box: this._w });
  }

  // FEEL-03: single coalesced lane, same fade shape, own Y so all three
  // toast lanes coexist one-per-line.
  private _draw_event_toast(ctx: CanvasRenderingContext2D): void {
    const alpha = this._fade_alpha(this.event_toast_timer, Config.EVENT_TOAST_LIFETIME);
    this._text(ctx, this.event_toast_message ?? "", 0, Config.EVENT_TOAST_Y,
      Config.EVENT_TOAST_COLOR, { alpha, align: "center", box: this._w });
  }

  private _draw_save_warning(ctx: CanvasRenderingContext2D): void {
    const alpha = this._fade_alpha(this.save_warning_lifetime, Config.SAVE_WARNING_LIFETIME);
    this._text(ctx, this.save_warning_text ?? "", 0, Config.SAVE_WARNING_Y,
      Config.SAVE_WARNING_COLOR, { alpha, align: "center", box: this._w });
  }

  private _draw_waifu_humor(ctx: CanvasRenderingContext2D): void {
    const cx = this._w / 2;
    const cy = this._h / 2 - 80;
    const t = this.humor_lifetime / Config.WAIFU_HUMOR_LIFETIME;
    const alpha = Math.max(0, Math.min(1, t > 0.4 ? 1 : t / 0.4));
    this._text(ctx, `"${this.humor_line ?? ""}"`, cx - 160, cy, Config.WAIFU_HUMOR_COLOR,
      { alpha: (Config.WAIFU_HUMOR_COLOR[3] / 255) * alpha, align: "center", box: 320 });
  }

  private _draw_unlock_message(ctx: CanvasRenderingContext2D): void {
    if (!this.clicker) return;
    const t = this.clicker.unlock_message_timer / Config.UNLOCK_MESSAGE_LIFETIME;
    const alpha = Math.max(0, Math.min(1, t > 0.4 ? 1 : t / 0.4));
    this._text(ctx, this.clicker.unlock_message, 0, Config.UNLOCK_MESSAGE_Y,
      Config.UNLOCK_MESSAGE_COLOR, { size: Config.UNLOCK_MESSAGE_SIZE, alpha, align: "center", box: this._w });
  }

  // Plain-text debug overlay (the Lua Debug:draw echo), rendered by the UI.
  private _draw_debug_overlay(ctx: CanvasRenderingContext2D): void {
    if (!Config.DEBUG_MODE || !this.debug) return;
    let y = Config.DEBUG_OVERLAY_Y;
    for (const line of this.debug.overlay_lines()) {
      this._text(ctx, line, Config.DEBUG_OVERLAY_X, y, Config.DEBUG_OVERLAY_COLOR,
        { size: Config.DEBUG_OVERLAY_SIZE });
      y = y + Config.DEBUG_OVERLAY_SIZE + 3;
    }
  }
  // Session-stats overlay, centered on the stage so it can never sit on the
  // roster rail.
  private _draw_session_stats(ctx: CanvasRenderingContext2D, state: GameState): void {
    const r = Layout.stats_rect(this._w, this._h, this._collapse());
    ctx.fillStyle = rgba([0, 0, 0, 178]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = rgba([255, 255, 255, 230]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    const lx = r.x + 10;
    let y = r.y + 8;
    this._text(ctx, "Session Stats", lx, y, Config.POP_COLOR_WHITE);
    y = y + 20;
    const line = (s: string): void => {
      this._text(ctx, s, lx, y, Config.POP_COLOR_WHITE);
      y = y + 18;
    };
    line("Gold Earned: " + Format.number(state.total_gold_earned));
    line("EXP Earned: " + Format.number(state.total_exp_earned));
    line("Tokens Earned: " + Format.number(state.total_tokens_earned));
    const clicks = state.session_clicks ?? 0;
    const crits = state.session_crits ?? 0;
    line("Clicks: " + clicks);
    if (clicks > 0) {
      line(`Crits: ${crits} (${((crits / clicks) * 100).toFixed(1)}%)`);
    }
    line("Streak: Day " + (state.login_streak ?? 0));
    line(`Pity: ${state.pity_counter ?? 0}/${Config.PITY_HARD}`);
    line("Time: " + format_session_time(state.session_start_time));
  }

  // Story 3.4 + 4.3: one welcome-back modal carrying the offline-earnings
  // report and/or the daily login reward, each section optional.
  private _draw_offline_report(ctx: CanvasRenderingContext2D, state: GameState): void {
    const report = state.offline_report as Record<string, number> | null;
    const login = state.login_report as Record<string, number> | null;
    if (!report && !login) return;

    interface Line { text: string; color: readonly number[] }
    const lines: Line[] = [];
    if (report) {
      const seconds = report.seconds ?? 0;
      lines.push({ text: `Away for ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`, color: Config.OFFLINE_REPORT_TEXT_COLOR });
      lines.push({ text: "Your waifus earned:", color: Config.OFFLINE_REPORT_TEXT_COLOR });
      lines.push({ text: "+" + Format.number(report.gold ?? 0) + " gold", color: Config.HUD_COLOR_GOLD });
      lines.push({ text: "+" + Format.number(report.exp ?? 0) + " exp", color: Config.HUD_COLOR_EXP });
      lines.push({ text: "+" + Format.number(report.tokens ?? 0) + " tokens", color: Config.HUD_COLOR_TOKEN });
    }
    if (login) {
      lines.push({ text: `Day ${login.day ?? 1} login streak!`, color: Config.OFFLINE_REPORT_TITLE_COLOR });
      lines.push({ text: "+" + Format.number(login.tokens ?? 0) + " bonus tokens", color: Config.HUD_COLOR_TOKEN });
    }

    // Full-window dim + centered panel whose height grows with the section
    // count so login lines can never overflow.
    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_DIM_COLOR);
    ctx.fillRect(0, 0, this._w, this._h);

    const pad = Config.OFFLINE_REPORT_PADDING;
    const lh = Config.OFFLINE_REPORT_LINE_HEIGHT;
    const pw = Math.min(Config.OFFLINE_REPORT_PANEL_WIDTH, this._w - 2 * pad);
    const ph = Math.max(Config.OFFLINE_REPORT_PANEL_HEIGHT,
      pad * 2 + lh * 2 + lines.length * lh + 12);
    const px = Math.floor(this._w / 2 - pw / 2);
    const py = Math.floor(this._h / 2 - ph / 2);
    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_PANEL_COLOR);
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = rgba(Config.OFFLINE_REPORT_BORDER_COLOR);
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);
    ctx.lineWidth = 1;

    const content_w = pw - pad * 2;
    this._text(ctx, "Welcome back!", px + pad, py + pad, Config.OFFLINE_REPORT_TITLE_COLOR,
      { align: "center", box: content_w });
    let y = py + pad + lh * 2;
    for (const entry of lines) {
      this._text(ctx, entry.text, px + pad, y, entry.color, { align: "center", box: content_w });
      y = y + lh;
    }
    this._text(ctx, "tap anywhere to close", px + pad, py + ph - pad - Config.FONT_SIZE,
      Config.OFFLINE_REPORT_HINT_COLOR, { align: "center", box: content_w });
  }
  // Waifu status overlay: big portrait, FULL name, rarity banner, cheat
  // skill and flavor text — any click/key dismisses it.
  private _draw_waifu_detail(ctx: CanvasRenderingContext2D): void {
    const groups = this._roster_groups();
    const idx = this.waifu_detail_index ?? 0;
    const group = groups[idx - 1];
    const waifu = group?.waifu ?? null;
    if (!waifu || !waifu.name) {
      this.waifu_detail_index = null;
      return;
    }
    const d = Layout.waifu_detail(this._w, this._h);
    const rarity = waifu.rarity ? Config.WAIFU_RARITY_BY_KEY[waifu.rarity] : null;

    ctx.fillStyle = rgba([0, 0, 0, 153]);
    ctx.fillRect(0, 0, this._w, this._h);

    ctx.fillStyle = rgba(Config.BG_COLOR, 0.97);
    ctx.fillRect(d.panel.x, d.panel.y, d.panel.w, d.panel.h);
    const frame = rarity?.color ?? [255, 255, 255, 230];
    ctx.strokeStyle = rgba(frame);
    ctx.lineWidth = 2;
    ctx.strokeRect(d.panel.x, d.panel.y, d.panel.w, d.panel.h);
    ctx.lineWidth = 1;

    this._text(ctx, this._fit_text(ctx, waifu.name, d.title.w), d.title.x, d.title.y, Config.POP_COLOR_WHITE,
      { align: "center", box: d.title.w });

    const personality = Config.WAIFU_PERSONALITY[waifu.name];
    const color = personality?.reveal_color ?? Config.WAIFU_IDLE_COLOR;
    const sprite = createSpriteCanvas(waifu.name, Math.max(1, Math.round(d.sprite.w / Config.SPRITE_PIXEL_SIZE)));
    if (sprite && ctx.drawImage) {
      ctx.drawImage(sprite, d.sprite.x, d.sprite.y);
    } else {
      ctx.fillStyle = rgba(color);
      ctx.fillRect(d.sprite.x, d.sprite.y, d.sprite.w, d.sprite.h);
    }

    let y = d.info_top;
    if (rarity) {
      y = this._text_lines(ctx, `${rarity.stars} ${rarity.name}`, d.inner.x, y, d.inner.w, rarity.color);
    }
    const bonus_label = Config.WAIFU_BONUS_LABELS[waifu.bonus_type as keyof typeof Config.WAIFU_BONUS_LABELS];
    if (bonus_label) {
      y = this._text_lines(ctx, `+${Math.round((waifu.bonus_value ?? 0) * 100)}% ${bonus_label}`,
        d.inner.x, y, d.inner.w, Config.POP_COLOR_WHITE);
    }
    if ((group?.count ?? 1) > 1) {
      y = this._text_lines(ctx, `Copies: ${group?.count}`, d.inner.x, y, d.inner.w, Config.POP_COLOR_GOLD);
    }
    y = this._text_lines(ctx, "Cheat Skill: " + (personality?.skill ?? "Office Synergy"),
      d.inner.x, y, d.inner.w, Config.POP_COLOR_WHITE);
    if (personality?.flavor) {
      y = this._text_lines(ctx, `"${personality.flavor}"`, d.inner.x, y, d.inner.w, Config.WAIFU_HUMOR_COLOR);
    }

    // Per-area assignment button (PS99 pet bag): this hire joins/leaves the
    // CURRENT area's crew. Kept above the dismiss line so tapping the button
    // never also closes.
    const btn = this._equip_btn();
    const area_name = Areas.def(this.state?.area_index ?? 0).name;
    const lane = this.state?.assignments?.[this.state?.area_index ?? 0] ?? [];
    const on_clock = lane.includes(waifu.name);
    ctx.fillStyle = rgba(on_clock ? Config.POP_COLOR_GOLD : Config.BG_COLOR.map((v) => v * 1.4) as number[], 0.95);
    ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    this._text(ctx, this._fit_text(ctx, on_clock ? `Assigned: ${area_name}` : `Assign to ${area_name}`, btn.w - 8),
      btn.x + 4, btn.y + (btn.h - Config.FONT_SIZE) / 2, Config.POP_COLOR_WHITE);

    // Phase 15 (INP-04): dismiss affordance on the panel bottom pad line.
    this._text(ctx, "tap anywhere to close", d.inner.x,
      d.panel.y + d.panel.h - Config.LAYOUT_MARGIN - Config.FONT_SIZE,
      Config.OFFLINE_REPORT_HINT_COLOR, { align: "center", box: d.inner.w });
  }

  // Equip button rect, shared by the detail draw and its click handler.
  _equip_btn(): Rect {
    const d = Layout.waifu_detail(this._w, this._h);
    const h = Math.max(22, Config.FONT_SIZE + 8);
    return {
      x: d.inner.x,
      y: d.panel.y + d.panel.h - Config.LAYOUT_MARGIN - Config.FONT_SIZE - h - 6,
      w: d.inner.w,
      h,
    };
  }
  // PREST-02: centered review modal. Reuses the welcome-back visual language
  // and the reset-modal two-step arm/confirm. Lists iterate the system's
  // single-source KEEP_SET / RESET_SET (D-05).
  private _draw_prestige_panel(ctx: CanvasRenderingContext2D, state: GameState): void {
    const p = Layout.prestige_panel(this._w, this._h);
    const pad = Config.LAYOUT_MARGIN;

    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_DIM_COLOR);
    ctx.fillRect(0, 0, this._w, this._h);
    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_PANEL_COLOR);
    ctx.fillRect(p.panel.x, p.panel.y, p.panel.w, p.panel.h);
    ctx.strokeStyle = rgba(Config.OFFLINE_REPORT_BORDER_COLOR);
    ctx.lineWidth = 2;
    ctx.strokeRect(p.panel.x, p.panel.y, p.panel.w, p.panel.h);
    ctx.lineWidth = 1;

    const content_w = p.panel.w - pad * 2;
    this._text(ctx, "Rebirth?", p.panel.x + pad, p.panel.y + pad, Config.OFFLINE_REPORT_TITLE_COLOR,
      { align: "center", box: content_w });

    // Points-to-gain + multiplier before -> after the pending rebirth.
    const gain = Prestige.earnable_points(state);
    const before = Prestige.gold_multiplier(state);
    const after = Prestige.gold_multiplier({ prestige_points: (state.prestige_points ?? 0) + gain });
    const lh = Config.PRESTIGE_PANEL_LINE_HEIGHT;
    this._text(ctx, `Earn +${Format.number(gain)} Rebirth Points`, p.panel.x + pad, p.panel.y + pad + 18,
      Config.OFFLINE_REPORT_TEXT_COLOR, { align: "center", box: content_w });
    this._text(ctx, `Multiplier: ${before.toFixed(2)}x → ${after.toFixed(2)}x`,
      p.panel.x + pad, p.panel.y + pad + 18 + lh, Config.OFFLINE_REPORT_TEXT_COLOR,
      { align: "center", box: content_w });

    // Keep vs reset columns from the single-source sets.
    this._text(ctx, "Kept", p.keep_col.x, p.keep_col.y, Config.OFFLINE_REPORT_HINT_COLOR);
    this._text(ctx, "Reset", p.reset_col.x, p.reset_col.y, Config.OFFLINE_REPORT_HINT_COLOR);
    let y = p.keep_col.y + lh;
    for (const key of Prestige.KEEP_SET) {
      this._text(ctx, `• ${PRESTIGE_LABELS[key] ?? key}`, p.keep_col.x, y, Config.OFFLINE_REPORT_TEXT_COLOR);
      y = y + lh;
    }
    y = p.reset_col.y + lh;
    for (const key of Prestige.RESET_SET) {
      this._text(ctx, `• ${PRESTIGE_LABELS[key] ?? key}`, p.reset_col.x, y, Config.OFFLINE_REPORT_TEXT_COLOR);
      y = y + lh;
    }

    // Two-step confirm: idle grey -> armed red; hover one-step brighten.
    let cc = this.prestige_armed ? Config.RESET_ARMED_COLOR : Config.RESET_BTN_COLOR;
    if (this.prestige_confirm_hover) {
      cc = bright_color_of(cc, (v) => Math.min(255, v + (255 - v) * 0.25));
    }
    ctx.fillStyle = rgba(cc);
    ctx.fillRect(p.confirm.x, p.confirm.y, p.confirm.w, p.confirm.h);
    this._text(ctx, this.prestige_armed ? "Sure?" : "Rebirth", p.confirm.x, p.confirm.y + 12,
      Config.POP_COLOR_WHITE, { align: "center", box: p.confirm.w });

    this._text(ctx, "tap anywhere to close", p.panel.x + pad, p.panel.y + p.panel.h + 6,
      Config.OFFLINE_REPORT_HINT_COLOR, { align: "center", box: p.panel.w });
  }
  // Phase 8 (UI-01/UI-02): read-only stats + achievements modal. Geometry
  // ONLY from Layout.stats_panel; rows are pure reads through
  // Achievements.progress_all, config order never re-sorted. Locked/unlocked
  // styling is a COLOR SWAP (house disabled idiom), never alpha.
  private _draw_stats_panel(ctx: CanvasRenderingContext2D, state: GameState): void {
    const p = Layout.stats_panel(this._w, this._h, Config.ACHIEVEMENTS.length);
    const pad = Config.LAYOUT_MARGIN;

    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_DIM_COLOR);
    ctx.fillRect(0, 0, this._w, this._h);
    ctx.fillStyle = rgba(Config.OFFLINE_REPORT_PANEL_COLOR);
    ctx.fillRect(p.panel.x, p.panel.y, p.panel.w, p.panel.h);
    ctx.strokeStyle = rgba(Config.OFFLINE_REPORT_BORDER_COLOR);
    ctx.lineWidth = 2;
    ctx.strokeRect(p.panel.x, p.panel.y, p.panel.w, p.panel.h);
    ctx.lineWidth = 1;

    const content_w = p.panel.w - pad * 2;
    this._text(ctx, "Stats & Achievements", p.panel.x + pad, p.panel.y + pad,
      Config.OFFLINE_REPORT_TITLE_COLOR, { align: "center", box: content_w });

    // Fixed lifetime block (never scrolls): the top/rows/line-height anchors
    // come from the Layout-reserved p.block budget so reserved and drawn
    // height share one source.
    const st = state.stats ?? {};
    const block = p.block;
    const lh = block.line_height;
    const mastery = Config.STATS_PANEL_MASTERY_FORMAT
      .replace("%d", String(Achievements.count_unlocked(state)))
      .replace("%d", String(Config.ACHIEVEMENTS.length));
    const rows: Array<[string, string]> = [
      ["Gold Earned:", Format.number(state.total_gold_earned)],
      ["EXP Earned:", Format.number(state.total_exp_earned)],
      ["Tokens Earned:", Format.number(state.total_tokens_earned)],
      ["Kills:", String(Math.floor(st.kills ?? 0))],
      ["Clicks:", String(Math.floor(st.clicks ?? 0))],
      ["Crits:", String(Math.floor(st.crits ?? 0))],
      ["Pulls:", String(Math.floor(st.pulls_total ?? 0))],
      ["Common Pulls:", String(Math.floor(st.pulls_common ?? 0))],
      ["Rare Pulls:", String(Math.floor(st.pulls_rare ?? 0))],
      ["Epic Pulls:", String(Math.floor(st.pulls_epic ?? 0))],
      ["Legendary Pulls:", String(Math.floor(st.pulls_legendary ?? 0))],
      ["Upgrades Bought:", String(Math.floor(st.upgrades_bought ?? 0))],
      ["Rebirths:", String(Math.floor(st.rebirths ?? 0))],
      ["Play Time:", Format.clock(st.play_time)],
      ["Badge Rewards:", "+" + Format.number(st.badge_reward_gold ?? 0) + "g +"
        + Format.number(st.badge_reward_tokens ?? 0) + "t"],
      ["Achievements Unlocked:", mastery],
    ];
    rows.slice(0, block.rows).forEach((row, i) => {
      this._text(ctx, `${row[0]} ${row[1]}`, p.panel.x + pad, block.y + i * lh,
        Config.OFFLINE_REPORT_TEXT_COLOR);
    });

    // Section header at the Layout-reserved anchor.
    this._text(ctx, "Achievements", p.list.x, block.header_y, Config.OFFLINE_REPORT_HINT_COLOR);

    // Wheel-scrolled badge roster in Config.ACHIEVEMENTS order. Unlocked =
    // gold label + white progress-side reward; locked = hint-gray both. Rows
    // outside the list window are culled (exclusive lower edge — CR-01).
    let ri = 0;
    for (const row of Achievements.progress_all(state)) {
      const ry = p.list.y + ri * p.list.row_h - this.stats_scroll_offset;
      ri = ri + 1;
      if (ry < p.list.y || ry >= p.list.y + p.list.h) continue;
      const label_w = p.list.w - 96; // reserved for the progress/reward column
      let label = row.label ?? row.id;
      ctx.font = `${Config.FONT_SIZE}px sans-serif`;
      if (ctx.measureText(label).width > label_w) label = this._fit_text(ctx, label, label_w);
      const unlocked = Achievements.is_unlocked(state, row.id);
      const label_color = unlocked ? Config.OFFLINE_REPORT_TITLE_COLOR : Config.OFFLINE_REPORT_HINT_COLOR;
      this._text(ctx, label, p.list.x, ry, label_color);
      // D-03: unlocked rows show the BASE tier reward; locked the progress.
      const right = unlocked
        ? reward_text(tier_by_id[row.id] ?? "bronze")
        : achv_progress_text(row);
      this._text(ctx, right, p.list.x, ry, unlocked ? Config.OFFLINE_REPORT_TEXT_COLOR : Config.OFFLINE_REPORT_HINT_COLOR,
        { align: "right", box: p.list.w });
    }

    this._text(ctx, "tap anywhere to close", p.panel.x + pad, p.panel.y + p.panel.h + 6,
      Config.OFFLINE_REPORT_HINT_COLOR, { align: "center", box: p.panel.w });
  }
  // LÖVE love.mousepressed equivalent (left-click path; the pointer host in
  // main.ts already resolved tap-vs-drag and debounce). Modal early-returns
  // come FIRST so the dismissing click can never also hit the monster or a
  // button underneath.
  mousepressed(x: number, y: number): boolean {
    const state = this.state;
    if (state && (state.offline_report || state.login_report)) {
      this._dismiss_reports();
      return true;
    }
    if (this.showing_pull_screen && this.pull_screen) {
      this.pull_screen.mousepressed(x, y, this._w, this._h);
      return true;
    }
    if (this.waifu_detail_index) {
      // Equip button first: a tap on it swaps the hire and keeps the overlay
      // open; any other tap dismisses as before.
      const btn = this._equip_btn();
      if (state && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        const group = this._roster_groups()[this.waifu_detail_index - 1];
        if (group && this.waifu) this.waifu.toggle_assign(state, group.name);
        return true;
      }
      this.waifu_detail_index = null;
      return true;
    }
    if (this.prestige_panel_open) {
      const pp = Layout.prestige_panel(this._w, this._h);
      const on_confirm = x >= pp.confirm.x && x <= pp.confirm.x + pp.confirm.w
        && y >= pp.confirm.y && y <= pp.confirm.y + pp.confirm.h;
      if (on_confirm && state) {
        if (Prestige.earnable_points(state) >= 1) {
          if (this.prestige_armed) this._do_prestige();
          else this.prestige_armed = true;
        }
        // While no point is earnable the confirm stays inert and the panel
        // open, so passive gain can still bring the count up.
      } else {
        this.prestige_panel_open = false;
        this.prestige_armed = false;
        this.prestige_confirm_hover = false;
      }
      return true;
    }
    if (this.stats_panel_open) {
      this.stats_panel_open = false;
      this.stats_scroll_offset = 0;
      return true;
    }
    // Area menu modal: chips walk the position (Areas.walk_to clamps to
    // highest_area); clicks inside the panel body are inert, clicks outside
    // close. The modal never falls through to the gameplay layer.
    if (this.area_menu_open) {
      const highest = Math.max(
        state?.highest_area ?? state?.area_index ?? 0,
        state?.area_index ?? 0,
      );
      const m = Layout.area_menu(this._w, this._h, highest + 1);
      for (let i = 0; i < m.chips.length; i++) {
        const c = m.chips[i];
        if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
          if (state) Areas.walk_to(state, i);
          return true;
        }
      }
      const inside = x >= m.panel.x && x <= m.panel.x + m.panel.w
        && y >= m.panel.y && y <= m.panel.y + m.panel.h;
      if (!inside) this.area_menu_open = false;
      return true;
    }
    // Header Areas button: the primary entry into the zone menu.
    const b_items = Layout.bar_items(this._w, this._h, this._collapse());
    const ab = b_items.areas;
    if (x >= ab.x && x <= ab.x + ab.w && y >= ab.y && y <= ab.y + ab.h) {
      this.area_menu_open = !this.area_menu_open;
      return true;
    }
    // Rail chevrons collapse/expand; while collapsed, any tap on the strip
    // expands it again (Clicker Heroes pattern).
    const z = this._zones();
    const lt = Layout.rail_tab(z.rail_l, "left");
    if (x >= lt.x && x <= lt.x + lt.w && y >= lt.y && y <= lt.y + lt.h) {
      this.left_collapsed = !this.left_collapsed;
      return true;
    }
    const rt = Layout.rail_tab(z.rail_r, "right");
    if (x >= rt.x && x <= rt.x + rt.w && y >= rt.y && y <= rt.y + rt.h) {
      this.right_collapsed = !this.right_collapsed;
      return true;
    }
    if (this.left_collapsed && x <= z.rail_l.x + z.rail_l.w && y >= z.rail_l.y
      && y <= z.rail_l.y + z.rail_l.h) {
      this.left_collapsed = false;
      return true;
    }
    if (this.right_collapsed && x >= z.rail_r.x && y >= z.rail_r.y
      && y <= z.rail_r.y + z.rail_r.h) {
      this.right_collapsed = false;
      return true;
    }
    // Area travel chevrons: walk the position back and forth through the
    // unlocked ladder (Areas.travel clamps to highest_area).
    const nav = this._area_nav();
    for (const [r, dir] of [[nav.prev, -1], [nav.next, 1]] as Array<[Rect, number]>) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        if (state) Areas.travel(state, dir);
        return true;
      }
    }
    // Pickup row: a tap on a ripe Coin pile / EXP orb / Treasure Chest
    // Harvest spots: coins and orbs pay when ripe and off cooldown, then
    // start their respawn countdown; the Chest also unlocks the next area.
    const spots = Layout.pickup_spots(this._w, this._h, this._collapse());
    const lanes = { coins: ["gold"], exp: ["exp"], chest: ["token"] } as const;
    for (const key of ["coins", "exp", "chest"] as const) {
      const s = spots[key];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) {
        if (state && this._pickup_flags(state)[key]) {
          const msg = Areas.harvest(state, key);
          if (msg) {
            let text = msg;
            if (key === "chest" && this.gacha) {
              const hire = this.gacha.hire_from_pool(state);
              if (hire) text = `${msg} · Hire: ${hire.name} (${hire.rarity})`;
            }
            this.fire_event(text, lanes[key]);
            if (key !== "chest") this.pickup_cooldown[key] = Config.PICKUP_RESPAWN_SECONDS;
          }
        }
        return true;
      }
    }
    if (this._click_at(x, y)) return true;
    return false;
  }

  // Gameplay hit-test body: reset arm/disarm, roster cards, monster hitbox
  // (alive click vs dead-window buffer), upgrade rail, bottom-bar buttons.
  private _click_at(x: number, y: number): boolean {
    const state = this.state;
    if (!state) return false;
    const b = Layout.bar_items(this._w, this._h, this._collapse());
    const on_reset = x >= b.reset.x && x <= b.reset.x + b.reset.w
      && y >= b.reset.y && y <= b.reset.y + b.reset.h;
    // Story 4.4 AC5: any other click disarms a pending confirmation.
    if (this.reset_armed && !on_reset) this.reset_armed = false;

    // Roster card -> waifu status overlay (before the monster, so a card can
    // never double as a click on whatever sits behind the rail).
    const card_index = this._roster_slot_at(x, y);
    if (card_index) {
      this.waifu_detail_index = card_index;
      return true;
    }

    // Monster hitbox centered on the stage, matching Clicker.draw.
    if (this.clicker) {
      const stage = this._zones().stage;
      const cx = stage.x + stage.w / 2 + this.clicker.pos_x;
      const cy = stage.y + stage.h / 2 + this.clicker.pos_y + this.clicker.idle_offset;
      const half = Config.MONSTER_SIZE / 2;
      if (x >= cx - half && x <= cx + half && y >= cy - half && y <= cy + half) {
        if (this.clicker.monster_state === "alive") {
          this.clicker.click(state);
          // D-09 click site: post-mutation, synchronously at the press.
          this._check_unlocks();
        } else {
          // FEEL-04: a press in the death-fade window becomes a buffered
          // intent, paid on respawn — never a silent drop.
          this.clicker.buffer_click();
        }
        return true;
      }
    }
    // Upgrade card clicks (after the monster hitbox check).
    if (this.upgrade_ui && this.upgrade_ui.check_click(x, y, state, this._w, this._h)) {
      return true;
    }

    // Phase 15 (INP-04): DBG/INFO toggles sit ABOVE the bar row, so they test
    // their own y-range ahead of the bar block. Flip bodies mirror the
    // keyboard lanes so both behave identically.
    if (y >= b.dbg.y && y <= b.dbg.y + b.dbg.h && x >= b.dbg.x && x <= b.dbg.x + b.dbg.w) {
      Config.DEBUG_MODE = !Config.DEBUG_MODE;
      return true;
    }
    if (y >= b.sess.y && y <= b.sess.y + b.sess.h && x >= b.sess.x && x <= b.sess.x + b.sess.w) {
      this.show_session_stats = !this.show_session_stats;
      return true;
    }

    // Bottom bar row: pull, reset (two-step), prestige, stats.
    if (y >= b.bar.y && y <= b.bar.y + b.bar.h) {
      if (x >= b.pull.x && x <= b.pull.x + b.pull.w) {
        if (this.gacha && (state.tokens ?? 0) >= Config.PULL_COST) {
          const result = this.gacha.pull(state);
          if (result && result.success && result.waifu) {
            // FEEL-03 (D-11): pull result is a discrete ledger event —
            // coalesced lane + token value flash.
            this.fire_event("Summoned: " + result.waifu.name, ["token"]);
            this.showing_pull_screen = true;
            this.pull_screen = new PullScreen(this.gacha, state, this.waifu, result);
            // D-09 pull site: post-mutation, synchronously at the press. The
            // in-screen "Pull Again" rides the update-tail sweep instead.
            this._check_unlocks();
          } else if (result) {
            // A silent deduction would read as a dead button.
            this.pull_fail_message = `No summon... Pity: ${state.pity_counter ?? 0}/${Config.PITY_HARD}`;
            this.pull_fail_timer = Config.PULL_FAIL_TOAST_LIFETIME;
          }
        } else {
          // Broke players get the same "nothing happened" honesty as the
          // dimmed button: name the price in the fail lane.
          this.pull_fail_message = `Need ${Config.PULL_COST} tokens to summon`;
          this.pull_fail_timer = Config.PULL_FAIL_TOAST_LIFETIME;
        }
        return true;
      }
      if (on_reset) {
        if (this.reset_armed) this._do_reset();
        else this.reset_armed = true;
        return true;
      }
      if (x >= b.prestige.x && x <= b.prestige.x + b.prestige.w) {
        if (Prestige.earnable_points(state) >= 1) {
          this.prestige_panel_open = true;
          this.prestige_armed = false;
          return true;
        }
      }
      // Stats entry: always-live, deliberately ungated (FEEL-02).
      if (x >= b.stats.x && x <= b.stats.x + b.stats.w) {
        this.stats_panel_open = true;
        this.stats_scroll_offset = 0;
        return true;
      }
    }

    return false;
  }

  // Hover lane (mouse only): overlays own the cursor, then the prestige
  // confirm hover, upgrade-rail hover and roster hover. Drag scrolling is
  // routed through wheelmoved by the pointer host — hover never scrolls.
  mousemoved(x: number, y: number): void {
    this._hover_x = x;
    this._hover_y = y;
    if (this.showing_pull_screen || this.waifu_detail_index || this.stats_panel_open ||
        this.area_menu_open ||
        (this.state && (this.state.offline_report || this.state.login_report))) {
      this.prestige_confirm_hover = false;
      return;
    }
    if (this.prestige_panel_open) {
      const pp = Layout.prestige_panel(this._w, this._h);
      this.prestige_confirm_hover =
        x >= pp.confirm.x && x <= pp.confirm.x + pp.confirm.w &&
        y >= pp.confirm.y && y <= pp.confirm.y + pp.confirm.h;
      return;
    }
    this.prestige_confirm_hover = false;
    if (this.upgrade_ui) this.upgrade_ui.update_hover(x, y, this._w, this._h);
    this.roster_hover_index = this._roster_slot_at(x, y);
  }
  // Cursor over the upgrade rail scrolls upgrades, anywhere else scrolls the
  // roster; while the stats modal is open the wheel belongs to its badge
  // list alone. mx/my default to the last hover position.
  wheelmoved(dx: number, dy: number, mx?: number, my?: number): void {
    if (dx === 0 && dy === 0) return;
    if (mx === undefined) { mx = this._hover_x ?? undefined; my = this._hover_y ?? undefined; }
    const amount = -dy * Config.ROSTER_SCROLL_SPEED;
    if (this.showing_pull_screen || this.waifu_detail_index || this.area_menu_open) return;
    if (this.stats_panel_open) {
      const sp = Layout.stats_panel(this._w, this._h, Config.ACHIEVEMENTS.length);
      this.stats_scroll_offset = Math.max(0, Math.min(sp.list.max_scroll, this.stats_scroll_offset + amount));
      return;
    }
    if (mx !== undefined && my !== undefined) {
      const z = this._zones();
      const rail_l = z.rail_l;
      if (mx >= rail_l.x && mx <= rail_l.x + rail_l.w && my >= rail_l.y && my <= rail_l.y + rail_l.h) {
        if (this.upgrade_ui) this.upgrade_ui.scroll_by(amount, this._w, this._h);
        return;
      }
    }
    const grid = this._roster_grid();
    this.roster_scroll_offset = Math.max(0, Math.min(grid.max_scroll, this.roster_scroll_offset + amount));
  }

  // Keyboard lane mirrors the Lua root callbacks: any key closes the
  // topmost-open surface first, then the debug delegation and "s" toggle.
  keypressed(key: string): void {
    const state = this.state;
    if (state && (state.offline_report || state.login_report)) {
      this._dismiss_reports();
      return;
    }
    if (this.waifu_detail_index) {
      this.waifu_detail_index = null;
      return;
    }
    if (this.prestige_panel_open) {
      this.prestige_panel_open = false;
      this.prestige_armed = false;
      this.prestige_confirm_hover = false;
      return;
    }
    if (this.stats_panel_open) {
      this.stats_panel_open = false;
      this.stats_scroll_offset = 0;
      return;
    }
    if (this.area_menu_open) {
      this.area_menu_open = false;
      return;
    }
    if (this.debug) this.debug.keypressed(key);
    if (key === "s") this.show_session_stats = !this.show_session_stats;
  }

  // FEEL-03 (D-11): daily/offline grants are discrete ledger events — fire
  // the coalesced lane once when the welcome-back modal is dismissed (the
  // grants are already applied to state by boot; this is pure punctuation).
  private _dismiss_reports(): void {
    const state = this.state;
    if (!state) return;
    const offline = state.offline_report as Record<string, number> | null;
    const login = state.login_report as Record<string, number> | null;
    state.offline_report = null;
    state.login_report = null;
    const parts: string[] = [];
    const flashes: string[] = [];
    if (offline) {
      parts.push("While away: +" + Format.number(offline.gold ?? 0) + " gold, +"
        + Format.number(offline.exp ?? 0) + " exp, +" + Format.number(offline.tokens ?? 0) + " tokens");
      flashes.push("gold", "exp", "token");
    }
    if (login) {
      parts.push(`Day ${login.day ?? 1} streak: +${Format.number(login.tokens ?? 0)} tokens`);
      if (!flashes.includes("token")) flashes.push("token");
    }
    if (parts.length > 0) this.fire_event(parts.join(" · "), flashes);
  }

  // Executes the confirmed reset through the save system; the fallback keeps
  // the in-place re-init contract for save-less construction (table identity
  // must survive — clicker/passive hold references).
  private _do_reset(): void {
    this.reset_armed = false;
    const state = this.state;
    if (!state) return;
    if (this.save) {
      this.save.reset(state, this.upgrades);
    } else {
      Object.assign(state, createState());
    }
    // WR-05: the wipe zeroes counters and the persisted achievement set, so
    // the session-only queue/signature/scroll are cleared by hand too.
    this.achv_queue = [];
    this._achv_sig = 0;
    this.stats_scroll_offset = 0;
  }

  // PREST-02: execute the confirmed rebirth through the Prestige system.
  private _do_prestige(): void {
    const state = this.state;
    if (!state) return;
    this.prestige_armed = false;
    this.prestige_confirm_hover = false;
    const [ok, gain] = Prestige.rebirth(state, this.upgrades);
    if (!ok) {
      this.prestige_panel_open = false;
      return;
    }
    this.prestige_panel_open = false;
    this.clicker?.spawn_new_monster(state);
    const mult = Prestige.gold_multiplier(state);
    this.fire_event(`Rebirth! +${Format.number(gain)} pts · ${mult.toFixed(2)}x gold`, ["gold"]);
    this.save?.save(state, this.upgrades);
    // D-09 prestige site: the success tail, post record_rebirth.
    this._check_unlocks();
  }
}

function bright_color_of(color: readonly number[], bright: (v: number) => number): number[] {
  return [bright(color[0]), bright(color[1]), bright(color[2]), color[3]];
}

function format_session_time(start_time: number | undefined): string {
  if (!start_time) return "0:00";
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - start_time);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

export default MainScene;
