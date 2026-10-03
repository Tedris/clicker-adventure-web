# Gacha design research — rare waifus & drops (no-pay-to-win edition)

Compiled 2026-10-02. Sources: KeqingMains (Genshin pity math), NTE/NTEguide pity breakdowns, Epic Games Store gacha explainer, gashapoint pity-system guide, plus the PS99 notes in `ps99-research.md`. Companion doc to `ps99-research.md`; references our code in `src/systems/gacha.ts` and `src/config.ts`.

## 1. The canonical gacha anatomy (what the genre converged on)

A gacha system is five interacting parts. Every successful modern game (Genshin, Wuthering Waves, Infinity Nikki, NTE) is a variation on this skeleton:

1. **Banner** — a pull surface with its own pool and rates. Genre splits them into: Limited (time-boxed featured unit), Standard/permanent, Weapon/gear, Beginner (discounted first ~20 pulls with early guarantee). Beginner-banner math is worth copying: same mechanics, better rates for the first N pulls, because the first pulls are what hook a player.
2. **Pull currency** — usually two tiers: a mundane earn-often currency (buys misc upgrades) and a premium "crystal/ticket" currency that only buys pulls. Keep them separate; it's what makes saving-for-a-banner a real planning decision. In our game: gold vs tokens. Tokens are already earn-only (kills, chests, daily streak) — that IS the no-pay-to-win substitute for premium currency: the premium tier exists, but it's paid out by play, not purchase.
3. **Base rarity rates** — HoYoverse reference numbers: 5★ 0.6%, 4★ 5.1%, 3★ 94.3% (character banner). Our ladder (Legendary 1% / Epic 7% / Rare 22% / Common 70%) is the same shape but ~1.7x more generous on the top tier — good, keep it; the genre trend is toward kinder rates precisely because pity-visible generosity is a retention feature.
4. **Pity** — see §2.
5. **Rate-up / featured guarantee** — see §3.

## 2. Pity: the mechanics that matter

Three-stage curve, as implemented by the current best-regarded systems:

- **Flat zone** (pulls 1–~69): fixed base rate (~1–6%).
- **Soft pity** (~pulls 70+): rate ramps per pull, not a single jump. Genshin: rate ×10 once past threshold (~0.6% → 6%/pull). NTE-style documented curve: ~5.9% at pull 70 climbing to ~100% by pull 89. Effect: median 5★ lands around pull 75–85; only the extremely unlucky ever see the hard cap.
- **Hard pity** (pull 90 character / 80 weapon): guaranteed.

Two refinements that separate the good systems from the bad:

- **Pity inheritance.** Pity count carries over between banners of the same type when the banner rotates. A player at 61 pulls on the old banner starts the new banner at 61. This removes the "banner changed, my saves were wasted" rage-quit and costs nothing to implement: the counter already lives on `state.pity_counter`, not per-banner.
- **Secondary pity.** Genshin guarantees a 4★ every 10 pulls on top of the 5★ pity. In our terms: guarantee *something* interesting (Rare+) every 10 pulls so a dry spell still reads as progress. Cheap: a second counter, or reuse the existing one as `counter % 10 == 0`.

Reality-check percentile table from the KQM model (what players actually experience, worth matching with our numbers):

| Goal | 50th pct | 95th pct | 99th pct |
|---|---|---|---|
| One featured 5★ (Genshin rates) | 80 pulls | 158 | 161 |
| Full C6 of featured 5★ | 654 | 843 | 917 |

Our numbers (soft pity 75 @ 10%, hard pity 100 @ 100%, base 5%) put the median featured pull around ~77 and worst case at exactly 100 — a tighter, friendlier distribution than the genre's flagship. That's the deliberate differentiator: **bounded, visible, honest pity**. Show the counter (`get_display_info` already does: counter/max/threshold/warning) and never hide the ramp.

## 3. The 50/50 and its better alternative

Classic split (Genshin): on the featured banner, half the 5★s are the featured unit, half are standard-pool; losing the coin flip ("losing the 50/50") doubles the effective cost — median ~80 pulls becomes ~120–160 for a specific target, and C6 can exceed 650 pulls.

