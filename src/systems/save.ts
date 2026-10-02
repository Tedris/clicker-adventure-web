// src/systems/save.ts
// Save/load system, ported from src/systems/save.lua. Pure logic: the storage
// backend is injected (localStorage-compatible) so tests run against an
// in-memory fake. Time comes from now_fn to keep tests deterministic.
// FORMAT ADAPTATION: the Lua original serialized Lua-literal tables via
// love.filesystem; the web build stores JSON under Config.SAVE_FILENAME with
// Config.SAVE_BACKUP_FILENAME as the rotated backup. All other behaviors —
// SAVE_VERSION 3 with the FROM-keyed migration chain, PERSIST_SCHEME
// validation, throttled autosave, backup rotation with corrupt recovery,
// write-failure dirty-retry — are identical.

import Config from "../config";
import { createState, type GameState } from "../state";

// Minimal storage contract, compatible with the browser localStorage object.
export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem?(k: string): void;
}

// Live upgrade-levels container handed to save/load (see upgrades.ts once it
// is ported); get_state/set_state keep one shared level table.
export interface UpgradesLike {
  upgrades: Record<string, number>;
  get_state(): Record<string, number>;
  set_state(levels: Record<string, number>): void;
  get_passive_multiplier?(): number;
}

export type RawSave = Record<string, unknown>;
export class Save {
  storage: StorageLike;
  now_fn: () => number;
  dirty = false;
  _since_last_save = 0;
  _track: string | null = null;
  // Inbound post-save hook (play_time cadence carrier): the OWNER (UI layer)
  // installs the closure; nil by default. Fire-and-forget, fault-isolated in
  // update() so a UI-side raise never takes the save path down.
  on_saved: (() => void) | null = null;

  // The single authority for what persists. Any state field NOT listed here is
  // session-only (offline_report, session_*, save_warning) and never saved.
  static PERSIST_SCHEME: Record<string, string> = {
    gold: "number",
    exp: "number",
    tokens: "number",
    pity_counter: "number",
    last_save_time: "number",
    last_login_day: "number",
    login_streak: "number",
    total_gold_earned: "number",
    total_exp_earned: "number",
    total_tokens_earned: "number",
    passive_unlocked: "boolean",
    waifus: "waifu_list",
    upgrades: "string_to_number",
    exp_thresholds_unlocked: "string_to_true",
    // stats stays a FLAT {name -> number} map and achievements a {id -> true}
    // set: the shared map branches DROP wrongly-shaped entries rather than
    // failing the file, so the shape is pinned by the kind itself.
    stats: "string_to_number",
    achievements: "string_to_true",
    prestige_points: "number",
    prestige_rebirths: "number",
    prestige_gold_since_rebirth: "number",
    area_index: "number",
    area_kills: "number",
    highest_area: "number",
  };

  // Versioned save migrations: each entry upgrades a raw decoded chunk IN
  // PLACE from version n to n+1 and stamps the new _version. Keyed by the
  // FROM version, so v1 chains [1] -> [2] to reach v3.
  static MIGRATIONS: Record<number, (raw: RawSave) => RawSave> = {
    // v1 -> v2 seeds the prestige block: a v1 player never reborn, so their
    // entire lifetime gold counts as since-rebirth progress.
    1: (raw) => {
      raw.prestige_points = raw.prestige_points ?? 0;
      raw.prestige_rebirths = raw.prestige_rebirths ?? 0;
      raw.prestige_gold_since_rebirth = raw.total_gold_earned ?? 0;
      raw._version = 2;
      return raw;
    },
    // v2 -> v3 seeds the stats + achievements lifetime maps. Seed each absent
    // key forward-compatibly (never overwrite a carried value), so readers
    // never meet nil arithmetic. Seeded EMPTY on purpose: recording is later.
    2: (raw) => {
      raw.stats = raw.stats ?? {};
      raw.achievements = raw.achievements ?? {};
      raw._version = 3;
      return raw;
    },
    // v3 -> v4 seeds the areas ladder: a v3 player never left area 0, so the
    // fresh defaults ARE the correct history.
    3: (raw) => {
      raw.area_index = raw.area_index ?? 0;
      raw.area_kills = raw.area_kills ?? 0;
      raw.highest_area = raw.highest_area ?? raw.area_index ?? 0;
      raw._version = 4;
      return raw;
    },
  };

