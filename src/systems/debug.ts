// src/systems/debug.ts
// Debug test harness: speed controls, auto-clicker, resource injection,
// seeded RNG. Port of src/systems/debug.lua. Drawing stays OUT of this layer:
// the overlay readout is exposed as plain strings via overlay_lines() for the
// UI to render. The Offline/Daily computations the simulate hooks rely on are
// inlined as private statics mirroring the Lua module logic, since the web
// port stages those systems later.

import Config from "../config";
import type { GameState } from "../state";
import type { UpgradesLike } from "./save";

export interface DebugClickerLike {
  monster_state: string;
  update(dt: number, state: GameState): void;
  click(state: GameState): void;
  buffer_click?(): void;
}

export interface DebugGameLike {
  state: GameState;
  upgrades?: UpgradesLike | null;
  clicker?: DebugClickerLike | null;
}

export class Debug {
  game: DebugGameLike;
  speed_multiplier = 1;
  auto_clicker_enabled = false;
  rng_seed: number | null = null;
  total_clicks = 0;
  elapsed_time = 0;
  _current_scaled_dt = 0;
  _last_shift_held = false;
  private _rng_state = 0;

  constructor(game: DebugGameLike) {
    this.game = game;
  }

  setSpeed(n: number): void {
    if (n !== 1 && n !== 2 && n !== 5 && n !== 10 && n !== 50) {
      console.log("[WARN] [DEBUG] Invalid speed multiplier: " + String(n) + " (must be 1, 2, 5, 10, or 50)");
      return;
    }
    this.speed_multiplier = n;
    console.log("[INFO] [DEBUG] Speed set to " + n + "x");
  }

  getSpeed(): number {
    return this.speed_multiplier;
  }

  setAutoClick(enabled: boolean): void {
    this.auto_clicker_enabled = enabled;
    console.log(enabled
      ? "[INFO] [DEBUG] Auto-clicker enabled"
      : "[INFO] [DEBUG] Auto-clicker disabled");
  }

  getAutoClick(): boolean {
    return this.auto_clicker_enabled;
  }

  addGold(amount: number): void {
    if (typeof amount !== "number" || !(amount > 0)) {
      throw new Error("addGold: amount must be a positive number");
    }
    const state = this.game.state;
    state.gold = state.gold + amount;
    console.log("[INFO] [DEBUG] Injected " + amount + " gold (total: " + state.gold + ")");
  }

  addExp(amount: number): void {
    if (typeof amount !== "number" || !(amount > 0)) {
      throw new Error("addExp: amount must be a positive number");
    }
    const state = this.game.state;
    state.exp = state.exp + amount;
    console.log("[INFO] [DEBUG] Injected " + amount + " exp (total: " + state.exp + ")");
  }

  addTokens(amount: number): void {
    if (typeof amount !== "number" || !(amount > 0)) {
      throw new Error("addTokens: amount must be a positive number");
    }
    const state = this.game.state;
    state.tokens = (state.tokens ?? 0) + amount;
    console.log("[INFO] [DEBUG] Injected " + amount + " tokens (total: " + state.tokens + ")");
  }

  // Simulates a `seconds`-long absence against live state: runs the same
  // offline-apply path boot uses, then sets state.offline_report so the login
  // popup appears mid-session. The backdated last_save_time is re-stamped to
  // "now" by the next autosave before it can double-count.
  simulateOffline(seconds: number): Record<string, number> | null {
    if (typeof seconds !== "number" || !(seconds > 0)) {
      throw new Error("simulateOffline: seconds must be a positive number");
    }
    const state = this.game.state;
    const now = Math.floor(Date.now() / 1000);
    state.last_save_time = now - seconds;
    const report = Debug._applyOffline(state, now, this.game.upgrades ?? null);
    state.offline_report = report;
    if (report) {
      console.log("[INFO] [DEBUG] Simulated " + seconds + "s offline: +" + report.tokens
        + " tokens, +" + report.gold + " gold, +" + report.exp + " exp (report shown)");
    } else {
      console.log("[INFO] [DEBUG] Simulated " + seconds
        + "s offline: no report (below skip window or passive locked)");
    }
    return report;
  }