Newer games (NTE and successors) dropped it: **any 5★ from the limited banner IS the featured unit**. Guaranteed-featured is strictly kinder, trivially implemented, and reads as generous instead of punitive. For our game this maps directly: when pity fires, the result should bias toward the current area's pool — which `get_random_waifu` already does by weighting the current-area hires twice. Keep that doubling on the pity path explicitly: pity-earned pull = guaranteed from current area pool.

A middle-ground option used by weapon banners is the **Epitomized Path**: pick a target unit; if the next two 5★ rolls miss it, the third is forced to it. (Progress resets across banner rotations — that's the part to soften; inherit instead.) Only needed if the pool per banner grows large; with ≤3 hires per area the double-weight trick is enough.

## 4. Duplicate handling (PS99 crossed with gacha convention)

Two genre conventions, both worth stealing:

- **Star-up from duplicates** (C0–C6): each copy of the same unit raises its tier/bonus. Maps onto our existing model cleanly: `effective_assigned` already counts every roster copy of an assigned name additively ("duplicate stacks keep stacking"). The fused-version upgrade (PS99's "5 fused copies >> 5 separate") is the more interesting variant — spend N copies of a name to bump its base bonus once, so surplus duplicates convert into permanent power instead of clutter.
- **Duplicate-to-token exchange**: surplus dupes refund a small amount of the premium currency (some games: an exchange shop at ~fixed rate per star level). Prevents the "I pulled a 4★ I don't need and it did nothing" dead pull feeling.

Rarity multipliers already in config (Common 1.0 / Rare 1.5 / Epic 2.25 / Legendary 3.5×) follow the genre's roughly-×1.5-per-star curve.

## 5. Applying luck-style buffs to a no-P2W gacha

PS99's luck stack (see `ps99-research.md` §Luck) is the cleanest model for a no-pay-to-win game because every layer is earnable:

- Luck sources = multiplicative buffs from enchantment-tier progression, prestige-shop purchases, and assigned-team bonuses (some hires contribute a luck stat).
- Luck acts on hatch odds as a denominator divisor: effective rate = base_rate × luck_multiplier. It never makes a roll "due" — pity already handles that; the two systems are orthogonal.
- Practical rule to surface in UI: stack buffs, then batch-open. Our token drip (daily streak 2→10 scaling) plus area-chest hires (`hire_from_pool`, pity untouched) already form this rhythm: save tokens through the week, spend them in one boosted session.

## 6. Checklist against our current implementation

| Convention | Ours (`gacha.ts`/`config.ts`) | Status |
|---|---|---|
| Soft pity ramp before hard | 75→10%, 100→100% | ✔ — linear-jump version; genre uses gradual ramp (5.9%→100% over ~20 pulls) if we ever want to match NTE smoothness |
| Hard pity guarantee | 100 pulls | ✔, visible via pity counter + warning color at ≥80 |
| Secondary pity (small guarantee) | none | gap — Rare+ every ~10 pulls is the cheapest quality-of-life win |
| Rate-up / featured pool | current-area pool double-weighted | ✔ — equivalent to no-50/50 guaranteed-featured |
| Pity inheritance across banners | single counter on state, never reset on area change | ✔ — already inherits |
| Beginner discount | none | optional — first ~20 pulls cheaper or first Legendary guaranteed by pull ~20; first-session hook |
| Duplicate star-up | additive duplicate stacking | ✔ partial — could add fused-copy upgrade on top |
| Dupe refund | none | optional, small |
| Earn-only premium currency | tokens from kills/chests/daily only | ✔ — this is the no-P2W backbone; premium currency is never sold, only earned |

## 7. Numbers cheat sheet (reference rates found)

- Genshin character banner: 5★ 0.6% / pity 90, soft from ~74 (×10 ramp); 4★ 5.1% / pity 10. Featured = half the 5★s, 100% on pity after a lost 50/50.
- Genshin weapon banner: 5★ 0.7% / pity 80, soft from ~63; Epitomized Path = target guaranteed on 3rd 5★.
- NTE character banner: S ≈ 0.99%, hard pity 90, soft ramp documented from pull 70; **no 50/50**, pity inherits across banners; beginner banner = first 20 pulls half price.
- Genre averages for median featured-unit cost: ~80 pulls (no 50/50) vs ~120+ (with 50/50). Design target for our ladder: featured-in-area median ≈ 77 pulls, worst case 100.
