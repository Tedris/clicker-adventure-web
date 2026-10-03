// src/systems/passive.ts
// Passive resource generation system: awards resources per second without clicking

import Config from "../config";
import type { GameState } from "../state";
import Areas from "./areas";
import Mastery from "./mastery";
import Prestige from "./prestige";

export interface UpgradesLike {
  get_passive_multiplier(): number;
}

export interface WaifuLike {
  get_bonus_multiplier(state: GameState): [number, number, number];
}

export class Passive {
  upgrades: UpgradesLike | null;
  waifu: WaifuLike | null;
  timer: number;
  base_gold_rate: number;
  base_exp_rate: number;
  base_token_rate: number;

  constructor(upgrades?: UpgradesLike | null, waifu?: WaifuLike | null) {
    this.upgrades = upgrades ?? null;
    this.waifu = waifu ?? null;

    this.timer = 0;
    this.base_gold_rate = Config.PASSIVE_GOLD_RATE;
    this.base_exp_rate = Config.PASSIVE_EXP_RATE;
    this.base_token_rate = Config.PASSIVE_TOKEN_RATE;

    console.log(
      `[INFO] [PASSIVE] Module loaded (gold=${this.base_gold_rate}/s, exp=${this.base_exp_rate}/s, tokens=${this.base_token_rate}/s)`
    );
  }

  update(dt: number, state: GameState): void {
    if (!state) {
      throw new Error("State must be provided");
    }

    if (!state.passive_unlocked) {
      return;
    }

    this.timer = this.timer + dt;
    if (this.timer >= 1.0) {
      const ticks = Math.floor(this.timer);
      for (let i = 0; i < ticks; i++) {
        this.apply_passive_rewards(state);
      }
      this.timer = this.timer - ticks;
    }
  }

  apply_passive_rewards(state: GameState): void {
    let idle_mult = 1;
    if (this.upgrades && typeof this.upgrades.get_passive_multiplier === "function") {
      // Mirror of Lua's pcall + type()=="number" guard: a legitimate numeric 0
      // multiplier is honored while a thrown error falls back to the default 1.
      try {
        const mult = this.upgrades.get_passive_multiplier();
        if (typeof mult === "number") {
          idle_mult = mult;
        }
      } catch {
        // fall back to idle_mult = 1
      }
    }

    let token_mult = 0;
    let gold_mult = 0;
    let exp_mult = 0;
    if (this.waifu) {
      [token_mult, gold_mult, exp_mult] = this.waifu.get_bonus_multiplier(state);
    }

    // D-02 (PREST-01): prestige multiplier amplifies gold ONLY; exp/tokens stay
    // on the pre-prestige line. Derived live from prestige_points, never stored.
    // The areas ladder adds its cleared-area gold multiplier on top.
    const prestige_mult = Prestige.gold_multiplier(state);
    const area_mult = Areas.gold_multiplier(state);
    const mastery_mult = Mastery.gold_multiplier(state);
    const tokens_earned = this.base_token_rate * (1 + token_mult);
    const gold_earned = this.base_gold_rate * idle_mult * (1 + gold_mult) * prestige_mult * area_mult * mastery_mult;
    const exp_earned = this.base_exp_rate * idle_mult * (1 + exp_mult);

    state.gold = (state.gold ?? 0) + gold_earned;
    state.exp = (state.exp ?? 0) + exp_earned;
    state.tokens = (state.tokens ?? 0) + tokens_earned;

    state.total_gold_earned = (state.total_gold_earned ?? 0) + gold_earned;
    state.prestige_gold_since_rebirth =
      (state.prestige_gold_since_rebirth ?? 0) + gold_earned;
    state.total_exp_earned = (state.total_exp_earned ?? 0) + exp_earned;
    state.total_tokens_earned = (state.total_tokens_earned ?? 0) + tokens_earned;

    if (Config.DEBUG_MODE) {
      console.log(
        `[DEBUG] [PASSIVE] Passive tick: +${gold_earned} gold, +${exp_earned} exp, +${tokens_earned} tokens (token_mult=${token_mult}, gold_mult=${gold_mult}, exp_mult=${exp_mult})`
      );
    }
  }

  draw(): void {
    // No drawing needed; UI handles display
  }
}

export default Passive;
