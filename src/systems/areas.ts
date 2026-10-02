// src/systems/areas.ts
// Areas ladder (Clicker Heroes zone model): numbered office areas, each with
// a per-area kill target ending in a named milestone boss. The milestone kill
// advances the area, resets in-area kills and pays a permanent gold bonus on
// top of prestige. Pure logic: reads/writes only flat state numbers, so the
// save validator's flat-map contract holds.

import Config from "../config";
import type { GameState } from "../state";

export interface AreaProgress {
  index: number;
  name: string;
  boss: string;
  kills: number;
  needed: number;
  progress: number;
}

export class Areas {
  // Definition lookup with a clamp so hand-built states never crash a draw.
  static def(index: number) {
    const i = Math.max(0, Math.min(index | 0, Config.AREAS.length - 1));
    return Config.AREAS[i];
  }

  // Meter/readout tuple for the current area: kills-in-area vs the target.
  static progress(state: GameState): AreaProgress {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    const def = Config.AREAS[idx];
    const needed = Config.AREA_KILL_TARGETS[idx];
    const kills = Math.max(0, state.area_kills ?? 0);
    return {
      index: idx,
      name: def.name,
      boss: def.boss,
      kills,
      needed,
      progress: Math.max(0, Math.min(1, kills / needed)),
    };
  }

  // One kill in. Returns a toast line when the milestone kill advanced the
  // area (boss defeated), or null on a plain kill.
  static on_kill(state: GameState): string | null {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    state.area_kills = (state.area_kills ?? 0) + 1;
    const needed = Config.AREA_KILL_TARGETS[idx];
    if (state.area_kills >= needed && idx < Config.AREAS.length - 1) {
      state.area_index = idx + 1;
      state.area_kills = 0;
      return `Area cleared! Now in: ${Config.AREAS[idx + 1].name}`;
    }
    return null;
  }

  // Permanent gold multiplier: +AREA_GOLD_BONUS_PER_CLEAR per cleared area,
  // stacking with (not replacing) the prestige multiplier.
  static gold_multiplier(state: GameState): number {
    const cleared = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    return Math.round((1 + cleared * Config.AREA_GOLD_BONUS_PER_CLEAR) * 1000) / 1000;
  }

  // Background tint for the current area; falls back to the base BG color.
  static area_bg(state: GameState | null): readonly number[] {
    if (!state) return Config.BG_COLOR;
    return Areas.def(state.area_index ?? 0).bg;
  }
}

export default Areas;
