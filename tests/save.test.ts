// tests/save.test.ts
// Vitest port of tests/test_save.lua: full-progress persistence (AC1/AC4),
// gain-triggered throttled autosave (AC2), load on boot (AC3), write-failure
// retry (AC6), corrupt-save recovery via backup (AC7), reset (AC5), versioned
// migrations and the lifetime-map validation contract.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { createState, type GameState } from "../src/state";
import Save, { type UpgradesLike } from "../src/systems/save";

const T0 = 1700000000;

// In-memory storage backend matching the injected contract. Failed writes
// throw (the JS-side equivalent of the Lua write() returning false).
function fakeStorage() {
  const files: Record<string, string> = {};
  const s = {
    files,
    writes: 0,
    fail_writes: false,
    getItem(k: string): string | null { return files[k] ?? null; },
    setItem(k: string, v: string): void {
      s.writes += 1;
      if (s.fail_writes) throw new Error("write failed");
      files[k] = v;
    },
    removeItem(k: string): void { delete files[k]; },
  };
  return s;
}

type FakeStorage = ReturnType<typeof fakeStorage>;

// Mirrors the state factory shape with interesting data in every persisted
// field (plus the session-only ones that must NOT be written).
function richState(): GameState {
  const st = createState(T0 - 60);
  st.gold = 1234.5; st.exp = 77; st.tokens = 23; st.pity_counter = 81;
  st.waifus = [
    { name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.1, rarity: "common" },
    { name: "Steve the HR Rep", bonus_type: "gold", bonus_value: 0.05, rarity: "common" },
  ];
  st.upgrades = { click_multiplier: 3, idle_rate: 2, gold_multiplier: 0, exp_multiplier: 0, crit_chance: 0 };
  st.last_save_time = T0;
  st.passive_unlocked = true;
  st.total_gold_earned = 9999.25; st.total_exp_earned = 120.5; st.total_tokens_earned = 40;
  st.session_clicks = 12; st.session_crits = 3;
  st.exp_thresholds_unlocked = { Slime: true };
  st.offline_report = { seconds: 100, tokens: 1, gold: 1, exp: 0.5 };
  return st;
}

function freshInstance(storage: FakeStorage): Save {
  return new Save(storage, () => T0 + 500);
}

// Minimal live-levels container following the Upgrades set_state/get_state
// contract: every definition key is always present, missing levels default 0.
const DEFINITIONS = ["click_multiplier", "idle_rate", "gold_multiplier",
  "exp_multiplier", "crit_chance", "unlock_passive"];

function fakeUpgrades(levels?: Record<string, number>): UpgradesLike {
  const up: UpgradesLike = {
    upgrades: {},
    get_state() { return up.upgrades; },
    set_state(next: Record<string, number>) {
      for (const k of Object.keys(up.upgrades)) delete up.upgrades[k];
      for (const d of DEFINITIONS) up.upgrades[d] = next?.[d] ?? 0;
    },
  };
  up.upgrades = Object.fromEntries(DEFINITIONS.map((d) => [d, levels?.[d] ?? 0]));
  return up;
}

// Stand-in for the Stats recorder the real clicker hook calls.
function recordClick(state: GameState, crit: boolean): void {
  state.stats.clicks = (state.stats.clicks ?? 0) + 1;
  if (crit) state.stats.crits = (state.stats.crits ?? 0) + 1;
}

// Seeds one main + one backup generation: main gold=20, backup gold=10.
function twoGenerationsStorage(): FakeStorage {
  const storage = fakeStorage();
  const inst = freshInstance(storage);
  const st = createState();
  st.gold = 10;
  inst.save(st, null, T0);
  st.gold = 20;
  inst.save(st, null, T0 + 10);
  storage.writes = 0;
  return storage;
}

// Fresh storage + state, instance tracking primed via load_into.
function autosaveSetup(): [FakeStorage, GameState, Save] {
  const storage = fakeStorage();
  const state = createState();
  const inst = new Save(storage, () => T0);
  inst.load_into(state, null);
  return [storage, state, inst];
}

// Same, but the two lifetime maps carry baseline values BEFORE load_into
// primes the fingerprint, so a later mutation is itself the fingerprint change.
function autosaveSetupRich(stats: Record<string, number> | null, achievements: Record<string, true> | null): [FakeStorage, GameState, Save] {
  const storage = fakeStorage();
  const state = createState();
  for (const [k, v] of Object.entries(stats ?? {})) state.stats[k] = v;
  for (const [k, v] of Object.entries(achievements ?? {})) state.achievements[k] = v;
  const inst = new Save(storage, () => T0);
  inst.load_into(state, null);
  return [storage, state, inst];
}

// Hand-written prior-version fixtures (JSON payload, Lua-literal analogue).
function writeV1Save(storage: FakeStorage): void {
  storage.files[Config.SAVE_FILENAME] = JSON.stringify({
    _version: 1, gold: 123.5, exp: 77, tokens: 23, pity_counter: 81,
    last_save_time: 1700000000, last_login_day: 3, login_streak: 4,
    total_gold_earned: 500000, total_exp_earned: 120.5, total_tokens_earned: 40,
    passive_unlocked: true,
    waifus: [{ name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.1, rarity: "rare" }],
    upgrades: { click_multiplier: 7, idle_rate: 3, gold_multiplier: 5, exp_multiplier: 2, crit_chance: 4, unlock_passive: 1 },
    exp_thresholds_unlocked: { "Spreadsheet Skeleton": true },
  });
}

