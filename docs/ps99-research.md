# Pet Simulator 99 — gameplay research (for the web clicker port)

Sources: pet-simulator.fandom.com wiki, db.biggames.io (BIG Games community index), bloxtoolbox/bloxodes guides, dungeonpath guides. Compiled 2026-10-02.

## The core loop (one sentence)
Tap/break coin piles and chests in an area → earn coins → buy eggs → hatch pets with better stats → pets auto-break faster → push to the next area → repeat; periodically "Rebirth" for a permanent multiplier.

## Pillars

### 1. Areas / worlds
- Linear zone ladder: Spawn → Beach → Cave → Frozen Tundra → Tech → Space → (more worlds later). Each area gates on damage roughly; later worlds unlock via rebirth count and rocketship-style shortcuts.
- Breakables (coin piles, chests) respawn; income = breakables broken per minute. The only early-game metric that matters is coins-per-second.
- Chests are the drop source for enchants, potions, tokens; bigger chests = more HP but better drops. Guides' rule: farm the chest you can kill fastest, not the biggest one.

### 2. Pets & team
- Up to ~12 pet slots (more unlock through progression); equipped pets stack their stats (damage, coin multiplier, luck).
- Pets come from eggs; each egg has a weighted pet pool (weights normalized to ~100 ≈ percent chance per pet).
- Rarity tiers: Common → Uncommon → Rare → Epic → Legendary → Mythic, plus "Exclusive" pets from exclusive eggs. Actual usefulness tracks the per-pet damage stat, not the rarity label — a high-stat Legendary beats a low-stat Mythic.
- Modifier rolls are independent on top of the pool roll: Shiny, Rainbow, Gold, and the big ones Huge / Titanic / Gargantuan (huge-variant rates ~1/100 on first farmable eggs down to ~1/1,000,000+ for Titanics; each hatch an independent roll, no pity).
- Duplicate fusion: combining duplicates upgrades a pet tier; 5 fused copies >> 5 equipped separately. Overflow should fuse, not hoard.
- "Best pet" upgrade path (shiny-tiering the top pet) survives rebirths.

### 3. Luck system
- "Luck" multiplies rare-hatch odds multiplicatively: gamepasses (1.5–2x), rebirth-shop boosts, luck-contributing equipped pets, event-server bonuses, Lucky Eggs enchants. Example stack: 2 × 1.5 × 1.25 × 1.5 ≈ 5.6x — a 1-in-100k becomes effectively ~1-in-18k.
- Luck lowers the denominator; it never makes a roll "due" (rolls stay independent).
- Practical tip repeated everywhere: stack all luck buffs, THEN open a batch of eggs; don't burn boosted minutes on commons.

### 4. Enchants
- Equipable passive gems slotted onto pets. Up to 8 slots (5 free from rank progression + 3 premium). Two families:
  - Standard enchants, upgradable tiers I–X: Coins, Diamonds, Critical, Strong Pets, Tap Power, Treasure Hunter, Lucky Eggs, Speed, Magnet.
  - Special enchants (fixed rarity) from achievements/chests/shop: Fortune, Midas Touch, etc.
- Full-tier examples: Coins X = +200% coins from breakables; Lucky Eggs X = +160% egg luck; Treasure X = +55% drop chance; Diamonds X = +65% diamonds.
- Diminishing-returns rule (community-verified): same-type enchants on one pet apply additively with decay — first enchant 100% active, second ~60%, third ~38%, etc. So breadth of enchant types beats stacking one type.
- Economy insight: tier X costs ~2.5x tier IX for ~10% more effect → stop at IX unless main pet + rich gem income. Hard-stop rule: set a gem budget before rolling; the enchant machine has no pity timer.
- Priority order from guides: Damage enchants first (clear speed → coins/hour), Coins next, Luck/enchant-luck last but scales forever. Health/cosmetics never.

### 5. Rebirth (prestige)
- Resets coin balance + area progress. Keeps: all pets, inventory, diamonds/gems, enchants, best-pet upgrades, mastery levels, rebirth count, rebirth-shop boosts. Nothing tradeable is ever lost.
- Each rebirth tier grants a permanent pet-strength multiplier (+75% per tier ladder) plus unlock bundles. Ladder (through 9 tiers): R1 Area 25 (+75%, hatch faster, portable cannon), R2 A50, R3 A75 (+secret keys, hidden rooms), R4 A99 (biggest step: Ultimates, Mastery system, Tech world access), then stat/reward steps to R9 (cap). After R9 progression = mastery + enchants + pets.
- Pacing wisdom: don't rebirth the instant a gate opens — clear the area, drain its egg into best-pet upgrades first, then rebirth with coins banked. A commonly cited pace: ~20 rebirths in the first ~10 hours.
- The rebirth multiplier scales everything pets produce, so the same pet is worth far more on a high-rebirth account; pair the multiplier with your strongest team.

### 6. Side systems worth keeping
- Mastery: ~15 categories, each levelable 1–99 by doing the thing (breakables, hatches, enchants, diamonds); maxing one gives a Mastery Cape, all-maxed gives Master Skill Cape. Passive XP — no separate minigame.
- Rebirth shop: rebirth-count currency buys permanent damage/luck boosts.
- Daycare, spinny wheels, gift boxes, merchants: idle chest/ticket drip sources in spawn area.
- Clan content + Trading Plaza for endgame; Huge/Titanic pets hold real trade value (Huge Pixel Cat ~95B diamonds; Titanics 300B–1.1T).

## Design translation notes for clicker-adventure-web
- PS99's feel = pets do the breaking; tapping is bootstrap only. Our AUTO_KILL_TICK + assigned hires already replicate this.
- Areas ladder with milestone boss = their world ladder. Keep the "player chooses when to advance" rule.
- Their two currencies: coins (soft, resets on rebirth) and diamonds/gems (hard-ish, earned not bought, survive rebirth). Our gold/tokens split maps cleanly — tokens are earn-only, which matches the "no pay-to-win" goal (their Robux gamepasses are the P2W part; luck stacking must instead come from enchants/mastery/rebirths, all earnable).
- Enchant decay curve (100%, 60%, 38%, 27%…) is a cheap, proven way to cap stacking without hard walls.
- Luck = multiplicative stack of independent buffs, applied as a denominator divisor on gacha odds. Our pity (soft 75 / hard 100) is stricter than theirs (no pity at all) — keep ours; it's the friendlier variant of the same slot-machine pillar.
- Prestige-from-progress (their rebirth keeps everything meaningful; only the coin counter resets) matches our PRESTIGE_POINTS_PER_AREA_CLEAR design already.
