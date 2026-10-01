// src/game.ts
// Game container: constructs every system, owns the boot sequence and the
// per-frame update lane. Port of src/game.lua + the love.update lane of
// main.lua. Pure wiring — logic lives in src/systems/, drawing in src/ui/.

import Config from "./config";
import createState, { type GameState } from "./state";
import Upgrades from "./systems/upgrades";
import Save, { type StorageLike } from "./systems/save";
import Offline from "./systems/offline";
import Daily from "./systems/daily";
import Clicker from "./systems/clicker";
import Waifu from "./systems/waifu";
import Passive from "./systems/passive";
import Debug, { type DebugGameLike } from "./systems/debug";
import Gacha from "./systems/gacha";
import Stats from "./systems/stats";
import MainScene from "./ui/main_scene";

// localStorage-shaped adapter for the pure save system; a write returning
// false (quota/disposed context) feeds Save's dirty-retry behavior.
export function browserStorage(): StorageLike {
  return {
    getItem: (k: string): string | null => {
      try {
        return globalThis.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k: string, v: string): void => {
      try {
        globalThis.localStorage.setItem(k, v);
      } catch {
        // Save treats a failed write as dirty-retry, not an exception.
      }
    },
  };
}

export class Game implements DebugGameLike {
  state: GameState;
  upgrades: Upgrades;
  save: Save;
  clicker: Clicker;
  waifu: Waifu;
  passive: Passive;
  debug: Debug;
  gacha: Gacha;
  main_scene: MainScene;
  private _now_fn: () => number;

  constructor(storage?: StorageLike | null, now_fn?: () => number) {
    this._now_fn = now_fn ?? ((): number => Math.floor(Date.now() / 1000));
    const store: StorageLike = storage ?? browserStorage();

    this.state = createState(this._now_fn());
    this.upgrades = new Upgrades();

    // Save/load must run BEFORE offline generation so the persisted
    // last_save_time makes the offline math work on the very first frame.
    this.save = new Save(store, this._now_fn);
    const [loaded, warning] = this.save.load_into(this.state, this.upgrades);
    if (warning) {
      console.log("[WARN] [SAVE] " + warning);
      this.state.save_warning = warning;
    } else if (loaded) {
      // Boot probe (SAVE-01): echo the loaded stamp so a live run proves the
      // last flush landed before offline math reads the away window.
      console.log("[INFO] [SAVE] Progress loaded, last_save_time=" + String(this.state.last_save_time));
    } else {
      console.log("[INFO] [SAVE] No usable save found; starting fresh");
    }

    // Offline generation: one code path, after upgrades exist (offline math
    // reads idle levels) and before the remaining systems.
    const now = this._now_fn();
    this.state.offline_report = Offline.apply(this.state, now, this.upgrades) as Record<string, number> | null;
    // Daily login: after load so the persisted streak is live; claims at
    // most once per UTC day.
    this.state.login_report = Daily.check(this.state, now) as Record<string, number> | null;

    // Boot re-stamp (D-03): AFTER Offline.apply and the daily check so
    // neither away-window is eaten by an early flush. update(0) lets the
    // fingerprint see the fresh gains; flush_if_dirty re-stamps in the same
    // boot so the next launch is a no-op instead of double-paying.
    this.save.update(0, this.state, this.upgrades);
    this.save.flush_if_dirty(this.state, this.upgrades);

    this.clicker = new Clicker(this.upgrades);
    this.waifu = new Waifu();
    this.passive = new Passive(this.upgrades, this.waifu);
    this.debug = new Debug(this);
    this.gacha = new Gacha();

    this.main_scene = new MainScene({
      clicker: this.clicker, passive: this.passive, upgrades: this.upgrades,
      debug: this.debug, gacha: this.gacha, waifu: this.waifu, save: this.save,
    });
    this.main_scene.load(this.state);
  }

  // Single clamp at the update entry: every lane below sees the capped dt,
  // so a long background gap cannot spike animations, toasts, or play_time.
  update(dt: number): void {
    let clamped = dt;
    if (clamped > Config.MAX_FRAME_DT) clamped = Config.MAX_FRAME_DT;
    this.debug.update(clamped);
    const scaled_dt = this.debug.getScaledDt();
    this.passive.update(scaled_dt, this.state);
    this.main_scene.update(scaled_dt);
    // Save autosave tick: plain dt, not debug-scaled — save stamping is
    // wall-clock, so the throttle must be too.
    this.save.update(clamped, this.state, this.upgrades);
    // Play time accumulates on the PLAIN dt lane; Stats.tick is nil-safe.
    Stats.tick(this.state, clamped);
  }
}

export default Game;