// The version that predates the stats/achievements maps, named relative to
// the constant so a future bump cannot quietly turn this fixture into CURRENT.
// The v2 fixture exercises the FULL chain (2 -> 3 -> current), so the stats
// seeding and the areas seeding must BOTH land.
const V2 = 2;

function writeV2Save(storage: FakeStorage): void {
  storage.files[Config.SAVE_FILENAME] = JSON.stringify({
    _version: V2, gold: 123.5, exp: 77, tokens: 23, pity_counter: 81,
    last_save_time: 1700000000, last_login_day: 3, login_streak: 4,
    total_gold_earned: 500000, total_exp_earned: 120.5, total_tokens_earned: 40,
    passive_unlocked: true, prestige_points: 7, prestige_rebirths: 2, prestige_gold_since_rebirth: 4200000,
    waifus: [{ name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.1, rarity: "rare" }],
    upgrades: { click_multiplier: 7, idle_rate: 3, gold_multiplier: 5, exp_multiplier: 2, crit_chance: 4, unlock_passive: 1 },
    exp_thresholds_unlocked: { "Spreadsheet Skeleton": true },
  });
}

describe("Rarity persistence (per-pull tiers)", () => {
  it("round-trips each waifu's rarity field", () => {
    const storage = fakeStorage();
    const st = richState();
    st.waifus[0].rarity = "epic";
    st.waifus[1].rarity = "legendary";
    freshInstance(storage).save(st, null, T0);

    const fresh = createState();
    expect(freshInstance(storage).load_into(fresh, null)[0]).toBe(true);
    expect(fresh.waifus[0].rarity).toBe("epic");
    expect(fresh.waifus[1].rarity).toBe("legendary");
  });

  it("legacy saves without rarity load as common, not as an error", () => {
    const storage = fakeStorage();
    storage.files[Config.SAVE_FILENAME] = JSON.stringify({
      _version: Config.SAVE_VERSION,
      waifus: [{ name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.1 }],
    });
    const fresh = createState();
    const [loaded, warning] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(true);
    expect(warning).toBe(null);
    expect(fresh.waifus[0].rarity).toBe("common");
  });

  it("bogus rarity values normalize to common instead of rejecting the save", () => {
    const storage = fakeStorage();
    const st = richState();
    st.waifus[0].rarity = 42 as unknown as string;
    st.waifus[1].rarity = "mythic";
    freshInstance(storage).save(st, null, T0);
    const fresh = createState();
    expect(freshInstance(storage).load_into(fresh, null)[0]).toBe(true);
    expect(fresh.waifus[0].rarity).toBe("common");
    expect(fresh.waifus[1].rarity).toBe("common");
  });
});

describe("Save roundtrip (AC1, AC3)", () => {
  it("writes the save file named by Config.SAVE_FILENAME", () => {
    const storage = fakeStorage();
    const inst = freshInstance(storage);
    expect(inst.save(richState(), null, T0)).toBe(true);
    expect(storage.files[Config.SAVE_FILENAME]).toBeDefined();
  });

  it("restores all progress fields into a fresh state, session fields untouched", () => {
    const storage = fakeStorage();
    freshInstance(storage).save(richState(), null, T0);

    const fresh = createState();
    const [loaded, warning] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(true);
    expect(warning).toBe(null);
    expect(fresh.gold).toBe(1234.5);
    expect(fresh.exp).toBe(77);
    expect(fresh.tokens).toBe(23);
    expect(fresh.pity_counter).toBe(81);
    expect(fresh.waifus.length).toBe(2);
    expect(fresh.waifus[0].name).toBe("Karen the Accountant");
    expect(fresh.waifus[0].bonus_value).toBe(0.1);
    expect(fresh.waifus[1].name).toBe("Steve the HR Rep");
    expect(fresh.passive_unlocked).toBe(true);
    expect(fresh.total_gold_earned).toBe(9999.25);
    expect(fresh.total_exp_earned).toBe(120.5);
    expect(fresh.total_tokens_earned).toBe(40);
    expect(fresh.exp_thresholds_unlocked.Slime).toBe(true);
    expect(fresh.last_save_time).toBe(T0);
    // Session-only fields keep their fresh-init defaults:
    expect(fresh.session_clicks).toBe(0);
    expect(fresh.session_crits).toBe(0);
    expect(fresh.offline_report).toBe(null);
  });

  it("stamps last_save_time with the write time, not the stale state value", () => {
    const storage = fakeStorage();
    const inst = freshInstance(storage);
    const st = richState();
    expect(inst.save(st, null, T0 + 250)).toBe(true);
    const data = Save._decode(storage.files[Config.SAVE_FILENAME])!;
    expect(data.last_save_time).toBe(T0 + 250);
    expect(st.last_save_time).toBe(T0 + 250);
  });

  it("excludes session-only fields from the save file entirely", () => {
    const storage = fakeStorage();
    const st = richState();
    st.save_warning = "should never be written";
    freshInstance(storage).save(st, null, T0);
    const raw = storage.files[Config.SAVE_FILENAME];
    expect(raw).not.toContain("offline_report");
    expect(raw).not.toContain("session_clicks");
    expect(raw).not.toContain("save_warning");
    expect(raw).toContain("gold");
  });

  it("restores upgrade levels into the Upgrades instance and re-aliases state.upgrades", () => {
    const storage = fakeStorage();
    const levels = { click_multiplier: 4, idle_rate: 1, gold_multiplier: 0, exp_multiplier: 0, crit_chance: 0, unlock_passive: 1 };
    const srcUp = fakeUpgrades(levels);
    const st = richState();
    st.upgrades = srcUp.upgrades;
    freshInstance(storage).save(st, srcUp, T0);

    const fresh = createState();
    const dstUp = fakeUpgrades();
    const [loaded] = freshInstance(storage).load_into(fresh, dstUp);
    expect(loaded).toBe(true);
    expect(dstUp.upgrades.click_multiplier).toBe(4);
    expect(dstUp.upgrades.unlock_passive).toBe(1);
    // set_state fills in any missing definition keys:
    expect(dstUp.upgrades.crit_chance).toBe(0);
    // state.upgrades and the live upgrades table are the SAME table again:
    expect(fresh.upgrades).toBe(dstUp.upgrades);
    expect(fresh.upgrades.click_multiplier).toBe(4);
  });
});