  static _applyOffline(
    state: GameState, now: number, upgrades: UpgradesLike | null,
  ): Record<string, number> | null {
    if (!(state.last_save_time && state.last_save_time > 0 && state.passive_unlocked)) {
      return null;
    }
    const offlineSeconds = now - state.last_save_time;
    if (offlineSeconds < Config.OFFLINE_SKIP_SECONDS) return null;

    let idleMult = 1;
    if (upgrades && typeof upgrades.get_passive_multiplier === "function") {
      try {
        const mult = upgrades.get_passive_multiplier();
        if (typeof mult === "number") idleMult = mult;
      } catch { /* keep the 1x default */ }
    }

    let tokenMult = 0, goldMult = 0, expMult = 0;
    for (const w of state.waifus ?? []) {
      if (w.bonus_type === "tokens") tokenMult += w.bonus_value ?? 0;
      else if (w.bonus_type === "gold") goldMult += w.bonus_value ?? 0;
      else if (w.bonus_type === "exp") expMult += w.bonus_value ?? 0;
    }

    const capped = Math.min(offlineSeconds, Config.OFFLINE_TOKEN_CAP_SECONDS);
    // Parity with the passive per-tick formulas: idle_mult applies to gold/exp
    // but NOT tokens; prestige amplifies gold ONLY.
    const offlineTokens = capped * Config.PASSIVE_TOKEN_RATE * (1 + tokenMult);
    const offlineGold = capped * Config.PASSIVE_GOLD_RATE * idleMult * (1 + goldMult)
      * (1 + Config.PRESTIGE_MULTIPLIER_PER_POINT * (state.prestige_points ?? 0));
    const offlineExp = capped * Config.PASSIVE_EXP_RATE * idleMult * (1 + expMult);

    state.tokens = (state.tokens ?? 0) + offlineTokens;
    state.gold = (state.gold ?? 0) + offlineGold;
    state.exp = (state.exp ?? 0) + offlineExp;
    state.total_tokens_earned = (state.total_tokens_earned ?? 0) + offlineTokens;
    state.total_gold_earned = (state.total_gold_earned ?? 0) + offlineGold;
    state.total_exp_earned = (state.total_exp_earned ?? 0) + offlineExp;
    state.prestige_gold_since_rebirth = (state.prestige_gold_since_rebirth ?? 0) + offlineGold;

    return { seconds: capped, tokens: offlineTokens, gold: offlineGold, exp: offlineExp };
  }

  // Pretends yesterday was the last login (keeping the current streak), then
  // runs the same daily-check path boot uses and queues state.login_report so
  // the welcome modal shows the next ladder tier mid-session.
  simulateDaily(): Record<string, number> | null {
    const state = this.game.state;
    const now = Math.floor(Date.now() / 1000);
    const today = Math.floor(now / Config.DAILY_LOGIN_DAY_SECONDS);
    if ((state.last_login_day ?? 0) < today) state.last_login_day = today - 1;
    const report = Debug._checkDaily(state, now);
    state.login_report = report;
    if (report) {
      console.log("[INFO] [DEBUG] Simulated daily login: day " + report.day
        + ", +" + report.tokens + " tokens (report shown)");
    } else {
      console.log("[INFO] [DEBUG] Simulated daily login: no payout (clock already at/after today)");
    }
    return report;
  }

  static _checkDaily(state: GameState, now: number): Record<string, number> | null {
    const day = Math.floor(now / Config.DAILY_LOGIN_DAY_SECONDS);
    const prev = state.last_login_day ?? 0;
    if (day <= prev) return null;
    const streak = prev > 0 && day === prev + 1 ? (state.login_streak ?? 0) + 1 : 1;
    const ladder = Config.DAILY_LOGIN_REWARDS;
    const tokens = ladder[Math.min(streak, ladder.length) - 1];
    state.login_streak = streak;
    state.last_login_day = day;
    state.tokens = (state.tokens ?? 0) + tokens;
    state.total_tokens_earned = (state.total_tokens_earned ?? 0) + tokens;
    return { day: streak, tokens };
  }

