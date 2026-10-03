// src/systems/mastery.ts
// Mastery-by-doing (PS99 shape): each tracked lifetime stat climbs its own
// threshold ladder simply by the thing being done. Like prestige points the
// result is DERIVED from the flat stats map at every read site, never stored.

import Config from "../config";
import type { GameState } from "../state";

type MasteryState = Partial<Pick<GameState, "stats" | "prestige_rebirths">>;

export class Mastery {
  // Mastery level for one track: how many thresholds its counter has passed.
  // Missing stats and missing states read as 0 levels.
  static level(state: MasteryState, key: string): number {
    const value = state?.stats?.[key] ?? 0;
    let level = 0;
    for (const threshold of Config.MASTERY_THRESHOLDS) {
      if (value >= threshold) level = level + 1;
    }
    return level;
  }

  // Sum of every tracked ladder — the mastery total behind both multipliers.
  static total_levels(state: MasteryState): number {
    let total = 0;
    for (const key of Config.MASTERY_TRACKS) total = total + Mastery.level(state, key);
    return total;
  }

  // Gold-only mastery multiplier, derived live (same pattern as prestige).
  static gold_multiplier(state: MasteryState): number {
    return 1 + Config.MASTERY_GOLD_PER_LEVEL * Mastery.total_levels(state);
  }

  // Luck multiplier for the gacha odds (PS99 gamepass shape, earn-only):
  // each named buff unlocks at its rebirth tier and MULTIPLIES in, so the
  // high-end ladder feels like a premium bundle bought with time instead of
  // money. Mastery levels contribute a smaller additive share on top.
  // Applied as a bump on the pull probability; pity stays independent.
  static luck_multiplier(state: MasteryState): number {
    const rebirths = Math.max(0, state?.prestige_rebirths ?? 0);
    let mult = 1;
    for (const buff of Config.LUCK_BUFFS) {
      if (rebirths >= buff.rebirths) mult = mult * buff.mult;
    }
    return mult * (1 + Config.LUCK_PER_MASTERY_LEVEL * Mastery.total_levels(state));
  }

  // Highest unlocked buff, for UI lines like "Career Coach x1.25".
  static luck_buffs(state: MasteryState): typeof Config.LUCK_BUFFS {
    const rebirths = Math.max(0, state?.prestige_rebirths ?? 0);
    return Config.LUCK_BUFFS.filter((b) => rebirths >= b.rebirths);
  }
}

export default Mastery;