describe("Corrupt-save recovery (AC7)", () => {
  it("corrupt main, valid backup: restores backup with a 'backup' warning", () => {
    const storage = twoGenerationsStorage();
    storage.files[Config.SAVE_FILENAME] = "{ broken";
    const fresh = createState();
    const [loaded, warning] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(true);
    expect(fresh.gold).toBe(10);
    expect(warning).not.toBe(null);
    expect(String(warning).toLowerCase()).toContain("backup");
  });

  it("restoring from backup marks the main file dirty so the next update heals it", () => {
    const storage = twoGenerationsStorage();
    storage.files[Config.SAVE_FILENAME] = "{ broken";
    const fresh = createState();
    const inst = freshInstance(storage);
    inst.load_into(fresh, null);
    inst.update(Config.SAVE_MIN_INTERVAL + 1, fresh, null);
    const healed = Save._decode(storage.files[Config.SAVE_FILENAME]);
    expect(healed).not.toBe(null);
    expect(healed!.gold).toBe(10);
  });

  it("missing main but valid backup: restores from backup with a warning", () => {
    const storage = twoGenerationsStorage();
    delete storage.files[Config.SAVE_FILENAME];
    const fresh = createState();
    const [loaded, warning] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(true);
    expect(fresh.gold).toBe(10);
    expect(warning).not.toBe(null);
  });

  it("corrupt main AND backup: fresh state, warning shown, no error raised", () => {
    const storage = twoGenerationsStorage();
    storage.files[Config.SAVE_FILENAME] = "garbage";
    storage.files[Config.SAVE_BACKUP_FILENAME] = "more garbage";
    const fresh = createState();
    const [loaded, warning] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(false);
    expect(fresh.gold).toBe(0);
    expect(warning).not.toBe(null);
  });

  it("no save and no backup at all: fresh start, no warning", () => {
    const storage = fakeStorage();
    const fresh = createState();
    const [loaded, warning] = new Save(storage, () => T0).load_into(fresh, null);
    expect(loaded).toBe(false);
    expect(warning).toBe(null);
    expect(fresh.gold).toBe(0);
  });

  it("non-object chunk is treated as corrupt", () => {
    const storage = fakeStorage();
    storage.files[Config.SAVE_FILENAME] = "42";
    const fresh = createState();
    const [loaded, warning] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(false);
    expect(warning).not.toBe(null);
  });

  it("wrong-typed persisted field treats the whole file as corrupt", () => {
    const storage = fakeStorage();
    storage.files[Config.SAVE_FILENAME] = JSON.stringify({ _version: Config.SAVE_VERSION, gold: "lots" });
    const fresh = createState();
    const [loaded, warning] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(false);
    expect(fresh.gold).toBe(0);
    expect(warning).not.toBe(null);
  });

  it("future-version save is rejected as a version mismatch", () => {
    const storage = fakeStorage();
    storage.files[Config.SAVE_FILENAME] = JSON.stringify({ _version: Config.SAVE_VERSION + 1, gold: 5 });
    const fresh = createState();
    const [loaded, warning] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(false);
    expect(fresh.gold).toBe(0);
    expect(warning).not.toBe(null);
  });

  it("unknown keys are silently ignored (forward-compatible merge)", () => {
    const storage = fakeStorage();
    storage.files[Config.SAVE_FILENAME] = JSON.stringify({ _version: Config.SAVE_VERSION, gold: 55, rocket_launcher: true });
    const fresh = createState();
    const [loaded] = freshInstance(storage).load_into(fresh, null);
    expect(loaded).toBe(true);
    expect(fresh.gold).toBe(55);
    expect((fresh as unknown as Record<string, unknown>).rocket_launcher).toBeUndefined();
  });
});

