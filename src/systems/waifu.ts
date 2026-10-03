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

// Area hires: Open Plan, Break Room, Conference Room, Copy Room.
const DAVE_FIRST_PULL_LINES: readonly string[] = [
  "I fixed your printer. It was never broken. You just could not.",
  "Ticket 412: 'screen is black'. Sir, that is called sleep mode.",
  "I have a cable for that. I also have opinions about your cable management.",
];

const DAVE_PERIODIC_LINES: readonly string[] = [
  "Have you tried turning the synergy off and back on again?",
  "Your Wi-Fi is fine. Your choices are what is questionable.",
  "I speak fluent IT and mild disappointment.",
  "The break room projector needs a HDMI hug. I'll be there all lunch.",
];

const PRIYA_FIRST_PULL_LINES: readonly string[] = [
  "Your bonus arrived before the quarter ended. You're welcome.",
  "I do two things: payroll and knowing exactly who left the lights on.",
  "Direct deposit, direct honesty. That is my whole brand.",
];

const PRIYA_PERIODIC_LINES: readonly string[] = [
  "Your timesheet was perfect today. Did it feel weird? It should.",
  "A raise is just a number with a feeling attached. I attach both.",
  "The budget says maybe. The budget always says maybe.",
  "Someone bought a stapler on the company card. I know who. I always know.",
];

const TINA_FIRST_PULL_LINES: readonly string[] = [
  "Three departments, two phones, one laminated planner. Let's go.",
  "I was briefed at 8, promoted at 9, and by 10 I ran this floor.",
  "Temp does not mean temporary. It means inevitable.",
];

const TINA_PERIODIC_LINES: readonly string[] = [
  "I covered your meeting, your lunch and your personality today.",
  "The front desk is a state of mind. I am it.",
  "Out of coffee since Tuesday. Still winning.",
  "Ask me anything. I already answered it for someone else.",
];

const GUS_FIRST_PULL_LINES: readonly string[] = [
  "It is 21 degrees. That number is load-bearing.",
  "I don't fix thermostats. I set them once, correctly, forever.",
  "The chair stacks are a monument. I built them. Respect them.",
];

const GUS_PERIODIC_LINES: readonly string[] = [
  "Someone propped the fire door again. I felt it in my knees.",
  "The bulbs in the Copy Room are changed. They will need it again.",
  "A wobbly table is a failed performance review, said no one, ever.",
  "Laminating is calming. Laminate something today.",
];

// Wave-two hires: the second cohort joining later-area pools.
const MAYA_FIRST_PULL_LINES: readonly string[] = [
  "Your stand-up was 40 minutes. I cut it to four. You felt loss and growth.",
  "I was isekai'd mid-retrospective. The action items followed me here.",
  "Ceremony is not optional. Even the goblin in row three attends.",
];

const MAYA_PERIODIC_LINES: readonly string[] = [
  "Blockers? Name one. I'll make it a story point.",
  "That click was a commitment. Honor it.",
  "Your board needs more green squares and fewer feelings.",
  "Sprint review is now. Yes, this is the review.",
];

const ROSA_FIRST_PULL_LINES: readonly string[] = [
  "Two shots in everything. Gacha results included.",
  "I was isekai'd by an espresso machine. We both woke up improved.",
  "The break room runs on me. The rest of you just show up.",
];

const ROSA_PERIODIC_LINES: readonly string[] = [
  "Your mug is empty. That is a leadership problem.",
  "Decaf is a rumor. I have stamped it out.",
  "The line outside is your roster. They respect the craft.",
  "Oat, almond, or none. The last one is a choice, not a preference.",
];

const CARL_FIRST_PULL_LINES: readonly string[] = [
  "Night shift. Quiet building. Everything gets done.",
  "I was isekai'd through a mop bucket and landed somewhere cleaner.",
  "You will call me when the ceiling leaks. You always do.",
];

const CARL_PERIODIC_LINES: readonly string[] = [
  "Spilled coffee at eight. Mopped at 7:58. Time is a service.",
  "The vending machine answers to me. It always has.",
  "Keys go on the ring. Feelings go in the drawer. Order holds.",
  "The Copy Room has a caddy of spare toner. You are welcome.",
];

const DIAZ_FIRST_PULL_LINES: readonly string[] = [
  "The budget passed on the first read. This is what competent looks like.",
  "I was isekai'd from a council session that actually accomplished something.",
  "Three committees, zero sub-committees. That is the whole platform.",
];

const DIAZ_PERIODIC_LINES: readonly string[] = [
  "The meeting ended on schedule. Write that down somewhere.",
  "Your idle rate is fine. My budget surplus is also fine. Coincidence.",
  "No ribbon cutting. Just done.",
  "Everyone else is in a loop. I am on my second loop.",
];

