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
  gold: number;
  gold_target: number;
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

  // Node boundaries inside one area's gold target, PS99 strip order:
  // Coin pile at 1/3, EXP orb at 2/3, Treasure Chest with the full meter.
  static node_bounds(target: number): [number, number] {
    return [Math.ceil(target / 3), Math.ceil((target * 2) / 3)];
  }

  // Which nodes are ripe at a given in-area gold count (crossing-jump safe:
  // a loaded save already past a boundary reads as ripe, once).
  static node_flags(gold: number, target: number): NodeFlags {
    const [b1, b2] = Areas.node_bounds(target);
    const g = Math.max(0, gold | 0);
    return { coins: g >= b1, exp: g >= b2, chest: g >= target };
  }

  // Meter/readout tuple for the current area: gold earned in-area vs its
  // gold target. Kills ride along for quest/harvest rhythm readouts.
  static progress(state: GameState): AreaProgress {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    const def = Config.AREAS[idx];
    const gold = Math.max(0, state.area_gold ?? 0);
    const target = Config.AREA_GOLD_TARGETS[idx];
    return {
      index: idx,
      name: def.name,
      boss: def.boss,
      kills: Math.max(0, state.area_kills ?? 0),
      needed: Config.AREA_KILL_TARGETS[idx],
      gold,
      gold_target: target,
      progress: Math.max(0, Math.min(1, gold / target)),
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
      state.area_gold = Math.max(0, (state.area_gold ?? 0) + gold);
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

  // One kill in: counts toward harvest rhythm only. Area ADVANCEMENT is not
  // automatic — it happens when the player harvests a ripe Treasure Chest
  // (or walks via chevrons/menu). Returns null so existing click lanes stay
  // shaped the same.
  static on_kill(state: GameState): string | null {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    const needed = Config.AREA_KILL_TARGETS[idx];
    state.area_kills = Math.min(Math.max(0, state.area_kills ?? 0) + 1, needed);
    return null;
  }

  // Tap a ripe pickup for its one-time burst. The Chest additionally unlocks
  // the next area (highest_area lift) and laps the current one — moving on
  // itself stays the player's call via chevrons or the Areas menu. Returns
  // the toast line, or null when the node is not ripe yet or was harvested.
  static harvest(state: GameState, node: "coins" | "exp" | "chest"): string | null {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    const target = Config.AREA_GOLD_TARGETS[idx];
    const flags = Areas.node_flags(state.area_gold ?? 0, target);
    const done = state.area_nodes ?? {};
    if (!flags[node] || done[node]) return null;
    state.area_nodes = { ...done, [node]: true };
    if (node === "coins") {
      Areas._credit(state, Config.AREA_NODE_GOLD, 0, 0);
      return `Coin pile! +${Config.AREA_NODE_GOLD} gold`;
    }
    if (node === "exp") {
      Areas._credit(state, 0, Config.AREA_NODE_EXP, 0);
      return `EXP orb! +${Config.AREA_NODE_EXP} exp`;
    }
    Areas._credit(state, 0, 0, Config.AREA_NODE_TOKENS);
    if (idx < Config.AREAS.length - 1) {
      state.highest_area = Math.max(state.highest_area ?? idx, idx + 1);
    }
    state.area_gold = 0;
    state.area_kills = 0;
    state.area_gold = 0;
    Areas._reset_nodes(state);
    return `Treasure Chest! +${Config.AREA_NODE_TOKENS} tokens`;
  }

  // Pickup nodes belong to the area they grew in: every move resets the
  // harvest flags so the fresh area starts with its own Coin/EXP pickups.
  private static _reset_nodes(state: GameState): void {
    state.area_nodes = {};
  }

  // Full-meter check: the area's gold target is met and its Treasure Chest
  // is ready to harvest (which is what unlocks the next area).
  static next_ready(state: Pick<GameState, "area_index" | "area_gold">): boolean {
    const idx = Math.max(0, Math.min(state.area_index ?? 0, Config.AREAS.length - 1));
    return Math.max(0, state.area_gold ?? 0) >= Config.AREA_GOLD_TARGETS[idx];
  }

  // Hit points for the area's current monster: the number of base-click
  // chips the monster can take before the kill counts. Bosses ride the same
  // line — the name line and the click-it hint mark them, not extra HP.
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
    state.area_gold = 0;
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
    state.area_gold = 0;
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