describe("Autosave on gains (AC2) and write-failure retry (AC6)", () => {
  it("steady state produces zero writes", () => {
    const [storage, state, inst] = autosaveSetup();
    for (let i = 0; i < 10; i++) inst.update(Config.SAVE_MIN_INTERVAL, state, null);
    expect(storage.writes).toBe(0);
    expect(storage.files[Config.SAVE_FILENAME]).toBeUndefined();
  });

  it("a gold gain after the min interval triggers a real save", () => {
    const [storage, state, inst] = autosaveSetup();
    state.gold = 50;
    inst.update(0.4, state, null);
    expect(storage.writes).toBe(0);
    inst.update(0.7, state, null);
    expect(storage.writes).toBe(1);
    expect(Save._decode(storage.files[Config.SAVE_FILENAME])!.gold).toBe(50);
  });

  it("waifu added, threshold unlocked, and upgrade level each dirty the fingerprint", () => {
    const [storage, state, inst] = autosaveSetup();
    const up = fakeUpgrades();
    up.set_state(state.upgrades);

    // Each save after the first also writes the rotated backup (2 writes).
    state.waifus.push({ name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.1, rarity: "common" });
    inst.update(Config.SAVE_MIN_INTERVAL + 1, state, up);
    expect(storage.writes).toBe(1);

    state.exp_thresholds_unlocked.Slime = true;
    inst.update(Config.SAVE_MIN_INTERVAL + 1, state, up);
    expect(storage.writes).toBe(3);

    up.upgrades.click_multiplier = up.upgrades.click_multiplier + 1;
    inst.update(Config.SAVE_MIN_INTERVAL + 1, state, up);
    expect(storage.writes).toBe(5);
  });

  it("a stats counter change dirties the fingerprint and triggers a throttled autosave", () => {
    const [storage, state, inst] = autosaveSetupRich({ clicks: 1, crits: 0 }, null);
    state.stats.clicks = 2;
    inst.update(Config.SAVE_MIN_INTERVAL + 1, state, null);
    expect(storage.writes, "a same-key value change must dirty the fingerprint").toBe(1);
    expect(Save._decode(storage.files[Config.SAVE_FILENAME])!.stats).toMatchObject({ clicks: 2 });
  });

  it("a REAL recorded increment via the Stats recorder dirties the fingerprint and persists", () => {
    const [storage, state, inst] = autosaveSetupRich({ clicks: 1, crits: 0 }, null);
    recordClick(state, true);
    inst.update(Config.SAVE_MIN_INTERVAL + 1, state, null);
    expect(storage.writes, "the recorded increment must dirty the fingerprint").toBe(1);
    const saved = Save._decode(storage.files[Config.SAVE_FILENAME])!.stats as Record<string, number>;
    expect(saved.clicks).toBe(2);
    expect(saved.crits, "the crit leg of the same call persists as a flat numeric key").toBe(1);
  });

  it("an achievement unlock dirties the fingerprint and triggers a throttled autosave", () => {
    const [storage, state, inst] = autosaveSetupRich({ clicks: 1 }, {});
    state.achievements.first_click = true;
    inst.update(Config.SAVE_MIN_INTERVAL + 1, state, null);
    expect(storage.writes, "a new achievement key must dirty the fingerprint").toBe(1);
    expect((Save._decode(storage.files[Config.SAVE_FILENAME])!.achievements as Record<string, true>).first_click).toBe(true);
  });

  it("steady state with populated stat maps produces zero writes", () => {
    const [storage, state, inst] = autosaveSetupRich({ clicks: 4, pulls_rare: 2 }, { first_click: true });
    for (let i = 0; i < 10; i++) inst.update(Config.SAVE_MIN_INTERVAL, state, null);
    expect(storage.writes, "unmutated maps must not drive writes").toBe(0);
    expect(storage.files[Config.SAVE_FILENAME]).toBeUndefined();
  });

  it("passive trickle is throttled to roughly one write per interval", () => {
    const [storage, state, inst] = autosaveSetup();
    for (let i = 0; i < 125; i++) {
      state.gold = state.gold + 0.02;
      inst.update(0.016, state, null);
    }
    // ~2s of passive income at 1s min-interval: a handful of writes, never 125.
    expect(storage.writes >= 1).toBe(true);
    expect(storage.writes <= 3).toBe(true);
  });

  it("successful save rotates the previous main file into the backup", () => {
    const storage = twoGenerationsStorage();
    expect(Save._decode(storage.files[Config.SAVE_BACKUP_FILENAME])!.gold).toBe(10);
    expect(Save._decode(storage.files[Config.SAVE_FILENAME])!.gold).toBe(20);
  });

  it("failed save stays dirty, keeps files intact, and succeeds on the next window (AC6)", () => {
    const [storage, state, inst] = autosaveSetup();
    storage.fail_writes = true;
    state.gold = 111;
    expect(inst.update(Config.SAVE_MIN_INTERVAL + 1, state, null)).toBe(false);
    expect(storage.files[Config.SAVE_FILENAME]).toBeUndefined();

    storage.fail_writes = false;
    expect(inst.update(Config.SAVE_MIN_INTERVAL + 1, state, null)).toBe(true);
    expect(Save._decode(storage.files[Config.SAVE_FILENAME])!.gold).toBe(111);
  });

  it("failed save does not clobber the existing backup (rotation write also fails first)", () => {
    const storage = twoGenerationsStorage();
    const state = createState();
    state.gold = 20;
    const inst = freshInstance(storage);
    inst.load_into(state, null);
    storage.fail_writes = true;
    state.gold = 30;
    expect(inst.update(Config.SAVE_MIN_INTERVAL + 1, state, null)).toBe(false);
    expect(Save._decode(storage.files[Config.SAVE_FILENAME])!.gold).toBe(20);
    expect(Save._decode(storage.files[Config.SAVE_BACKUP_FILENAME])!.gold).toBe(10);
  });

  it("update with unchanged state after a save performs no further writes", () => {
    const [storage, state, inst] = autosaveSetup();
    state.gold = 5;
    inst.update(Config.SAVE_MIN_INTERVAL + 1, state, null);
    const writesAfter = storage.writes;
    for (let i = 0; i < 5; i++) inst.update(Config.SAVE_MIN_INTERVAL + 1, state, null);
    expect(storage.writes).toBe(writesAfter);
  });
});

