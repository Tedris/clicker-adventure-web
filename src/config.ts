// src/config.ts
// All constants and balancing values, ported from the LÖVE2D project's src/config.lua.

export interface Rarity {
  key: string;
  name: string;
  stars: string;
  weight: number;
  bonus_mult: number;
  color: readonly [number, number, number, number];
}

export const Config = {
  // Game viewport (design size; layout clamps down to LAYOUT_MIN_*)
  WINDOW_WIDTH: 800,
  WINDOW_HEIGHT: 600,
  DEBUG_MODE: false,
  FONT_SIZE: 11,

  // Number display (K/M/B... suffix ladder, powers of 1000 from K upward).
  NUMBER_SUFFIXES: ["K", "M", "B", "T", "Qa", "Qi"],

  // Click mechanics
  BASE_CLICK_VALUE: 1,
  EXP_PER_CLICK: 1,
  CRIT_CHANCE: 5, // base percent; Crit Chance upgrade adds +2%/level on top
  CRIT_MULTIPLIER: 2,
  TOKEN_PER_CLICK: 1,

  // Monster
  MONSTER_SIZE: 32,
  SPRITE_PIXEL_SIZE: 16,
  MONSTER_IDLE_AMPLITUDE: 4,
  MONSTER_IDLE_CYCLE: 1.0,
  MONSTER_FADE_DURATION: 0.3,
  // Clicks landing during the death-fade window are queued and paid on respawn.
  CLICK_BUFFER_CAPACITY: 2,
  MONSTER_COMPRESS_DURATION: 0.1,
  MONSTER_REBOUND_DURATION: 0.2,
  HUMOR_BUBBLE_LIFETIME: 3.0,

  // Crit effects
  CRIT_FLASH_DURATION: 0.15,
  SCREEN_SHAKE_DURATION: 0.05,
  SCREEN_SHAKE_AMOUNT: 2,
  SCREEN_SHAKE_FRAMES: 3,

  // Number pops
  POP_NORMAL_LIFE: 0.8,
  POP_CRIT_LIFE: 1.0,
  POP_NORMAL_FLOAT: 40,
  POP_CRIT_FLOAT: 60,
  POP_GAP: 4,
  POP_NORMAL_SIZE: 12,
  POP_CRIT_SIZE: 16,
  POP_COLOR_GOLD: [255, 200, 50, 255],
  POP_COLOR_EXP: [50, 200, 255, 255],
  POP_COLOR_TOKEN: [26, 188, 156, 255],
  POP_COLOR_CRIT_GOLD: [255, 215, 0, 255],
  POP_COLOR_WHITE: [255, 255, 255, 255],
  POP_TOKEN_LIFE: 0.6,
  POP_TOKEN_FLOAT: 30,
  POP_TOKEN_SIZE: 10,

  // Passive generation (Phase B rebalance: rates raised so idle income is a
  // meaningful pillar by ~10 min).
  PASSIVE_GOLD_RATE: 4,
  PASSIVE_EXP_RATE: 1,
  PASSIVE_TOKEN_RATE: 1,
  PASSIVE_UNLOCK_COST: 50,

  OFFLINE_TOKEN_CAP_SECONDS: 28800,
  OFFLINE_SKIP_SECONDS: 60,

  // Cold-boot combined boot-reward cap, in units of the first upgrade
  // track's base cost so later cost retunes rescale it automatically.
  COLD_BOOT_REWARD_CAP_MULT: 11541,

  // Save system — SAVE_MIN_INTERVAL throttles the gain-triggered autosave.
  // v3 (Phase 6): stats + achievements lifetime maps; older files are
  // upgraded in place by the Save migrations before validation.
  SAVE_FILENAME: "clicker-adventure-save",
  SAVE_BACKUP_FILENAME: "clicker-adventure-save-backup",
  SAVE_VERSION: 6,
  SAVE_MIN_INTERVAL: 1.0,

  // Max frame dt after a background/minimize gap; economy catch-up does NOT
  // ride dt — it routes through the offline system on boot (28800s cap).
  MAX_FRAME_DT: 0.25,

  // Prestige/rebirth: points earned sub-linearly (sqrt shaping) from gold
  // accumulated since the last rebirth; drives a gold-only multiplier
  // derived from the point total at each gain site, never stored separately.
  PRESTIGE_GOLD_BASE: 8000000,
  PRESTIGE_EXPONENT: 0.5,
  PRESTIGE_MULTIPLIER_PER_POINT: 0.01,

  // Prestige panel (design MAXIMA the layout clamps against the live window).
  PRESTIGE_BTN_WIDTH: 84,
  PRESTIGE_PANEL_WIDTH: 380,
  PRESTIGE_PANEL_HEIGHT: 280,
  PRESTIGE_PANEL_LINE_HEIGHT: 14,

  // Stats/achievements panel (same modal family; widths match prestige).
  STATS_BTN_WIDTH: 64,
  STATS_PANEL_WIDTH: 380,
  STATS_PANEL_HEIGHT: 320,
  STATS_PANEL_LINE_HEIGHT: 14,
  STATS_PANEL_MASTERY_FORMAT: "%d/%d unlocked",

  // On-screen toggle cluster: stage-corner toggles above the bottom bar.
  TOGGLE_BTN_WIDTH: 40,
  TOGGLE_BTN_HEIGHT: 24,

  // Daily login streak — day boundaries are UTC (floor(now/86400)) so no
  // timezone or DST rule can double-pay or skip a day. Day 8+ keeps the
  // streak alive on the top tier.
  DAILY_LOGIN_DAY_SECONDS: 86400,
  DAILY_LOGIN_REWARDS: [2, 3, 4, 5, 6, 8, 10],

  // Offline earnings popup: centered ~320px panel over a dim overlay.
  OFFLINE_REPORT_PANEL_WIDTH: 320,
  OFFLINE_REPORT_PANEL_HEIGHT: 190,
  OFFLINE_REPORT_PADDING: 16,
  OFFLINE_REPORT_LINE_HEIGHT: 20,
  OFFLINE_REPORT_DIM_COLOR: [0, 0, 0, 178],
  OFFLINE_REPORT_PANEL_COLOR: [26, 26, 46, 255],
  OFFLINE_REPORT_BORDER_COLOR: [240, 200, 80, 255],
  OFFLINE_REPORT_TITLE_COLOR: [240, 200, 80, 255],
  OFFLINE_REPORT_TEXT_COLOR: [255, 255, 255, 255],
  OFFLINE_REPORT_HINT_COLOR: [160, 160, 176, 255],

  // HUD display
  HUD_PANEL_HEIGHT: 48,
  HUD_COLOR_GOLD: [240, 200, 80, 255],
  HUD_COLOR_EXP: [155, 89, 182, 255],
  HUD_COLOR_TOKEN: [26, 188, 156, 255],

  // Background
  BG_COLOR: [26, 26, 46, 255], // #1A1A2E

  // Progression unlocks (Phase B re-spacing: beats across the first ~15 min).
  EXP_THRESHOLD_1: 100,
  EXP_THRESHOLD_2: 1000,
  EXP_THRESHOLD_3: 6000,
  UNLOCK_MESSAGE_LIFETIME: 3.0,
  UNLOCK_MESSAGE_Y: 70,
  UNLOCK_MESSAGE_COLOR: [255, 215, 0, 255],
  UNLOCK_MESSAGE_SIZE: 14,

  // Kill-progress meter under the monster. After the final EXP tier the same
  // bar repurposes to purchase mode with the gold fill. Width/height are
  // design MAXIMA the layout clamp consumes — positions stay in Layout.
  KILL_METER_MAX_WIDTH: 240,
  KILL_METER_HEIGHT: 10,
  KILL_METER_TRACK_COLOR: [60, 60, 80, 255],
  KILL_METER_FILL_COLOR: [155, 89, 182, 255],
  KILL_METER_PURCHASE_FILL_COLOR: [240, 200, 80, 255],

  // Upgrade system. Each definition in upgrades.ts hardcodes its own
  // maxLevel — this constant is the doc value for the active rails.
  UPGRADE_MAX_LEVEL: 100,
  UPGRADE_CARD_HEIGHT: 80,
  UPGRADE_CARD_GAP: 8,
  UPGRADE_BUY_BTN_HEIGHT: 28,
  UPGRADE_BUY_BTN_COLOR: [240, 200, 80, 255],
  UPGRADE_DISABLED_COLOR: [108, 108, 128, 255],

  // Gacha / Pity system
  PITY_SOFT: 75,
  PITY_HARD: 100,
  BASE_DROP_RATE: 0.05,
  SOFT_PITY_RATE: 0.10,
  PULL_COST: 10,
  WAIFU_POOL: [
    { name: "Karen the Accountant", bonus_type: "tokens", bonus_value: 0.10 },
    { name: "Steve the HR Rep", bonus_type: "gold", bonus_value: 0.05 },
    { name: "Linda the Middle Manager", bonus_type: "exp", bonus_value: 0.07 },
  ],

  // Areas ladder: numbered office areas, each with a named milestone boss,
  // a background tint and hires that join the gacha pool from that area on.
  // Kill targets are per-area CUMULATIVE-in-area counts; the milestone kill
  // IS the boss. Clearing an area pays a permanent gold bonus.
  AREA_KILL_TARGETS: [10, 20, 40, 80, 160, 320],
  // Gold earned INSIDE an area that fills its progress meter. A full meter
  // ripens the Treasure Chest; harvesting it unlocks the next area. The
  // player always chooses when to move on — nothing advances by itself.
  AREA_GOLD_TARGETS: [50, 150, 400, 1000, 2500, 6000],
  AREA_GOLD_BONUS_PER_CLEAR: 0.25,
  // Monster hit points per area (PS99 pace): clicks deal click damage and
  // the monster dies when its HP runs out. Later areas take more clicks per
  // kill; the milestone boss doubles its area's HP.
  AREA_MONSTER_HP: [1, 2, 4, 8, 16, 32],
  // Assigned hires land this much automatic damage per second on the monster
  // (each ally contributes one click-damage worth per tick).
  AUTO_KILL_TICK: 1.0,
  // PS99-style pickups inside an area: Coin pile and EXP orb ripe at the
  // 1/3 and 2/3 gold marks, Treasure Chest with the full meter. Coins and
  // orbs re-ripe after a short cooldown so the row keeps its rhythm; the
  // chest waits for the full meter. Bursts are flat so early areas feel
  // chunky without scaling.
  AREA_NODE_GOLD: 10,
  AREA_NODE_EXP: 10,
  AREA_NODE_TOKENS: 5,
  PICKUP_RESPAWN_SECONDS: 10,
  // Waifu equip lanes (Pet-Simulator-style): only equipped hires pay their
  // bonus, so picking the trio is a real decision. Oldest-first eviction.
  EQUIP_SLOTS: 3,
  // Area menu modal (Clicker Heroes zone picker): centered panel with an
  // area-chip row, current-area info and the area quest line.
  AREA_MENU_WIDTH: 340,
  AREA_MENU_HEIGHT: 250,
  AREAS: [
    { name: "Cubicle", boss: "The Printer Jam", bg: [26, 26, 46, 255], monster: "mon_slime", pool: ["Karen the Accountant", "Steve the HR Rep", "Linda the Middle Manager"] },
    { name: "Open Plan", boss: "The All-Hands", bg: [24, 32, 42, 255], monster: "mon_goblin", pool: ["Dave from IT", "Maya the Scrum Coach"] },
    { name: "Break Room", boss: "The Expired Yogurt", bg: [30, 28, 38, 255], monster: "mon_skeleton", pool: ["Priya from Payroll", "Rosa the Barista", "Carl the Janitor"] },
    { name: "Conference Room", boss: "The Meeting That Could Have Been an Email", bg: [28, 24, 36, 255], monster: "mon_cyclops", pool: ["Tina from Temp Agencies", "Councilwoman Diaz", "Chief of Staff Ana"] },
    { name: "Copy Room", boss: "The Outdated Toner", bg: [22, 30, 34, 255], monster: "mon_mimic", pool: ["Gus from Facilities", "Hank the Truck Driver"] },
    { name: "Corner Office", boss: "The Quarterly Close", bg: [36, 28, 26, 255], monster: "mon_cyclops", pool: ["Elaine the Night Manager", "Bob the Intern"] },
  ] as AreaDef[],

  // Bonus defs for every waifu name across all area pools (area 1 names are
  // duplicated from WAIFU_POOL so pool building is a single lookup).
  WAIFU_BONUS_BY_NAME: {
    "Karen the Accountant": { bonus_type: "tokens", bonus_value: 0.10 },
    "Steve the HR Rep": { bonus_type: "gold", bonus_value: 0.05 },
    "Linda the Middle Manager": { bonus_type: "exp", bonus_value: 0.07 },
    "Dave from IT": { bonus_type: "tokens", bonus_value: 0.12 },
    "Priya from Payroll": { bonus_type: "gold", bonus_value: 0.06 },
    "Tina from Temp Agencies": { bonus_type: "exp", bonus_value: 0.08 },
    "Gus from Facilities": { bonus_type: "tokens", bonus_value: 0.09 },
    "Maya the Scrum Coach": { bonus_type: "exp", bonus_value: 0.09 },
    "Rosa the Barista": { bonus_type: "gold", bonus_value: 0.08 },
    "Carl the Janitor": { bonus_type: "tokens", bonus_value: 0.10 },
    "Councilwoman Diaz": { bonus_type: "exp", bonus_value: 0.11 },
    "Chief of Staff Ana": { bonus_type: "gold", bonus_value: 0.09 },
    "Hank the Truck Driver": { bonus_type: "tokens", bonus_value: 0.15 },
    "Elaine the Night Manager": { bonus_type: "gold", bonus_value: 0.12 },
    "Bob the Intern": { bonus_type: "exp", bonus_value: 0.06 },
  } as Record<string, { bonus_type: string; bonus_value: number }>,

  // Roster panel. Panel POSITION/SIZE and the grid are DERIVED from the
  // window via layout.ts; these are card sizing and honest caps.
  ROSTER_PANEL_WIDTH: 180, // rail width cap (design width)
  ROSTER_CARD_SIZE: 64,
  ROSTER_SPRITE_SIZE: 32,
  ROSTER_GRID_COLS: 3, // max columns (layout gives fewer when they would clip)
  ROSTER_VISIBLE_ROWS: 5,
  ROSTER_CARD_SPACING: 8,
  ROSTER_PANEL_PADDING: 8,
  ROSTER_SCROLL_SPEED: 30,
  ROSTER_LABEL_HEIGHT: 30,
  ROSTER_HEADER_HEIGHT: 20,

  // Touch input lane: tap-vs-drag tuning for the pointer machine.
  TOUCH_DRAG_THRESHOLD_PX: 10,
  TOUCH_SCROLL_SENSITIVITY: 1.0,
  TOUCH_TAP_DEBOUNCE_S: 0.05,
  TOUCH_TAP_TOLERANCE_PX: 2,

  // Responsive layout core: rails shrink proportionally below the design
  // width, never below the min; viewport clamped to the min size.
  LAYOUT_MARGIN: 16,
  LAYOUT_RAIL_MIN_WIDTH: 120,
  LAYOUT_RAIL_RATIO: 0.225,
  LAYOUT_MIN_WIDTH: 520,
  LAYOUT_MIN_HEIGHT: 360,
  // Collapsible rails: a collapsed rail shrinks to this strip and the stage
  // absorbs the freed width; the chevron tab lives in the rail's top corner.
  COLLAPSED_RAIL_WIDTH: 28,
  RAIL_TAB_SIZE: 24,
  UPGRADE_CARD_MIN_HEIGHT: 70,
  PITY_TEXT_WIDTH: 128,

  // Bottom bar
  BOTTOM_BAR_HEIGHT: 48,
  BOTTOM_BAR_Y: 552,
  PULL_BTN_X: 16,
  PULL_BTN_WIDTH: 160,
  PULL_BTN_COLOR: [240, 200, 80, 255],
  PULL_BTN_DISABLED_COLOR: [108, 108, 128, 255],
  PITY_NORMAL_COLOR: [160, 160, 176, 255],
  PITY_WARNING_COLOR: [255, 215, 0, 255],

  // Failed-pull toast: failures print their pity result before the last
  // quarter of the fade so a silent deduction doesn't read as a dead button.
  PULL_FAIL_TOAST_LIFETIME: 2.5,
  PULL_FAIL_TOAST_Y: 112,
  PULL_FAIL_TOAST_COLOR: [255, 215, 0, 255],

  // Event punctuation lane: a SINGLE coalesced toast lane for discrete
  // ledger events. Re-firing resets timer+text, never stacks. The passive
  // drip never toasts or flashes; per-click gold is popped, not flashed.
  EVENT_TOAST_LIFETIME: 2.5,
  EVENT_TOAST_Y: 136,
  EVENT_TOAST_COLOR: [235, 235, 245, 255],
  HUD_FLASH_DURATION: 0.4,
  // Bulk-unlock coalesce suffix: one qualifying pass reads as ONE toast.
  ACHV_TOAST_MORE_SUFFIX: " (and %d more)",

  // Reset progress button, right-aligned in the bottom bar
  RESET_BTN_WIDTH: 64,
  RESET_BTN_MARGIN: 16,
  RESET_BTN_COLOR: [108, 108, 128, 255],
  RESET_ARMED_COLOR: [231, 76, 60, 255],

  // Save-recovery warning toast
  SAVE_WARNING_COLOR: [231, 76, 60, 255],
  SAVE_WARNING_LIFETIME: 6.0,
  SAVE_WARNING_Y: 88,

  // Debug harness overlay
  DEBUG_OVERLAY_X: 600,
  DEBUG_OVERLAY_Y: 10,
  DEBUG_OVERLAY_COLOR: [255, 255, 255, 200],
  DEBUG_OVERLAY_SIZE: 11,

  // Waifu system
  WAIFU_SPRITE_SIZE: 64,
  WAIFU_IDLE_COLOR: [196, 113, 237, 255],
  WAIFU_HAPPY_COLOR: [46, 204, 113, 255],
  WAIFU_DISAPPOINTED_COLOR: [108, 108, 128, 255],
  WAIFU_REACTION_COLOR: [255, 107, 157, 255],
  WAIFU_HUMOR_LIFETIME: 4.0,
  WAIFU_HUMOR_COLOR: [26, 188, 156, 255],
  WAIFU_HUMOR_SIZE: 12,
  WAIFU_HAPPY_LIFETIME: 2.0,
  WAIFU_HAPPY_COLOR_DURATION: 2.0,

  // Summoning animation
  SUMMON_CIRCLE_SIZE: 200,
  SUMMON_CIRCLE_COLOR: [76, 201, 240, 255],
  SUMMON_PARTICLE_COLOR: [196, 200, 80, 255],
  SUMMON_ROTATION_SPEED: 1.5,
  SUMMON_ORBIT_DISTANCE: 120,
  SUMMON_FADE_IN_TIME: 0.2,
  SUMMON_PULL_BG: [15, 52, 96, 255],
  SUMMON_PULL_BTN_WIDTH: 160,
  SUMMON_PULL_BTN_HEIGHT: 36,

  // Summoning animation effects
  SUMMON_CIRCLE_GLOW_SIZE: 8,
  SUMMON_CIRCLE_GLOW_ALPHA: 0.3,
  SUMMON_CIRCLE_PULSE_SPEED: 2.0,
  SUMMON_INNER_RING_RATIO: 0.6,
  SUMMON_INNER_RING_COLOR: [196, 113, 237, 255],
  SUMMON_INNER_RING_WIDTH: 2,
  SUMMON_INNER_ROTATION_SPEED: -1.0,
  SUMMON_PARTICLE_COUNT: 35,
  SUMMON_PARTICLE_GRAVITY: 20,
  SUMMON_PARTICLE_ROTATION_SPEED: 3.0,
  SUMMON_REVEAL_SHAKE_AMOUNT: 3,
  SUMMON_REVEAL_SHAKE_DURATION: 0.3,
  SUMMON_REVEAL_SHAKE_FRAMES: 5,
  SUMMON_CIRCLE_FADE_START: 0.7,

  // Waifu personality: flavor lines shown on the pull-screen reveal.
  WAIFU_PERSONALITY: {
    "Karen the Accountant": {
      reveal_color: [255, 107, 157, 255],
      reveal_label: "Karen (excited~!)",
      glow_intensity: 0.8,
      reaction_delay: 0.1,
      skill: "Excel Macros",
      flavor:
        "Keeps her feelings on a color-coded spreadsheet. Q3 feelings came in 12% over forecast.",
    },
    "Steve the HR Rep": {
      reveal_color: [46, 204, 113, 255],
      reveal_label: "Steve (nodding approvingly)",
      glow_intensity: 0.6,
      reaction_delay: 0.15,
      skill: "Performance Reviews",
      flavor:
        "Calls every meeting 'a quick sync'. The quick syncs are never quick.",
    },
    "Linda the Middle Manager": {
      reveal_color: [243, 156, 18, 255],
      reveal_label: "Linda (synergizing~)",
      glow_intensity: 0.7,
      reaction_delay: 0.12,
      skill: "Calendar Tetris",
      flavor:
        "Will circle back. She has always circled back. It is her entire personality.",
    },
    "Dave from IT": {
      reveal_color: [91, 189, 255, 255],
      reveal_label: "Dave (has restarted your wizard)",
      glow_intensity: 0.7,
      reaction_delay: 0.12,
      skill: "Have You Tried Restarting It",
      flavor:
        "Owns every keyboard on every floor and knows it. Fixes everything except the coffee machine.",
    },
    "Priya from Payroll": {
      reveal_color: [26, 188, 156, 255],
      reveal_label: "Priya (approved your timesheet)",
      glow_intensity: 0.75,
      reaction_delay: 0.1,
      skill: "Direct Deposit",
      flavor:
        "Every bonus she touches lands on time. A rare and beautiful chaos.",
    },
    "Tina from Temp Agencies": {
      reveal_label: "Tina (triple-booked again)",
      reveal_color: [243, 156, 18, 255],
      glow_intensity: 0.65,
      reaction_delay: 0.14,
      skill: "Infinite Temp Staff",
      flavor:
        "Runs three departments with two phones and one laminated planner.",
    },
    "Gus from Facilities": {
      reveal_color: [176, 176, 192, 255],
      reveal_label: "Gus (fixed the thermostat)",
      glow_intensity: 0.8,
      reaction_delay: 0.1,
      skill: "Optimal Thermostat",
      flavor:
        "Sets the office to exactly 21 degrees. Argues for it like it is ancient scripture.",
    },
    "Maya the Scrum Coach": {
      reveal_color: [155, 89, 182, 255],
      reveal_label: "Maya (ceremony complete!)",
      glow_intensity: 0.7,
      reaction_delay: 0.11,
      skill: "Ceremonial Stand-Up",
      flavor:
        "Her stand-ups are the real final boss. Nobody has ever reached the last phase.",
    },
    "Rosa the Barista": {
      reveal_color: [230, 126, 34, 255],
      reveal_label: "Rosa (extra shot, on the house)",
      glow_intensity: 0.75,
      reaction_delay: 0.1,
      skill: "Caffeine Pipeline",
      flavor:
        "Keeps the whole floor awake with one machine and zero apologies.",
    },
    "Carl the Janitor": {
      reveal_color: [52, 152, 219, 255],
      reveal_label: "Carl (mopped before you spilled)",
      glow_intensity: 0.65,
      reaction_delay: 0.13,
      skill: "Night Shift Protocol",
      flavor:
        "Knows where every spare key is. Has never once needed a key.",
    },
    "Councilwoman Diaz": {
      reveal_color: [46, 204, 113, 255],
      reveal_label: "Diaz (budget passed, on time)",
      glow_intensity: 0.8,
      reaction_delay: 0.09,
      skill: "Actually Competent",
      flavor:
        "Runs a meeting that ends on schedule. Historians call it a miracle.",
    },
    "Chief of Staff Ana": {
      reveal_color: [241, 196, 15, 255],
      reveal_label: "Ana (already triaged it)",
      glow_intensity: 0.7,
      reaction_delay: 0.1,
      skill: "Inbox Zero",
      flavor:
        "Every crisis hits her desk one step before it becomes anyone's problem.",
    },
    "Hank the Truck Driver": {
      reveal_color: [231, 147, 74, 255],
      reveal_label: "Hank (delivery on time)",
      glow_intensity: 0.8,
      reaction_delay: 0.1,
      skill: "Delivers the Hero",
      flavor:
        "He is the truck that isekai'd the last hero. Still driving. Still delivering.",
    },
    "Elaine the Night Manager": {
      reveal_color: [149, 165, 255, 255],
      reveal_label: "Elaine (lights out, output up)",
      glow_intensity: 0.75,
      reaction_delay: 0.11,
      skill: "After-Hours Ops",
      flavor:
        "Runs the whole building between midnight and the morning newsletter.",
    },
    "Bob the Intern": {
      reveal_color: [127, 214, 179, 255],
      reveal_label: "Bob (permanent hire!)",
      glow_intensity: 0.6,
      reaction_delay: 0.15,
      skill: "Encrypted Enthusiasm",
      flavor:
        "Was promised exposure. Received a chair, a stapler, and a small empire.",
    },
  } as Record<string, WaifuPersonality>,

  // Rarity ladder, rolled per successful pull (independent of which waifu
  // dropped): weights sum to 100 so a roll is a plain cumulative walk, and
  // bonus_mult scales the character's base bonus into the pulled instance.
  // Stars are ASCII on purpose (parity with the LÖVE font limitation).
  WAIFU_RARITIES: [
    { key: "common", name: "Common", stars: "*", weight: 70, bonus_mult: 1.0, color: [176, 176, 192, 255] },
    { key: "rare", name: "Rare", stars: "**", weight: 22, bonus_mult: 1.5, color: [91, 189, 255, 255] },
    { key: "epic", name: "Epic", stars: "***", weight: 7, bonus_mult: 2.25, color: [185, 122, 255, 255] },
    { key: "legendary", name: "Legendary", stars: "****", weight: 1, bonus_mult: 3.5, color: [255, 200, 60, 255] },
  ] as readonly Rarity[],
  WAIFU_RARITY_BY_KEY: {} as Record<string, Rarity>,

  // Waifu detail overlay (status screen opened from a roster card). Layout
  // clamps these against the live window, so they are maximums, not promises.
  WAIFU_DETAIL_PANEL_WIDTH: 320,
  WAIFU_DETAIL_PANEL_HEIGHT: 360,
  WAIFU_DETAIL_SPRITE_SIZE: 96,
  WAIFU_DETAIL_INFO_RESERVE: 110,

  // Bonus phrasing per currency, shared by roster cards and pull reveals.
  WAIFU_BONUS_LABELS: {
    tokens: "Token Generation",
    gold: "Gold Drops",
    exp: "EXP Gain",
  },
  // 64px roster cards cannot fit those words; cards print a short suffix.
  ROSTER_BONUS_SHORT: {
    tokens: "Tok",
    gold: "Gold",
    exp: "EXP",
  },

  // The curated 16-badge achievement roster. Stable lowercase snake-case ids
  // are the persisted state.achievements key contract — never rename casually.
  // `metric` is one of the canonical state.stats keys (a missing stat
  // evaluates as 0). Array order IS the deterministic iteration order.
  ACHIEVEMENTS: [
    { id: "first_click", label: "Clock In", metric: "clicks", goal: 1, tier: "bronze" },
    { id: "hundred_kills", label: "Performance Review", metric: "kills", goal: 100, tier: "silver" },
    { id: "thousand_kills", label: "Middle-Manager Massacre", metric: "kills", goal: 1000, tier: "silver" },
    { id: "ten_k_kills", label: "Departmental Restructuring", metric: "kills", goal: 10000, tier: "gold" },
    { id: "first_crit", label: "Spot-On Pitch", metric: "crits", goal: 1, tier: "bronze" },
    { id: "thousand_crits", label: "Quantifiable Impact", metric: "crits", goal: 1000, tier: "silver" },
    { id: "five_k_crits", label: "Exceeds Expectations", metric: "crits", goal: 5000, tier: "gold" },
    { id: "first_pull", label: "First Ticket In", metric: "pulls_total", goal: 1, tier: "bronze" },
    { id: "rare_23", label: "Rare Performance Review", metric: "pulls_rare", goal: 23, tier: "bronze" },
    { id: "epic_7", label: "Epic Synergy Hunt", metric: "pulls_epic", goal: 7, tier: "bronze" },
    { id: "legendary_1", label: "Legendary Corner Office", metric: "pulls_legendary", goal: 1, tier: "bronze" },
    { id: "upgrades_500", label: "Department Overhaul", metric: "upgrades_bought", goal: 500, tier: "silver" },
    { id: "rebirth_1", label: "New Employee Onboarding", metric: "rebirths", goal: 1, tier: "bronze" },
    { id: "rebirth_2", label: "Onboarded Again", metric: "rebirths", goal: 2, tier: "bronze" },
    { id: "playtime_3600", label: "Full Shift Completed", metric: "play_time", goal: 3600, tier: "gold" },
    { id: "hire_everyone", label: "Whole Staff Onboarded", metric: "unique_hires", goal: 15, tier: "gold" },
    // Area quests: one curated line per area (area = AREAS index), shown in
    // the area menu and paid once through the SAME badge lane as the rest of
    // the roster. Metrics reuse the canonical stats keys.
    { id: "q_cubicle_clicks", label: "Punch In: click 25 times", metric: "clicks", goal: 25, tier: "bronze", area: 0 },
    { id: "q_openplan_upgrades", label: "Squad Sync: buy 10 upgrades", metric: "upgrades_bought", goal: 10, tier: "bronze", area: 1 },
    { id: "q_breakroom_crits", label: "Extra Shot: land 50 crits", metric: "crits", goal: 50, tier: "bronze", area: 2 },
    { id: "q_conference_pulls", label: "Headcount: 10 summons", metric: "pulls_total", goal: 10, tier: "silver", area: 3 },
    { id: "q_copyroom_crits", label: "Night Haul: land 250 crits", metric: "crits", goal: 250, tier: "silver", area: 4 },
    { id: "q_corner_hires", label: "Full Floor: hire 10 staff", metric: "unique_hires", goal: 10, tier: "gold", area: 5 },
  ] as AchievementDef[],

  // Tier -> one-time achievement rewards, paid once by the unlock flip-guard.
  // Badge gold rides the prestige multiplier at the payment site; tokens don't.
  ACHV_REWARDS: {
    bronze: { gold: 200, tokens: 16 },
    silver: { gold: 800, tokens: 40 },
    gold: { gold: 3200, tokens: 96 },
  },
};

export interface WaifuPersonality {
  reveal_color: readonly [number, number, number, number];
  reveal_label: string;
  glow_intensity: number;
  reaction_delay: number;
  skill: string;
  flavor: string;
}

export interface AreaDef {
  name: string;
  boss: string;
  bg: readonly number[];
  monster: string;
  pool: readonly string[];
}

export interface AchievementDef {
  id: string;
  label: string;
  metric: string;
  goal: number;
  tier: string;
  area?: number;
}

for (const r of Config.WAIFU_RARITIES) {
  Config.WAIFU_RARITY_BY_KEY[r.key] = r;
}

export default Config;
