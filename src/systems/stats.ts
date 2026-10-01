// src/systems/stats.ts
// Lifetime statistics recorder. PURE module: methods take the shared state
// table and only bump numeric keys on the FLAT state.stats map (the save
// validator drops any non-number entry of the string->number field, so every
// value written here stays scalar). No engine calls, no clock calls — time
// arrives as caller-injected dt; no RNG, no config lookups.

import type { GameState } from "../state";

type StatsState = Partial<Pick<GameState, "stats">> | null | undefined;

export class Stats {
  // Canonical per-rarity pull-counter vocabulary. Mirrors the
  // Config.WAIFU_RARITIES key set; the drift guard lives in
  // tests/stats.test.ts so this module itself stays import-free.
  static RARITY_KEYS: Record<string, true> = {
    common: true,
    rare: true,
    epic: true,
    legendary: true,
  };

  // One paid click is one kill while monsters stay one-hit; a future
  // multi-hit monster must relocate the kills bump to the real death
  // transition.
  static record_click(state: StatsState, is_crit?: boolean): void {
    const s = state?.stats;
    if (!s) return;
    s.clicks = (s.clicks ?? 0) + 1;
    s.kills = (s.kills ?? 0) + 1;
    if (is_crit) {
      s.crits = (s.crits ?? 0) + 1;
    }
  }

  // pulls_total counts every successful roll; the named sibling key moves
  // only for a known ladder rarity. Unknown/nil/non-string arguments never
  // error and never mint a bogus key.
  static record_pull(state: StatsState, rarity: unknown): void {
    const s = state?.stats;
    if (!s) return;
    s.pulls_total = (s.pulls_total ?? 0) + 1;
    if (typeof rarity === "string" && Stats.RARITY_KEYS[rarity]) {
      const key = `pulls_${rarity}`;
      s[key] = (s[key] ?? 0) + 1;
    }
  }

  // One completed purchase (called after the level increment lands).
  static record_upgrade(state: StatsState): void {
    const s = state?.stats;
    if (!s) return;
    s.upgrades_bought = (s.upgrades_bought ?? 0) + 1;
  }

  // One completed rebirth (success branch only; the gain < 1 no-op never
  // reaches this).
  static record_rebirth(state: StatsState): void {
    const s = state?.stats;
    if (!s) return;
    s.rebirths = (s.rebirths ?? 0) + 1;
  }

  // Lifetime ACTIVE play time. dt is the caller-injected plain frame delta;
  // offline time never passes through here. A nil dt records nothing; a
  // zero dt adds nothing.
  static tick(state: StatsState, dt: number | null | undefined): void {
    const s = state?.stats;
    if (!s || dt == null) return;
    s.play_time = (s.play_time ?? 0) + dt;
  }
}

export default Stats;