describe("Reset (AC5)", () => {
  it("wipes both files and resets the state table in place", () => {
    const storage = fakeStorage();
    const st = richState();
    const inst = freshInstance(storage);
    inst.save(st, null, T0);
    expect(storage.files[Config.SAVE_FILENAME]).toBeDefined();
    st.offline_report = { seconds: 1 };

    inst.reset(st, null);
    expect(storage.files[Config.SAVE_FILENAME]).toBeUndefined();
    expect(storage.files[Config.SAVE_BACKUP_FILENAME]).toBeUndefined();
    expect(st.gold).toBe(0);
    expect(st.tokens).toBe(0);
    expect(st.waifus).toEqual([]);
    expect(st.pity_counter).toBe(0);
    expect(st.passive_unlocked).toBe(false);
    expect(st.offline_report).toBe(null);
    // Post-reset the instance must not immediately re-save the fresh state:
    expect(inst.update(Config.SAVE_MIN_INTERVAL + 1, st, null)).toBe(false);
    expect(storage.files[Config.SAVE_FILENAME]).toBeUndefined();
  });

  it("zeroes upgrade instance levels and keeps state.upgrades aliased", () => {
    const storage = fakeStorage();
    const up = fakeUpgrades({ click_multiplier: 7, idle_rate: 2, gold_multiplier: 0, exp_multiplier: 0, crit_chance: 0, unlock_passive: 1 });
    const st = createState();
    st.upgrades = up.upgrades;
    const inst = freshInstance(storage);
    inst.reset(st, up);
    for (const key of DEFINITIONS) {
      expect(up.upgrades[key], "level for " + key).toBe(0);
    }
    expect(st.upgrades).toBe(up.upgrades);
  });
});

describe("Save config", () => {
  it("has sane, distinct save constants", () => {
    expect(typeof Config.SAVE_FILENAME).toBe("string");
    expect(typeof Config.SAVE_BACKUP_FILENAME).toBe("string");
    expect(Config.SAVE_FILENAME).not.toBe(Config.SAVE_BACKUP_FILENAME);
    // v4: the areas ladder fields. Asserted as a concrete number so an
    // accidental re-tune of the constant is caught.
    expect(Config.SAVE_VERSION).toBe(5);
    expect(Config.SAVE_MIN_INTERVAL >= 0.2).toBe(true);
    expect(Config.SAVE_MIN_INTERVAL <= 5).toBe(true);
    expect(typeof Config.RESET_BTN_WIDTH).toBe("number");
    expect(typeof Config.RESET_BTN_MARGIN).toBe("number");
    expect(typeof Config.SAVE_WARNING_LIFETIME).toBe("number");
  });
});

