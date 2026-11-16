# BattleMech Manual, corrected sixth printing (2022)
## Sequential source audit — printed pages 5–12

**Scope:** BattleMechs, including biped and quad unless a later explicitly
defined product scope narrows it; standard and clearly labelled optional rules.
This review was made against the user-provided PDF and IronHex's actual
`packages/engine/`, `apps/api/src/operations.mjs` and test suite.

This document is a *source-to-code audit*, not a claim that these eight printed
pages, the whole chapter or the entire BMM have been implemented completely.

| Printed page / heading | Status | Source check and existing implementation |
| --- | --- | --- |
| p.5 ’Mech (generic term) | **Verified** | The glossary explicitly includes both Biped and Quad; classification is tested and does not assert quad gameplay support. |
| p.5 Introduction, remaining Game Terms, Vs. Total Warfare | Informational / cross-references remain | Context and definitions, not a standalone combat mechanic. Cross-reference rule texts are not audited as complete. |
| p.5 Four-Legged ’Mech | **Known missing** | BMM includes quadruped BattleMechs; current engine's arm/leg actuator and movement model is biped-specific. |
| p.5 Optional Rules | Not fully audited | Rules labelled optional require pregame agreement. Some browser toggles exist; consistent agreement and every option still need review. |
| p.6 Target Number | **Verified** | The 2D6 inclusive threshold predicate, TN ≤2 auto-success and TN ≥13 auto-failure have been checked across **all 36 ordered results × 19 representative TN values = 684 comparisons**. Base target numbers for specific maneuvers are separately governed by their later rulebook chapters. |
| p.6 Modified Target Number | Tested subset | Ranged, melee and skid collision previews now retain un-clamped computed TNs, including values below 2; success probability remains 100% at TN ≤2 and 0% above 12. |
| p.6 Target | Tested subset | Friendly BattleMechs cannot be direct ranged or physical targets. Friendly damage via area effects remains unverified. |
| p.6 Armor, Location, Slot and MP definitions | Not independently verified | Data structures exist, but separate verification is needed for rear armor, transfer, six/twelve slots and four-legged layouts. |
| p.7 Dice | **Verified** | Standard 2D6 rolls two independent six-sided dice and sums them; explicit 1D6 rolls one. Every 1D6 face and all 36 ordered 2D6 combinations have exact regression assertions. All engine mechanical dice are generated through `Game.roll` / `Game.d6`. |
| pp.7–8 Record Sheet and Scale | Not yet verified | UI exposes a record sheet and hex geometry; printing, information disclosure, scale/level edge cases and damage-sheet fidelity still need audits. |
| p.9 MechWarrior Skills | Tested subset | Normal IS skills are G4/P5; normal Clan skills are G3/P4; ranged and physical attacks use Gunnery and Piloting respectively. Explicitly assigned campaign pilots override defaults. PSR exceptions cross-reference p.53 and remain unverified. |
| p.10 Initiative Phase | Tested subset | Both sides roll 2D6, larger total wins, ties rerolled; more than 100 ties are now supported. A 10,000-consecutive-tie safeguard still exists for a broken deterministic RNG, so the heading has **not** been promoted to `verified`. |
| p.10 Movement Phase | Tested subset | The initiative loser moves first; a shutdown/unconscious unit can consume a movement selection. Terrain, deployment and all movement PSRs need separate audits. |
| pp.10–12 Sequence of Play | Tested subset | The six phases appear in printed order and a phase cannot skip outstanding unit declarations. Exact ordering of damage, consciousness, simultaneous fire and miscellaneous phase effects still need further tests. |
| p.11 Resolving Weapons Fire | Tested subset | A previously declared shot survives destruction of its shooter (existing regression); complete declared-attack ordering and optional Segmented Fire are not yet fully reviewed. |
| p.12 Unequal Numbers of ’Mechs | Tested subset | 2:1 and 3:1 declaration grouping is verified against examples. Exhaustive live count changes, larger ratios and all phase variants remain under audit. |
| p.12 Victory Conditions | **Known missing** | Last surviving side is detected. Two remaining sides incapable of moving and hurting one another must draw, but that condition is not yet implemented/verified. Simultaneous last-’Mech destruction also requires cross-checking. |
| p.12 Physical, Heat and End Phases | Tested subset | Engine phases exist and key End/Heat tests already pass; full exceptions and their cross-referenced rules are outside this first audit. |

## Regression coverage added

The new `tests/bmm-foundations.mjs` includes **13 deterministic tests**:

- All 36 ordered 2D6 combinations and all six faces of 1D6.
- Inclusive target numbers and automatic success/failure thresholds.
- Preservation of the actual modified TN, including negative and impossible TNs.
- Friendly direct-target prevention.
- Inner Sphere and Clan default Gunnery/Piloting, and separate ranged/melee skills.
- Initiative rerolls across 101 consecutive ties, outcomes for both sides,
  and loser-first action ordering.
- 2:1 and 3:1 unequal-force declaration batches.
- All six phases and a prohibition against skipping pending actions.
- Consuming an action with an unconscious/shutdown BattleMech.

Each proven case has an exact test-name reference in
[`battlemech-manual-requirements.json`](battlemech-manual-requirements.json).

## Requirements to finish before moving on

1. **Quad BattleMech treatment (p.5):** compare all four-leg-specific
   movement, components, firing arcs and physical attacks to the book.
2. **Target number completeness (p.6):** audit every action's base target number,
   modifiers and exceptions; do not infer conformance from the dice helper alone.
3. **Record sheet / scale (pp.7–8):** validate physical data and information rules.
4. **Skills (p.9):** verify every PSR and specialist modifier. Clan MechLab
   construction remains explicitly unsupported, even though fallback pilot
   skill defaults now use the proper technology base.
5. **Initiative and turn sequence (pp.10–12):** verify all simultaneous
   declarations, optional Segmented Fire, unit destruction mid-phase, large
   uneven armies, and every End Phase action.
6. **Victory (p.12):** implement/verify the stalemate-draw condition and
   simultaneous last-'Mech destruction.

## Completion gate

A heading may become `verified` only when every requirement referencing
that exact parent heading is itself `verified`, its audit metadata records
source review and edge-case review, and every requirement has exact automated
test evidence. The updated registry test enforces this relationship, preventing
the former possibility of manually marking an incomplete heading `verified`.

Run: `npm run test:unit` and `npm run rules:coverage`. GitHub Actions runs
the new foundations tests under Node 24 and validates generated browser sources.

## Weapon and physical attack sequencing audit (pp.11–12)

The book requires **all previously declared attacks to resolve before phase
consciousness checks**, and those checks to occur **before deferred Piloting
Skill Rolls**. The engine previously checked consciousness immediately inside
`wound()`, which could mark a MechWarrior unconscious while other previously
declared shots were still unresolved. The phase resolver now defers these
checks until after all firearm or physical attack declarations have been
resolved, then runs consciousness checks followed by PSRs. Outside these
phases, immediate injury checks remain immediate. Four regression tests
cover firearm, physical, consciousness-before-PSR and out-of-phase injury.
This proves these ordering cases, **not** the entirety of either attack phase.