const ANA_FIRST_PULL_LINES: readonly string[] = [
  "Your inbox says 'urgent.' I have already triaged both.",
  "I was isekai'd on the way to a briefing. The briefing is still coming.",
  "A chief of staff is just a hero with a calendar. Same load-bearing role.",
];

const ANA_PERIODIC_LINES: readonly string[] = [
  "You asked for a summary of your summary. Attached. Done already.",
  "The crisis list is one line long. That was me.",
  "Coffee runs and hard deadlines: both are my lane.",
  "You have 4 minutes between pulls. Use two.",
];

const HANK_FIRST_PULL_LINES: readonly string[] = [
  "The truck that isekai'd your hero? Mine. I drive every one.",
  "I do not fade out in an intersection. I deliver on time.",
  "Every realm has a loading dock. I know where all of them are.",
];

const HANK_PERIODIC_LINES: readonly string[] = [
  "Four hundred miles before your first coffee. Then the gacha runs.",
  "The manifest says legendary. The manifest is usually right.",
  "Diesel, not decaf. That is the whole philosophy.",
  "Next drop lands after your next pity timer. Always does.",
];

const ELAINE_FIRST_PULL_LINES: readonly string[] = [
  "The night shift runs this building. You just sleep in it.",
  "I was isekai'd through a lobby at 2am and took over at once.",
  "Ask me a question tomorrow. It was already answered tonight.",
];

const ELAINE_PERIODIC_LINES: readonly string[] = [
  "The 3am crisis was handled. You woke up in a better building.",
  "Quiet hours mean the printers rest, not the standards.",
  "Every after-hours gain stacks. That is how the tower got built.",
  "You are on the morning report for clicking before sunrise. Approved.",
];

const BOB_FIRST_PULL_LINES: readonly string[] = [
  "They promised me exposure. I got a chair, a stapler, and momentum.",
  "The intern is the last one who still reads the wiki. I am the wiki.",
  "I fixed the broken link in your footer. You never noticed. Perfect.",
];

const BOB_PERIODIC_LINES: readonly string[] = [
  "The spreadsheet is color coded by feeling. It holds.",
  "I made the coffee that the coffee was pretending to be.",
  "Exposure is a currency. I am investing.",
  "Permanent hire. Same chair. Bigger stapler.",
];

const WAIFU_FIRST_PULL_POOL: Record<string, readonly string[]> = {
  "Karen the Accountant": KAREN_FIRST_PULL_LINES,
  "Steve the HR Rep": STEVE_FIRST_PULL_LINES,
  "Linda the Middle Manager": LINDA_FIRST_PULL_LINES,
  "Dave from IT": DAVE_FIRST_PULL_LINES,
  "Priya from Payroll": PRIYA_FIRST_PULL_LINES,
  "Tina from Temp Agencies": TINA_FIRST_PULL_LINES,
  "Gus from Facilities": GUS_FIRST_PULL_LINES,
  "Maya the Scrum Coach": MAYA_FIRST_PULL_LINES,
  "Rosa the Barista": ROSA_FIRST_PULL_LINES,
  "Carl the Janitor": CARL_FIRST_PULL_LINES,
  "Councilwoman Diaz": DIAZ_FIRST_PULL_LINES,
  "Chief of Staff Ana": ANA_FIRST_PULL_LINES,
  "Hank the Truck Driver": HANK_FIRST_PULL_LINES,
  "Elaine the Night Manager": ELAINE_FIRST_PULL_LINES,
  "Bob the Intern": BOB_FIRST_PULL_LINES,
};

const WAIFU_PERIODIC_POOL: Record<string, readonly string[]> = {
  "Karen the Accountant": KAREN_PERIODIC_LINES,
  "Steve the HR Rep": STEVE_PERIODIC_LINES,
  "Linda the Middle Manager": LINDA_PERIODIC_LINES,
  "Dave from IT": DAVE_PERIODIC_LINES,
  "Priya from Payroll": PRIYA_PERIODIC_LINES,
  "Tina from Temp Agencies": TINA_PERIODIC_LINES,
  "Gus from Facilities": GUS_PERIODIC_LINES,
  "Maya the Scrum Coach": MAYA_PERIODIC_LINES,
  "Rosa the Barista": ROSA_PERIODIC_LINES,
  "Carl the Janitor": CARL_PERIODIC_LINES,
  "Councilwoman Diaz": DIAZ_PERIODIC_LINES,
  "Chief of Staff Ana": ANA_PERIODIC_LINES,
  "Hank the Truck Driver": HANK_PERIODIC_LINES,
  "Elaine the Night Manager": ELAINE_PERIODIC_LINES,
  "Bob the Intern": BOB_PERIODIC_LINES,
};