describe("Save migration chain (PREST-03, SAVE-01/SAVE-02)", () => {
  it("loads a hand-written v1 save preserving every field and seeding the prestige block", () => {
    const storage = fakeStorage();
    writeV1Save(storage);
    const ups = fakeUpgrades();
    const state = createState();
    const [loaded, warning] = freshInstance(storage).load_into(state, ups);

    expect(loaded).toBe(true);
    expect(warning).toBe(null);
    expect(state.gold).toBe(123.5);
    expect(state.exp).toBe(77);
    expect(state.tokens).toBe(23);
    expect(state.pity_counter).toBe(81);
    expect(state.last_save_time).toBe(1700000000);
    expect(state.last_login_day).toBe(3);
    expect(state.login_streak).toBe(4);
    expect(state.total_gold_earned).toBe(500000);
    expect(state.passive_unlocked).toBe(true);
    expect(state.waifus.length).toBe(1);
    expect(state.waifus[0].name).toBe("Karen the Accountant");
    expect(state.waifus[0].rarity).toBe("rare");
    expect(state.exp_thresholds_unlocked["Spreadsheet Skeleton"]).toBe(true);
    expect(ups.upgrades.click_multiplier).toBe(7);
    expect(ups.upgrades.unlock_passive).toBe(1);
    expect(state.upgrades).toBe(ups.upgrades); // re-aliased to the live table
    // No rebirth ever happened, so lifetime gold counts as since-rebirth:
    expect(state.prestige_points).toBe(0);
    expect(state.prestige_rebirths).toBe(0);
    expect(state.prestige_gold_since_rebirth).toBe(500000);
  });

  it("re-saves a migrated v1 load as the current-version file", () => {
    const storage = fakeStorage();
    writeV1Save(storage);
    const ups = fakeUpgrades();
    const state = createState();
    expect(freshInstance(storage).load_into(state, ups)[0]).toBe(true);
    freshInstance(storage).save(state, ups, T0 + 1);
    const data = Save._decode(storage.files[Config.SAVE_FILENAME])!;
    expect(data._version).toBe(Config.SAVE_VERSION);
    expect(data.prestige_points).toBe(0);
    expect(data.prestige_gold_since_rebirth).toBe(500000);
  });

  it("round-trips a current-version save with a populated prestige block", () => {
    const storage = fakeStorage();
    const st = richState();
    st.prestige_points = 5;
    st.prestige_rebirths = 2;
    st.prestige_gold_since_rebirth = 12345;
    freshInstance(storage).save(st, null, T0);

    const fresh = createState();
    expect(freshInstance(storage).load_into(fresh, null)[0]).toBe(true);
    expect(fresh.prestige_points).toBe(5);
    expect(fresh.prestige_rebirths).toBe(2);
    expect(fresh.prestige_gold_since_rebirth).toBe(12345);
    expect(Save._decode(storage.files[Config.SAVE_FILENAME])!._version).toBe(Config.SAVE_VERSION);
  });

  it("fails clearly on a save with no _version at all", () => {
    const storage = fakeStorage();
    storage.files[Config.SAVE_FILENAME] = JSON.stringify({ gold: 5, exp: 1 });
    const st = createState();
    const [loaded, warning] = freshInstance(storage).load_into(st, null);
    expect(loaded).toBe(false);
    expect(warning).not.toBe(null);
    expect(st.gold).toBe(0);
  });

  it("declares the three prestige fields in PERSIST_SCHEME", () => {
    expect(Save.PERSIST_SCHEME.prestige_points).toBe("number");
    expect(Save.PERSIST_SCHEME.prestige_rebirths).toBe("number");
    expect(Save.PERSIST_SCHEME.prestige_gold_since_rebirth).toBe("number");
  });

  it("registers a MIGRATIONS step for the pre-stats version", () => {
    expect(typeof Save.MIGRATIONS[V2]).toBe("function");
  });

  it("loads a hand-written v2 save preserving every field including prestige", () => {
    const storage = fakeStorage();
    writeV2Save(storage);
    const ups = fakeUpgrades();
    const state = createState();
    const [loaded, warning] = freshInstance(storage).load_into(state, ups);

    expect(loaded).toBe(true);
    expect(warning).toBe(null);
    expect(state.gold).toBe(123.5);
    expect(state.last_save_time).toBe(1700000000);
    expect(state.login_streak).toBe(4);
    expect(state.passive_unlocked).toBe(true);
    expect(state.waifus.length).toBe(1);
    expect(state.waifus[0].rarity).toBe("rare");
    expect(state.exp_thresholds_unlocked["Spreadsheet Skeleton"]).toBe(true);
    expect(ups.upgrades.click_multiplier).toBe(7);
    expect(state.upgrades).toBe(ups.upgrades);
    expect(state.prestige_points).toBe(7);
    expect(state.prestige_rebirths).toBe(2);
    expect(state.prestige_gold_since_rebirth).toBe(4200000);
  });

  it("seeds stats + achievements EMPTY on a v2 load - not nil", () => {
    const storage = fakeStorage();
    writeV2Save(storage);
    const state = createState();
    // Wiped first: _merge only overlays keys the file carried, so a non-nil
    // result after load can ONLY come from the migration seeding them.
    delete (state as unknown as Record<string, unknown>).stats;
    delete (state as unknown as Record<string, unknown>).achievements;
    expect(freshInstance(storage).load_into(state, null)[0]).toBe(true);
    expect(state.stats).not.toBe(null);
    expect(state.stats).toEqual({});
    expect(state.achievements).toEqual({});
  });

  it("re-saves a migrated v2 load as the current-version file, carrying both maps", () => {
    const storage = fakeStorage();
    writeV2Save(storage);
    const state = createState();
    expect(freshInstance(storage).load_into(state, null)[0]).toBe(true);
    freshInstance(storage).save(state, null, T0 + 1);
    const data = Save._decode(storage.files[Config.SAVE_FILENAME])!;
    expect(data._version).toBe(Config.SAVE_VERSION);
    expect(data.stats).toEqual({});
    expect(data.achievements).toEqual({});
    expect(data.prestige_points).toBe(7);
  });

  it("walks a v1 file the whole way up so the chain lands on the new schema", () => {
    const storage = fakeStorage();
    writeV1Save(storage);
    const state = createState();
    expect(freshInstance(storage).load_into(state, null)[0]).toBe(true);
    expect(state.stats).toEqual({});
    expect(state.achievements).toEqual({});
    expect(state.prestige_gold_since_rebirth).toBe(500000);
  });

  it("does not invent values for the two maps when migrating a v2 file", () => {
    const storage = fakeStorage();
    writeV2Save(storage);
    const state = createState();
    expect(freshInstance(storage).load_into(state, null)[0]).toBe(true);
    expect(Object.keys(state.stats).length).toBe(0);
    expect(Object.keys(state.achievements).length).toBe(0);
  });
});

