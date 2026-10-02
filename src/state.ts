// src/state.ts
// Single game state factory — source of truth for all systems.

export interface WaifuInstance {
  name: string;
  bonus_type: string;
  bonus_value: number;
  rarity: string;
}

export interface GameState {
  gold: number;
  exp: number;
  tokens: number;
  pity_counter: number;
  waifus: WaifuInstance[];
  upgrades: Record<string, number>;
  // Lifetime counters. MUST stay a FLAT {name -> number} map: the save
  // validator drops any entry whose value is not a number.
  stats: Record<string, number>;
  last_save_time: number;
  passive_unlocked: boolean;
  // Daily login streak. Day index is UTC floor(now/86400).
  last_login_day: number;
  login_streak: number;
  total_gold_earned: number;
  total_exp_earned: number;
  total_tokens_earned: number;
  session_clicks: number;
  session_crits: number;
  session_start_time: number;
  exp_thresholds_unlocked: Record<string, true>;
  // Unlocked achievement ids, keyed by stable id, values pinned to true.
  achievements: Record<string, true>;
  // Prestige/rebirth. points/rebirths survive rebirth; the since-rebirth
  // counter is zeroed by Prestige.rebirth.
  prestige_points: number;
  prestige_rebirths: number;
  prestige_gold_since_rebirth: number;
  // Areas ladder: current area index + kills inside it (lifetime, survive rebirth).
  area_index: number;
  area_kills: number;
  // Furthest area ever reached; travel chevrons move area_index within it.
  highest_area: number;
  // Per-area hire assignments: area index -> names of the hires on the clock
  // there (max Config.EQUIP_SLOTS per area, PS99 pet-bag model). Only the
  // CURRENT area's lane pays bonuses and lands automatic kills. An empty lane
  // means "auto": the top bonus_value instances are active.
  assignments?: Record<number, string[]>;
  // Harvested PS99-style node pickups in the CURRENT area (reset on travel).
  area_nodes?: { coins?: true; exp?: true };
  // Session-only artifacts (never persisted).
  offline_report: Record<string, number | string> | null;
  login_report: Record<string, number | string> | null;
  save_warning: string | null;
}

export function createState(nowSeconds?: number): GameState {
  return {
    gold: 0,
    exp: 0,
    tokens: 0,
    pity_counter: 0,
    waifus: [],
    upgrades: {
      click_multiplier: 0,
      idle_rate: 0,
      gold_multiplier: 0,
      exp_multiplier: 0,
      crit_chance: 0,
    },
    stats: { badge_reward_gold: 0, badge_reward_tokens: 0 },
    last_save_time: 0,
    passive_unlocked: false,
    last_login_day: 0,
    login_streak: 0,
    total_gold_earned: 0,
    total_exp_earned: 0,
    total_tokens_earned: 0,
    session_clicks: 0,
    session_crits: 0,
    session_start_time: nowSeconds ?? Math.floor(Date.now() / 1000),
    exp_thresholds_unlocked: {},
    achievements: {},
    prestige_points: 0,
    prestige_rebirths: 0,
    prestige_gold_since_rebirth: 0,
    area_index: 0,
    area_kills: 0,
    highest_area: 0,
    assignments: {},
    area_nodes: {},
    offline_report: null,
    login_report: null,
    save_warning: null,
  };
}

export default createState;