  // Lua's global math.randomseed/math.random pair maps onto a local mulberry32
  // stream: seeding stores the value and resets the stream deterministically.
  seedRandom(seed: number): void {
    if (typeof seed !== "number") {
      throw new Error("seedRandom: seed must be a number");
    }
    this.rng_seed = seed;
    this._rng_state = seed >>> 0;
    console.log("[INFO] [DEBUG] RNG seeded with " + seed);
  }

  getSeed(): number | null {
    return this.rng_seed;
  }

  // Deterministic [0,1) draw from the seeded stream (math.random equivalent).
  next_random(): number {
    this._rng_state = (this._rng_state + 0x6d2b79f5) | 0;
    let t = this._rng_state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Pure boot-time entropy mix. Both inputs keep sub-second authority:
  // scaled fixed-point, multiply-then-add with distinct scale factors — never
  // truncated to whole seconds, since a plain whole-second seed collides on
  // same-second relaunches. Pure: no DOM, no state, no logging.
  static entropy_seed(timer_value: number, clock_value: number): number {
    if (typeof timer_value !== "number") {
      throw new Error("entropy_seed: timer_value must be a number");
    }
    if (typeof clock_value !== "number") {
      throw new Error("entropy_seed: clock_value must be a number");
    }
    const t = Math.floor(Math.abs(timer_value) * 1e9) * 31;
    const c = Math.floor(Math.abs(clock_value) * 1e7);
    return (t + c) % 2147483647;
  }

  getState(): Record<string, unknown> {
    return { ...(this.game.state as unknown as Record<string, unknown>) };
  }

  keypressed(key: string): void {
    if (!Config.DEBUG_MODE) return;
    if (key === "f5") this.setSpeed(2);
    else if (key === "f6") this.setSpeed(5);
    else if (key === "f7") this.setSpeed(10);
    else if (key === "f8") this.setSpeed(50);
    else if (key === "f9") this.simulateDaily();
    else if (key === "lshift") this.setAutoClick(!this.auto_clicker_enabled);
  }

  update(dt: number): void {
    if (this.speed_multiplier <= 0) {
      this.speed_multiplier = 1;
      console.log("[WARN] [DEBUG] Speed clamped to 1x (was " + String(this.speed_multiplier) + ")");
    }
    this._current_scaled_dt = dt * this.speed_multiplier;
    this.elapsed_time = this.elapsed_time + this._current_scaled_dt;

    if (this.auto_clicker_enabled && this.game.clicker && this.game.state) {
      const clicker = this.game.clicker;
      // Clicker.update takes (dt, state) — same calling convention as the
      // main-scene loop, so EXP-unlock checks see the state.
      clicker.update(this._current_scaled_dt, this.game.state);
      if (clicker.monster_state === "alive") {
        clicker.click(this.game.state);
        this.total_clicks = this.total_clicks + 1;
        // session_clicks is OWNED by the single payment site inside the real
        // Clicker:click; total_clicks above stays Debug's own telemetry.
      } else {
        // Dead-window auto-clicks become buffered intents, paid on respawn.
        clicker.buffer_click?.();
      }
    }
  }

  getScaledDt(): number {
    return this._current_scaled_dt;
  }

  // Plain-text overlay readout for the UI layer to draw (the Lua draw()).
  overlay_lines(): string[] {
    const hours = Math.floor(this.elapsed_time / 3600);
    const minutes = Math.floor((this.elapsed_time % 3600) / 60);
    const seconds = Math.floor(this.elapsed_time % 60);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return [
      "Speed: " + this.speed_multiplier + "x",
      "Tick: " + this._current_scaled_dt.toFixed(3) + "s",
      "Auto-Click: " + (this.auto_clicker_enabled ? "ON" : "OFF"),
      "Clicks: " + String(this.total_clicks),
      "Time: " + pad(hours) + ":" + pad(minutes) + ":" + pad(seconds),
    ];
  }
}

export default Debug;