describe("Stats/achievements persistence (SAVE-03, SAVE-04)", () => {
  it("declares the two new containers using the EXISTING validator kinds", () => {
    expect(Save.PERSIST_SCHEME.stats).toBe("string_to_number");
    expect(Save.PERSIST_SCHEME.achievements).toBe("string_to_true");
  });

  it("every PERSIST_SCHEME key carries a fresh-state default", () => {
    const fresh = createState() as unknown as Record<string, unknown>;
    for (const key of Object.keys(Save.PERSIST_SCHEME)) {
      expect(fresh[key], "PERSIST_SCHEME key " + key + " has no fresh default").toBeDefined();
    }
  });

  it("starts both containers empty, not nil, on a fresh state", () => {
    const fresh = createState();
    expect(fresh.stats).toEqual({ badge_reward_gold: 0, badge_reward_tokens: 0 });
    expect(fresh.achievements).toEqual({});
  });

  it("round-trips a populated stats map and achievements set", () => {
    const storage = fakeStorage();
    const st = richState();
    st.stats = { clicks: 9, crits: 1, pulls_rare: 2, play_time: 12.5 };
    st.achievements = { first_click: true, explorer: true };
    freshInstance(storage).save(st, null, T0);

    const fresh = createState();
    expect(freshInstance(storage).load_into(fresh, null)[0]).toBe(true);
    expect(fresh.stats.clicks).toBe(9);
    expect(fresh.stats.crits).toBe(1);
    expect(fresh.stats.pulls_rare).toBe(2);
    expect(fresh.stats.play_time).toBe(12.5); // fractional seconds survive the round-trip
    expect(fresh.achievements.first_click).toBe(true);
    expect(fresh.achievements.explorer).toBe(true);
  });

  it("drops wrongly-shaped entries instead of persisting them (flat numeric contract)", () => {
    const storage = fakeStorage();
    const st = richState();
    st.stats = { clicks: 3, label: "nine", nested: { common: 1 } } as unknown as Record<string, number>;
    st.achievements = { first_click: true, junk: false, count: 1 } as unknown as Record<string, true>;
    freshInstance(storage).save(st, null, T0);

    const fresh = createState();
    expect(freshInstance(storage).load_into(fresh, null)[0]).toBe(true);
    expect(fresh.stats.clicks).toBe(3);
    expect(fresh.stats.label).toBeUndefined();
    expect(fresh.stats.nested).toBeUndefined();
    expect(fresh.achievements.first_click).toBe(true);
    expect(fresh.achievements.junk).toBeUndefined();
    expect(fresh.achievements.count).toBeUndefined();
  });
});

describe("flush_if_dirty (lifecycle safety flush)", () => {
  it("dirty state returns true and leaves main + backup written", () => {
    const storage = fakeStorage();
    const inst = freshInstance(storage);
    const st = richState();
    inst.update(2.0, st, null); // fingerprint gain -> dirty -> autosave writes main
    expect(inst.dirty).toBe(false);
    inst.dirty = true;
    const writesBefore = storage.writes;
    expect(inst.flush_if_dirty(st, null)).toBe(true);
    expect(storage.writes > writesBefore).toBe(true);
    expect(storage.files[Config.SAVE_FILENAME]).toBeDefined();
    expect(storage.files[Config.SAVE_BACKUP_FILENAME]).toBeDefined();
  });

  it("clean state returns false without writing or rotating", () => {
    const storage = fakeStorage();
    const inst = freshInstance(storage);
    const st = richState();
    inst.update(2.0, st, null);
    expect(inst.dirty).toBe(false);
    const writesBefore = storage.writes;
    expect(inst.flush_if_dirty(st, null)).toBe(false);
    expect(storage.writes).toBe(writesBefore);
  });

  it("failed writes keep dirty=true with files intact, next flush retries (AC6)", () => {
    const storage = fakeStorage();
    const inst = freshInstance(storage);
    const st = richState();
    inst.update(2.0, st, null);
    const mainAfterFirst = storage.files[Config.SAVE_FILENAME];
    inst.dirty = true;
    storage.fail_writes = true;
    expect(inst.flush_if_dirty(st, null)).toBe(false);
    expect(inst.dirty, "AC6: failed flush keeps dirty set for retry").toBe(true);
    expect(storage.files[Config.SAVE_FILENAME]).toBe(mainAfterFirst);
    storage.fail_writes = false;
    expect(inst.flush_if_dirty(st, null), "next flush retries and succeeds").toBe(true);
    expect(inst.dirty).toBe(false);
  });
});

describe("boot re-stamp composition", () => {
  it("load_into -> gain -> update(0) -> flush re-stamps last_save_time; second flush no-ops", () => {
    const storage = fakeStorage();
    const prior = createState();
    prior.gold = 500;
    expect(freshInstance(storage).save(prior, null, T0)).toBe(true);

    const state = createState();
    const inst = new Save(storage, () => T0 + 500);
    expect(inst.load_into(state, null)[0]).toBe(true);

    // Offline catch-up analogue: credit a gain, then the boot re-stamp pair.
    state.gold = state.gold + 250;
    expect(inst.update(0, state, null)).toBe(false);
    expect(inst.dirty, "credited catch-up gain must mark dirty").toBe(true);

    expect(inst.flush_if_dirty(state, null)).toBe(true);

    const mainData = Save._try(storage.files[Config.SAVE_FILENAME])!;
    expect(mainData.last_save_time).toBe(T0 + 500);
    const bakData = Save._try(storage.files[Config.SAVE_BACKUP_FILENAME])!;
    expect(bakData.last_save_time).toBe(T0);

    expect(inst.flush_if_dirty(state, null)).toBe(false);
  });
});