  constructor(storage: StorageLike, now_fn?: () => number) {
    this.storage = storage;
    this.now_fn = now_fn ?? (() => Math.floor(Date.now() / 1000));
  }

  // Parses the JSON payload into a plain object, or null on any problem.
  static _decode(str: string | null): RawSave | null {
    if (typeof str !== "string" || str.length === 0) return null;
    let data: unknown;
    try {
      data = JSON.parse(str);
    } catch {
      return null;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    return data as RawSave;
  }

  // Walks MIGRATIONS from the file's _version up to SAVE_VERSION. A missing
  // _version fails with a clear error (pre-version saves never shipped).
  static _migrate(raw: RawSave): [RawSave | null, string | null] {
    let version = raw._version;
    if (version === undefined || version === null) {
      return [null, "no _version in save (pre-version saves never existed)"];
    }
    if (typeof version !== "number") {
      return [null, "bad _version type: " + typeof version];
    }
    while (version < Config.SAVE_VERSION) {
      const step = Save.MIGRATIONS[version];
      if (!step) return [null, "no migration from version " + version];
      const prev = version;
      try {
        step(raw);
      } catch (e) {
        return [null, "migration from version " + prev + " failed: " + String(e)];
      }
      version = raw._version as number;
      if (typeof version !== "number" || version <= prev) {
        return [null, "migration from version " + prev + " did not advance _version"];
      }
    }
    return [raw, null];
  }

  // Type-checks a decoded chunk against PERSIST_SCHEME. Any violation fails
  // the whole file (the AC7 corrupt signal); unknown keys are dropped. Older
  // versions are already upgraded by _migrate before this runs.
  static _validate(raw: RawSave): [Record<string, unknown> | null, string | null] {
    if (raw._version !== Config.SAVE_VERSION) return [null, "version mismatch"];
    const out: Record<string, unknown> = {};
    for (const [key, kind] of Object.entries(Save.PERSIST_SCHEME)) {
      const v = raw[key];
      if (v === undefined || v === null) continue;
      if (kind === "number") {
        if (typeof v !== "number") return [null, "bad number field: " + key];
        out[key] = v;
      } else if (kind === "boolean") {
        if (typeof v !== "boolean") return [null, "bad boolean field: " + key];
        out[key] = v;
      } else if (kind === "waifu_list") {
        if (!Array.isArray(v)) return [null, "bad waifus list"];
        const list: Record<string, unknown>[] = [];
        for (let i = 0; i < v.length; i++) {
          const w = v[i] as Record<string, unknown> | null;
          if (
            !w || typeof w !== "object" ||
            typeof w.name !== "string" || typeof w.bonus_type !== "string" ||
            typeof w.bonus_value !== "number"
          ) {
            return [null, `bad waifu entry at ${i + 1}`];
          }
          const entry: Record<string, unknown> = {
            name: w.name, bonus_type: w.bonus_type, bonus_value: w.bonus_value,
          };
          // Additive: missing/bogus rarity normalizes to "common" so every
          // consumer can assume entry.rarity is a ladder key.
          entry.rarity = typeof w.rarity === "string" && Config.WAIFU_RARITY_BY_KEY[w.rarity]
            ? w.rarity : "common";
          list.push(entry);
        }
        out[key] = list;
      } else if (kind === "string_to_number" || kind === "string_to_true") {
        if (typeof v !== "object" || Array.isArray(v)) {
          return [null, "bad table field: " + key];
        }
        const copy: Record<string, unknown> = {};
        for (const [k, tv] of Object.entries(v as Record<string, unknown>)) {
          if (kind === "string_to_number") {
            if (typeof tv === "number") copy[k] = tv;
          } else if (tv === true) {
            copy[k] = true;
          }
        }
        out[key] = copy;
      }
    }
    return [out, null];
  }

  // Decode -> migrate -> validate. Logs and returns null on any failure.
  static _try(str: string | null): Record<string, unknown> | null {
    const decoded = Save._decode(str);
    if (!decoded) { console.log("[WARN] [SAVE] decode failed"); return null; }
    const [migrated, merr] = Save._migrate(decoded);
    if (!migrated) { console.log("[WARN] [SAVE] migration failed: " + String(merr)); return null; }
    const [data, verr] = Save._validate(migrated);
    if (!data) { console.log("[WARN] [SAVE] validation failed: " + String(verr)); return null; }
    return data;
  }

  // Overlays validated data onto a fresh state (table identity preserved). When
  // an Upgrades instance is given, state.upgrades is re-aliased to its live
  // level table so purchase() and the fingerprint see one table.
  _merge(state: GameState, data: Record<string, unknown>, upgrades?: UpgradesLike | null): GameState {
    const bag = state as unknown as Record<string, unknown>;
    for (const [key, v] of Object.entries(data)) bag[key] = v;
    if (upgrades && typeof upgrades.set_state === "function") {
      upgrades.set_state(state.upgrades);
      state.upgrades = upgrades.upgrades;
    }
    return state;
  }

  // Cheap change detector for AC2: currencies, pity, roster size, unlock-set
  // size, passive flag, upgrade levels, lifetime counters and achievements.
  _fingerprint(state: GameState, upgrades?: UpgradesLike | null): string {
    const parts: (string | number)[] = [
      state.gold ?? 0, state.exp ?? 0, state.tokens ?? 0, state.pity_counter ?? 0,
      state.total_gold_earned ?? 0, state.total_exp_earned ?? 0, state.total_tokens_earned ?? 0,
      String(state.passive_unlocked), state.waifus ? state.waifus.length : 0,
      state.area_index ?? 0, state.area_kills ?? 0, state.highest_area ?? 0,
    ];
    parts.push(Object.keys(state.exp_thresholds_unlocked ?? {}).length);
    const levels: Record<string, number> = upgrades ? upgrades.get_state() : state.upgrades ?? {};
    let sum = 0, count = 0;
    for (const v of Object.values(levels)) { if (typeof v === "number") sum += v; count++; }
    parts.push(sum + "/" + count);
    // stats rides the upgrades idiom (sum AND count); achievements the
    // unlock-set idiom (values pinned to true, so the count identifies it).
    let statSum = 0, statCount = 0;
    for (const v of Object.values(state.stats ?? {})) { if (typeof v === "number") statSum += v; statCount++; }
    parts.push("stats:" + statSum + "/" + statCount);
    parts.push("ach:" + Object.keys(state.achievements ?? {}).length);
    return parts.join("|");
  }

  private _remove(key: string): void {
    if (this.storage.removeItem) this.storage.removeItem(key);
    else { try { this.storage.setItem(key, ""); } catch { /* nothing more to do */ } }
  }

  // Writes a full save: stamps last_save_time, rotates the current main file
  // into the backup, then writes the new one. AC6: on write failure everything
  // stays intact, dirty remains set and the next update() retries.
  save(state: GameState, upgrades?: UpgradesLike | null, now?: number): boolean {
    const stamp = now ?? this.now_fn();
    state.last_save_time = stamp;

    const data: RawSave = { _version: Config.SAVE_VERSION };
    for (const key of Object.keys(Save.PERSIST_SCHEME)) {
      if (key === "upgrades" && upgrades) data[key] = upgrades.get_state();
      else {
        const v = (state as unknown as Record<string, unknown>)[key];
        if (v !== undefined && v !== null) data[key] = v;
      }
    }

    let str: string;
    try { str = JSON.stringify(data); }
    catch (e) { console.log("[ERROR] [SAVE] serialization failed: " + String(e)); this.dirty = true; return false; }

    const prev = this.storage.getItem(Config.SAVE_FILENAME);
    if (prev) {
      try { this.storage.setItem(Config.SAVE_BACKUP_FILENAME, prev); }
      catch { console.log("[WARN] [SAVE] backup rotation failed (continuing)"); }
    }
    try { this.storage.setItem(Config.SAVE_FILENAME, str); }
    catch {
      console.log("[ERROR] [SAVE] write failed for " + Config.SAVE_FILENAME + "; retrying next window (AC6)");
      this.dirty = true;
      return false;
    }

    this.dirty = false;
    this._since_last_save = 0;
    this._track = this._fingerprint(state, upgrades);
    return true;
  }

  // Loads progress over a fresh state (AC3). AC7 fallback chain: main file,
  // then backup, then fresh start. warning is non-nil whenever recovery or a
  // fresh-start-on-corrupt happened; loaded=false means "fresh game". A backup
  // restore also heals the corrupt main file via dirty.
  load_into(state: GameState, upgrades?: UpgradesLike | null): [boolean, string | null] {
    let data: Record<string, unknown> | null = null;
    let warning: string | null = null;
    const raw = this.storage.getItem(Config.SAVE_FILENAME);
    if (raw) {
      data = Save._try(raw);
      if (!data) {
        const bak = this.storage.getItem(Config.SAVE_BACKUP_FILENAME);
        data = bak ? Save._try(bak) : null;
        warning = data
          ? "Save file was corrupt - restored from backup."
          : "Save file was unreadable - starting a fresh game.";
      }
    } else {
      const bak = this.storage.getItem(Config.SAVE_BACKUP_FILENAME);
      if (bak) {
        data = Save._try(bak);
        if (data) warning = "Save file was missing - restored from backup.";
      }
    }
    if (data) {
      this._merge(state, data, upgrades);
      if (warning) this.dirty = true;
    }
    this._since_last_save = 0;
    this._track = this._fingerprint(state, upgrades);
    return [data !== null, warning];
  }

  // Per-frame hook: detects any gain or purchase (AC2) and saves at most once
  // per SAVE_MIN_INTERVAL; a failed write keeps dirty set so the next window
  // retries (AC6). The on_saved hook fires once per REAL save, fault-isolated.
  update(dt: number | undefined, state: GameState, upgrades?: UpgradesLike | null): boolean {
    this._since_last_save += dt ?? 0;
    const fp = this._fingerprint(state, upgrades);
    if (fp !== this._track) {
      this._track = fp;
      this.dirty = true;
    }
    if (this.dirty && this._since_last_save >= Config.SAVE_MIN_INTERVAL) {
      const ok = this.save(state, upgrades);
      if (ok && this.on_saved) {
        try { this.on_saved(); }
        catch (e) { console.log("[ERROR] [SAVE] on_saved hook raised: " + String(e)); }
      }
      return ok;
    }
    return false;
  }

  // Lifecycle safety flush: saves ONLY when dirty so a focus blip on an idle
  // game does not re-rotate the backup. Reuses save() verbatim.
  flush_if_dirty(state: GameState, upgrades?: UpgradesLike | null): boolean {
    if (!this.dirty) return false;
    return this.save(state, upgrades);
  }

  // AC5: delete both save files and reset state in place (table identity is
  // preserved because clicker/passive/UI all hold a reference to it).
  reset(state: GameState, upgrades?: UpgradesLike | null): boolean {
    this._remove(Config.SAVE_FILENAME);
    this._remove(Config.SAVE_BACKUP_FILENAME);
    const fresh = createState();
    const bag = state as unknown as Record<string, unknown>;
    for (const k of Object.keys(bag)) delete bag[k];
    Object.assign(bag, fresh);
    if (upgrades && typeof upgrades.set_state === "function") {
      upgrades.set_state(state.upgrades);
      state.upgrades = upgrades.upgrades;
    }
    this.dirty = false;
    this._since_last_save = 0;
    this._track = this._fingerprint(state, upgrades);
    return true;
  }
}

export default Save;
