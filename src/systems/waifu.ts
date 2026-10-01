// src/systems/waifu.ts
// Waifu system: animation states, humor lines, per-waifu bonus calculation.

import Config from "../config";
import type { GameState, WaifuInstance } from "../state";

// RNG seam mirroring Lua's math.random (see gacha.ts): no-arg -> [0,1),
// with max -> integer 1..max. Tests inject stubs for determinism.
export type RandomFn = (max?: number) => number;

function defaultRandom(max?: number): number {
  if (max === undefined) return Math.random();
  return Math.floor(Math.random() * max) + 1;
}

// Karen's humor line pools
const KAREN_FIRST_PULL_LINES: readonly string[] = [
  "I was isekai'd because my Excel macros were too powerful for this dimension.",
  "My cheat skill is 'understanding Q4 projections.' Please don't make me use it.",
  "They told me this was a 'relaxing idle game.' I see no spreadsheets.",
  "I spent 200 pulls for this? My billable hours would have covered it.",
  "Welcome to the roster. I'll start auditing your gold immediately.",
];

const KAREN_PERIODIC_LINES: readonly string[] = [
  "Have you filed your tax forms today?",
  "This clicker would make an excellent spreadsheet.",
  "I've calculated your optimal farming route. It involves more clicking.",
  "The passive income on this game is... adequate. Not compliant.",
  "I once audited a slime. It cried. The slime cried.",
  "Your token generation is below industry average. I'll send a memo.",
  "I miss the days when 'gacha' was just a type of sushi.",
  "If this were a real office, you'd be in a performance review right now.",
  "I've optimized your idle rate by 0.3%. You're welcome.",
  "The paperclips in the summoning circle are recycled. Sustainability matters.",
];

// Steve's humor line pools
const STEVE_FIRST_PULL_LINES: readonly string[] = [
  "I was isekai'd because my performance reviews were too aggressive.",
  "My clipboard isn't for show. It tracks EVERYTHING.",
  "I don't do 'team building.' I do 'team evaluating.'",
  "They said 'bring your sword to the meeting.' I brought a PIP form instead.",
  "Welcome to your quarterly review. Spoiler: you're doing great.",
];

const STEVE_PERIODIC_LINES: readonly string[] = [
  "Your KPIs are looking... adequate.",
  "Have you filled out your self-assessment form today?",
  "I'd offer feedback but HR policy says I can't.",
  "That click rate is below the departmental average.",
  "Remember: all idle time must be logged in the timesheet system.",
  "The gacha system needs a compliance audit. Just saying.",
  "Your waifu collection is noted for the annual review.",
  "I've scheduled a follow-up meeting about your pull habits.",
];

// Linda's humor line pools
const LINDA_FIRST_PULL_LINES: readonly string[] = [
  "I was isekai'd because my synergy maps could align any department. Even this one.",
  "My title is 'Middle Manager' but my skill is 'making everyone feel included in meetings.'",
  "I don't slay monsters. I realign their value propositions.",
  "They told me this world lacked 'strategic vision.' I brought three org charts.",
  "Welcome. Let's circle back to your progression strategy.",
];

const LINDA_PERIODIC_LINES: readonly string[] = [
  "Let's take this offline. And also online. Both.",
  "I've flagged your EXP gain for a mid-quarter check-in.",
  "This idle rate needs a cross-functional alignment.",
  "Have you leveraged your synergy yet?",
  "I believe in your potential. Documented and filed.",
  "The monster pool could use a restructuring. Just a thought.",
  "Your click cadence lacks executive visibility.",
  "Remember: EXP growth is a team sport. Even if the team is one person.",
];

const WAIFU_FIRST_PULL_POOL: Record<string, readonly string[]> = {
  "Karen the Accountant": KAREN_FIRST_PULL_LINES,
  "Steve the HR Rep": STEVE_FIRST_PULL_LINES,
  "Linda the Middle Manager": LINDA_FIRST_PULL_LINES,
};

const WAIFU_PERIODIC_POOL: Record<string, readonly string[]> = {
  "Karen the Accountant": KAREN_PERIODIC_LINES,
  "Steve the HR Rep": STEVE_PERIODIC_LINES,
  "Linda the Middle Manager": LINDA_PERIODIC_LINES,
};

export class Waifu {
  animation_timer = 0;
  animation_state = "idle";
  humor_timer = 0;
  next_humor_interval: number;
  first_pull_shown = false;
  current_waifu: { name: string } | null = null;
  private random: RandomFn;

  constructor(random: RandomFn = defaultRandom) {
    this.random = random;
    this.next_humor_interval = 30 + random() * 30;
    console.log("[INFO] [WAIFU] Module loaded");
  }

  set_waifu(waifu_data: { name: string } | null): void {
    this.current_waifu = waifu_data;
  }

  get_animation_state(_waifu_data?: WaifuInstance | null): string {
    return "idle";
  }

  set_animation_state(state: string): void {
    this.animation_state = state;
    this.animation_timer = 0;
  }

  update(dt: number): void {
    this.animation_timer = this.animation_timer + dt;
    this.humor_timer = this.humor_timer + dt;
  }

  get_state_color(): readonly number[] {
    if (this.animation_state === "happy") return Config.WAIFU_HAPPY_COLOR;
    if (this.animation_state === "disappointed") {
      return Config.WAIFU_DISAPPOINTED_COLOR;
    }
    if (this.animation_state === "reaction") return Config.WAIFU_REACTION_COLOR;
    return Config.WAIFU_IDLE_COLOR;
  }

  get_state_label(): string {
    if (this.animation_state === "happy") return "Karen (happy~)";
    if (this.animation_state === "disappointed") return "Karen (sigh...)";
    if (this.animation_state === "reaction") return "Karen (ooh!)";
    return "Karen (idle)";
  }

  check_humor_trigger(_total_time?: number): boolean {
    if (this.humor_timer >= this.next_humor_interval) {
      this.humor_timer = 0;
      this.next_humor_interval = 30 + this.random() * 30;
      return true;
    }
    return false;
  }

  get_random_humor_line(pool: readonly string[] | null | undefined): string | null {
    if (!pool || pool.length === 0) return null;
    return pool[this.random(pool.length) - 1];
  }

  // Consumed by other modules as a [tokenMult, goldMult, expMult] tuple:
  // the per-waifu bonuses summed per bonus_type, missing bonus_value
  // guarded to 0.
  get_bonus_multiplier(state: Pick<GameState, "waifus">): [number, number, number] {
    let token_mult = 0;
    let gold_mult = 0;
    let exp_mult = 0;
    for (const w of state.waifus ?? []) {
      if (w.bonus_type === "tokens") token_mult += w.bonus_value ?? 0;
      else if (w.bonus_type === "gold") gold_mult += w.bonus_value ?? 0;
      else if (w.bonus_type === "exp") exp_mult += w.bonus_value ?? 0;
    }
    return [token_mult, gold_mult, exp_mult];
  }

  get_first_pull_line(): string | null {
    if (!this.current_waifu || !this.current_waifu.name) return null;
    const pool = WAIFU_FIRST_PULL_POOL[this.current_waifu.name];
    if (!pool || pool.length === 0) return null;
    return pool[this.random(pool.length) - 1];
  }

  get_periodic_line(): string | null {
    if (!this.current_waifu || !this.current_waifu.name) return null;
    const pool = WAIFU_PERIODIC_POOL[this.current_waifu.name];
    if (!pool || pool.length === 0) return null;
    return pool[this.random(pool.length) - 1];
  }
}

export default Waifu;