describe("Portability pin (cross-instance round-trip, version stability, bak recovery)", () => {
  it("one instance's save loads unchanged into a fresh instance over a fresh state", () => {
    const storage = fakeStorage();

    // Source side: one Save instance + live Upgrades writes the file.
    const srcUp = fakeUpgrades({ click_multiplier: 3, idle_rate: 2, unlock_passive: 1 });
    const st = richState();
    st.upgrades = srcUp.upgrades;
    st.last_login_day = 12345;
    st.login_streak = 7;
    st.stats = { clicks: 12, kills: 12, play_time: 61.5 };
    st.achievements = { first_click: true, hundred_kills: true };
    st.prestige_points = 2;
    st.prestige_rebirths = 1;
    st.prestige_gold_since_rebirth = 3456789.5;
    expect(freshInstance(storage).save(st, srcUp, T0)).toBe(true);

    // The file stamps the current format version.
    expect(Save._decode(storage.files[Config.SAVE_FILENAME])!._version).toBe(Config.SAVE_VERSION);

    // Target side: TWO independent fresh instances/states over the same storage.
    const dstA = createState();
    const upA = fakeUpgrades();
    expect(freshInstance(storage).load_into(dstA, upA)[0]).toBe(true);
    const dstB = createState();
    const upB = fakeUpgrades();
    expect(freshInstance(storage).load_into(dstB, upB)[0]).toBe(true);

    // Every scalar PERSIST_SCHEME key survives the instance boundary.
    expect(dstA.gold).toBe(1234.5);
    expect(dstA.exp).toBe(77);
    expect(dstA.tokens).toBe(23);
    expect(dstA.pity_counter).toBe(81);
    expect(dstA.last_save_time).toBe(T0);
    expect(dstA.last_login_day).toBe(12345);
    expect(dstA.login_streak).toBe(7);
    expect(dstA.total_gold_earned).toBe(9999.25);
    expect(dstA.total_exp_earned).toBe(120.5);
    expect(dstA.total_tokens_earned).toBe(40);
    expect(dstA.passive_unlocked).toBe(true);
    expect(dstA.waifus.length).toBe(2);
    expect(dstA.waifus[0].name).toBe("Karen the Accountant");
    expect(dstA.waifus[1].bonus_type).toBe("gold");
    expect(dstA.waifus[1].bonus_value).toBe(0.05);
    expect(dstA.exp_thresholds_unlocked.Slime).toBe(true);
    expect(dstA.stats.play_time).toBe(61.5);
    expect(dstA.achievements.first_click).toBe(true);
    expect(dstA.prestige_points).toBe(2);
    expect(dstA.prestige_rebirths).toBe(1);
    expect(dstA.prestige_gold_since_rebirth).toBe(3456789.5);
    expect(upA.upgrades.click_multiplier).toBe(3);
    expect(upA.upgrades.unlock_passive).toBe(1);
    expect(dstA.upgrades).toBe(upA.upgrades);

    // Determinism leg: the second fresh load matches the first field-for-field.
    expect(dstB.gold).toBe(dstA.gold);
    expect(dstB.last_save_time).toBe(dstA.last_save_time);
    expect(dstB.waifus.length).toBe(dstA.waifus.length);
    expect(dstB.waifus[0].name).toBe(dstA.waifus[0].name);
    expect(dstB.prestige_points).toBe(dstA.prestige_points);
    expect(upB.upgrades.click_multiplier).toBe(upA.upgrades.click_multiplier);
  });

  it("SAVE_VERSION stays 5 - portability is verified, not rewritten", () => {
    expect(Config.SAVE_VERSION).toBe(5);
  });

  it("corrupt main + intact backup recovers with a warning, next save re-rotates both files", () => {
    const storage = twoGenerationsStorage();
    storage.files[Config.SAVE_FILENAME] = "{ broken";

    const inst = freshInstance(storage);
    const fresh = createState();
    const [loaded, warning] = inst.load_into(fresh, null);
    expect(loaded).toBe(true);
    expect(fresh.gold).toBe(10);
    expect(warning, "backup recovery must surface a warning").not.toBe(null);

    // The restore marks main dirty; the next real save heals main and rotates
    // the prior (corrupt) main into the backup.
    expect(inst.update(Config.SAVE_MIN_INTERVAL + 1, fresh, null)).toBe(true);
    expect(Save._try(storage.files[Config.SAVE_FILENAME])!.gold).toBe(10);
    inst.dirty = true;
    expect(inst.flush_if_dirty(fresh, null)).toBe(true);
    expect(Save._try(storage.files[Config.SAVE_FILENAME])!.gold).toBe(10);
    expect(Save._try(storage.files[Config.SAVE_BACKUP_FILENAME])!.gold).toBe(10);
  });
});


describe("Per-area assignments (v5)", () => {
  it("validates assignments_map buckets: string-only lanes, junk buckets dropped", () => {
    const [data, err] = Save._validate({
      _version: Config.SAVE_VERSION,
      assignments: { 0: ["Karen the Accountant", 42], 1: "nope" },
    });
    expect(err).toBe(null);
    expect(data!.assignments).toEqual({ 0: ["Karen the Accountant"] });
  });

  it("fails a whole file when assignments is not an object", () => {
    const [data, err] = Save._validate({ _version: Config.SAVE_VERSION, assignments: [1, 2] });
    expect(data).toBe(null);
    expect(err).toContain("assignments");
  });

  it("migrates a v4 equip lane into the current-area bucket", () => {
    const raw: Record<string, unknown> = {
      _version: 4, area_index: 2, highest_area: 3,
      equipped: ["Karen the Accountant", "Dave from IT"],
    };
    Save.MIGRATIONS[4](raw);
    expect(raw._version).toBe(5);
    expect(raw.assignments).toEqual({ 2: ["Karen the Accountant", "Dave from IT"] });
    expect(raw.equipped).toBeUndefined();
  });

  it("round-trips assignments through save and load", () => {
    const storage = fakeStorage();
    const inst = freshInstance(storage);
    const state = createState();
    state.assignments = { 0: ["Karen the Accountant"], 2: ["Dave from IT"] };
    expect(inst.save(state, null, T0)).toBe(true);
    const fresh = createState();
    expect(freshInstance(storage).load_into(fresh, null)[0]).toBe(true);
    expect(fresh.assignments).toEqual({ 0: ["Karen the Accountant"], 2: ["Dave from IT"] });
  });
});
