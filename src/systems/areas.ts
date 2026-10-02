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

export interface NodeFlags {
  coins: boolean;
  exp: boolean;
  chest: boolean;
}

export class Areas {
  // Definition lookup with a clamp so hand-built states never crash a draw.
  static def(index: number) {
    const i = Math.max(0, Math.min(index | 0, Config.AREAS.length - 1));
    return Config.AREAS[i];
  }

  // Node boundaries inside one area's kill target, PS99 strip order:
  // Coin pile at 1/3, EXP orb at 2/3, Treasure Chest with the milestone.
  static node_bounds(needed: number): [number, number] {
    return [Math.ceil(needed / 3), Math.ceil((needed * 2) / 3)];
  }

  // Which nodes are harvested at a given kill count (crossing-jump safe:
  // a loaded save already past a boundary reads as harvested, once).
  static node_flags(kills: number, needed: number): NodeFlags {
    const [b1, b2] = Areas.node_bounds(needed);
    const k = Math.max(0, kills | 0);
    return { coins: k >= b1, exp: k >= b2, chest: k >= needed };
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

  // Flat lifetime credit for a harvested node: gold touches the totals and
  // the since-rebirth counter like every other gain site; exp/tokens ride
  // their lifetime totals. No multipliers — the bursts are meant to feel
  // like flat, legible pickups between clicks.
  private static _credit(state: GameState, gold: number, exp: number, tokens: number): void {
    if (gold > 0) {
      state.gold = Math.max(0, (state.gold ?? 0) + gold);
      state.total_gold_earned = (state.total_gold_earned ?? 0) + gold;
      state.prestige_gold_since_rebirth = (state.prestige_gold_since_rebirth ?? 0) + gold;
    }
    if (exp > 0) {
      state.exp = Math.max(0, (state.exp ?? 0) + exp);
      state.total_exp_earned = (state.total_exp_earned ?? 0) + exp;
    }
    if (tokens > 0) {
      state.tokens = (state.tokens ?? 0) + tokens;
      state.total_tokens_earned = (state.total_tokens_earned ?? 0) + tokens;
    }
  }

  // One kill in. Kills count up to the area target; boundary kills only RIPE
  // the Coin pile / EXP orb pickups (tapped for their bursts via harvest),
  // and the milestone kill pays the Treasure Chest, advances the area (or
  // laps the final one) and resets the counter. The milestone also lifts
  // highest_area, the furthest unlocked area that travel walks back into;
  // cleared-area bonuses read highest_area, never the walked-back row.
  // Returns the toast line on an advance, null on a plain kill.
  static on_kill(state: GameState): string | null {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    const needed = Config.AREA_KILL_TARGETS[idx];
    const prev = Math.max(0, state.area_kills ?? 0);
    const k = Math.min(prev + 1, needed);
    state.area_kills = k;

    if (prev < needed && k >= needed) {
      Areas._credit(state, 0, 0, Config.AREA_NODE_TOKENS);
      Areas._reset_nodes(state);
      state.area_kills = 0;
      if (idx < Config.AREAS.length - 1) {
        state.area_index = idx + 1;
        state.highest_area = Math.max(state.highest_area ?? idx, idx + 1);
        return `Boss down! Now in: ${Config.AREAS[idx + 1].name}`;
      }
      return "Final boss down! The grind goes on.";
    }
    return null;
  }

  // Tap a ripe pickup for its one-time burst. Returns the toast line, or
  // null when the node is not ripe yet or was already harvested.
  static harvest(state: GameState, node: "coins" | "exp"): string | null {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    const needed = Config.AREA_KILL_TARGETS[idx];
    const flags = Areas.node_flags(state.area_kills ?? 0, needed);
    const done = state.area_nodes ?? {};
    if (!flags[node] || done[node]) return null;
    if (node === "coins") Areas._credit(state, Config.AREA_NODE_GOLD, 0, 0);
    else Areas._credit(state, 0, Config.AREA_NODE_EXP, 0);
    state.area_nodes = { ...done, [node]: true };
    return node === "coins"
      ? `Coin pile! +${Config.AREA_NODE_GOLD} gold`
      : `EXP orb! +${Config.AREA_NODE_EXP} exp`;
  }

  // Pickup nodes belong to the area they grew in: every move resets the
  // harvest flags so the fresh area starts with its own Coin/EXP pickups.
  private static _reset_nodes(state: GameState): void {
    state.area_nodes = {};
  }

  // Meter-full check for the boss aura/hint: the quota is met and the boss
  // click is pending.
  static boss_ready(state: Pick<GameState, "area_index" | "area_kills">): boolean {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    return Math.max(0, state.area_kills ?? 0) >= Config.AREA_KILL_TARGETS[idx];
  }

  // Hit points for the area's current monster: the number of base-click
  // chips the monster can take before the kill counts. Bosses ride the same
  // line — the aura ring and the click-it hint mark them, not extra HP.
  static monster_hp(state: Pick<GameState, "area_index" | "area_kills">): number {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREA_MONSTER_HP.length - 1));
    return Config.AREA_MONSTER_HP[idx];
  }

  // Walk the current position back and forth inside the unlocked ladder
  // (0..highest_area). Returns the arrived area name, or null when the walk
  // hit an edge and nothing moved. Kills keep counting in whatever area the
  // player is standing in; the milestone check in on_kill handles the rest.
  static travel(state: GameState, direction: number): string | null {
    const highest = Math.max(
      state.highest_area ?? state.area_index ?? 0,
      state.area_index ?? 0,
    );
    const from = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    const to = Math.max(0, Math.min(from + direction, highest));
    if (to === from) return null;
    state.area_index = to;
    state.area_kills = 0;
    Areas._reset_nodes(state);
    return Config.AREAS[to].name;
  }

  // Jump straight to an unlocked area (the area menu's chips). Same edge
  // semantics as travel(): clamped to 0..highest_area, kills reset on move,
  // null when nothing moved.
  static walk_to(state: GameState, target: number): string | null {
    const highest = Math.max(
      state.highest_area ?? state.area_index ?? 0,
      state.area_index ?? 0,
    );
    const to = Math.max(0, Math.min(target | 0, highest));
    const from = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    if (to === from) return null;
    state.area_index = to;
    state.area_kills = 0;
    Areas._reset_nodes(state);
    return Config.AREAS[to].name;
  }

  // Permanent gold multiplier: +AREA_GOLD_BONUS_PER_CLEAR per cleared area,
  // stacking with (not replacing) the prestige multiplier. Cleared count is
  // highest_area so walking back never shrinks the bonus.
  static gold_multiplier(state: GameState): number {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    const cleared = Math.max(0, Math.min(Math.max(state.highest_area ?? idx, idx), Config.AREAS.length - 1));
    return Math.round((1 + cleared * Config.AREA_GOLD_BONUS_PER_CLEAR) * 1000) / 1000;
  }

  // Background tint for the current area; falls back to the base BG color.
  static area_bg(state: GameState | null): readonly number[] {
    if (!state) return Config.BG_COLOR;
    return Areas.def(state.area_index ?? 0).bg;
  }
}

export default Areas;