// PS99 enchant decay: same-type bonuses weigh Config.BONUS_SLOT_DECAY in
// descending order of size; past the configured curve the last weight repeats.
function decayed_sum(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  const curve = Config.BONUS_SLOT_DECAY;
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    total += sorted[i] * curve[Math.min(i, curve.length - 1)];
  }
  return Math.round(total * 1000) / 1000;
}

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

  // The hires assigned to the CURRENT area (PS99 pet-bag model: crews are
  // stationed per place). An empty lane means "auto": the top EQUIP_SLOTS
  // instances by bonus_value are active, which keeps legacy saves and fresh
  // states behaving like the old always-sum roster until the player starts
  // choosing. Otherwise every roster copy of an assigned name counts
  // (duplicate stacks keep stacking additively).
  effective_assigned(
    state: Pick<GameState, "waifus" | "assignments" | "area_index">,
  ): WaifuInstance[] {
    const roster = state.waifus ?? [];
    const names = state.assignments?.[state.area_index ?? 0] ?? [];
    if (names.length === 0) {
      return [...roster]
        .sort((a, b) => (b.bonus_value ?? 0) - (a.bonus_value ?? 0))
        .slice(0, Config.EQUIP_SLOTS);
    }
    return roster.filter((w) => names.includes(w.name));
  }

  // Tap-to-assign from the detail overlay: toggles the name in the CURRENT
  // area's bucket and evicts oldest-first beyond EQUIP_SLOTS. Returns the
  // post-toggle lane.
  toggle_assign(
    state: Pick<GameState, "assignments" | "area_index">,
    name: string,
  ): string[] {
    const area = state.area_index ?? 0;
    const lanes = { ...(state.assignments ?? {}) };
    const lane = [...(lanes[area] ?? [])];
    const i = lane.indexOf(name);
    if (i >= 0) lane.splice(i, 1);
    else lane.push(name);
    while (lane.length > Config.EQUIP_SLOTS) lane.shift();
    lanes[area] = lane;
    state.assignments = lanes;
    return lane;
  }

  // Consumed by other modules as a [tokenMult, goldMult, expMult] tuple:
  // the bonuses of the ASSIGNED hires summed per bonus_type with the PS99
  // enchant decay curve — biggest copy full strength, next copies weigh
  // 60% / 38% — so a mixed trio beats three of one type. Missing
  // bonus_value guarded to 0.
  get_bonus_multiplier(
    state: Pick<GameState, "waifus" | "assignments" | "area_index">,
  ): [number, number, number] {
    const by_type: Record<string, number[]> = { tokens: [], gold: [], exp: [] };
    for (const w of this.effective_assigned(state)) {
      const lane = by_type[w.bonus_type];
      if (lane) lane.push(w.bonus_value ?? 0);
    }
    return [
      decayed_sum(by_type.tokens),
      decayed_sum(by_type.gold),
      decayed_sum(by_type.exp),
    ];
  }

  // Duplicate fusion (PS99 fused-pet tier): same-name copies roll into ONE
  // instance one rarity ladder step up. The best copy's bonus is the base,
  // rescaled by the tier ratio of the new rarity; legendary copies just keep
  // the highest bonus. Needs FUSE_MIN_COPIES copies; returns null otherwise.
  fuse(
    state: Pick<GameState, "waifus">,
    name: string,
  ): WaifuInstance | null {
    const roster = state.waifus ?? [];
    const copies = roster.filter((w) => w && w.name === name);
    if (copies.length < Config.FUSE_MIN_COPIES) return null;
    const best = copies.reduce((a, b) =>
      (b.bonus_value ?? 0) > (a.bonus_value ?? 0) ? b : a,
    );
    const ladder = Config.WAIFU_RARITIES;
    const at = ladder.findIndex((r) => r.key === best.rarity);
    const next = ladder[Math.min(at + 1, ladder.length - 1)] ?? ladder[0];
    const cur = Config.WAIFU_RARITY_BY_KEY[best.rarity];
    const ratio = cur && cur.bonus_mult ? next.bonus_mult / cur.bonus_mult : 1;
    const scaled = (best.bonus_value ?? 0) * ratio;
    const fused: WaifuInstance = {
      name: best.name,
      bonus_type: best.bonus_type,
      bonus_value: Math.floor(scaled * 1000 + 0.5) / 1000,
      rarity: next.key,
    };
    // Collapse every copy into the fused instance at the FIRST copy's slot
    // so the roster order (and the roster grid) stays stable.
    const kept: WaifuInstance[] = [];
    let inserted = false;
    for (const w of roster) {
      if (w && w.name === name) {
        if (!inserted) {
          kept.push(fused);
          inserted = true;
        }
        continue;
      }
      kept.push(w);
    }
    if (!inserted) kept.push(fused);
    state.waifus = kept;
    return fused;
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
