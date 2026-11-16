# Classic BattleTech — BattleMech-only rule compliance ledger

## Frozen ruleset

- Baseline: **BattleTech: A Game of Armored Combat (2018)**.
- Optional supplement: **Tactical Operations: Advanced Rules**, corrected **fourth printing (2020)**, section and printed page numbers below.
- Not selected: the **2026 Core Rulebook**, Alpha Strike, vehicle-only, ProtoMech-only, infantry-only, aerospace-only and naval-only rules.
- This file is a **tracking/audit artifact, not a claim of full conformity**. The source PDF is user-supplied and is not copied into this repository.
- Per the supplement's **Choose Your Rules** section (printed p. 9), its advanced rules are **optional** and can be enabled independently. IronHex therefore must not force them into an AGoAC match or silently infer that a player has enabled all of Tactical Operations.

## BattleMech-relevant sections and status

The references are *printed page numbers*, not the PDF viewer's page offsets.

| Book section | Printed pages | Engine status | Next conformance work |
|---|---:|---|---|
| Standing Still (Expanded) | 16 | **Implemented, optional** | -1 against a target that spent **zero MP**, unless immobile |
| Sprinting / MASC / superchargers | 16 | **Not implemented** | 2× Walking MP; 3 running heat; no deliberate attacks; -1 against sprinting unit; forbidden backward/water; +2 PSR, optional MASC rules |
| Evading (base) | 16–17 | **Implemented, optional** | Running MP; both hips; no attacks/spotting; +1 defensive modifier, absent when prone; 4 heat |
| Skilled Evading | 17 | **Not implemented** | Variable defensive benefit by Piloting skill |
| Shielding | 17 | Not implemented | Protected hex geometry, missed-shot interception and 2-level height restrictions |
| Physical Defense / Crawling | 18 | Not implemented | Special phase timing, movement/PSRs, attack limitations |
| Hurried Movement / Hull Down | 18–20 | Not implemented | MP trade-off for piloting checks; positioning and eligible quadrupeds |
| Expanded backward / climbing / leaping | 19–20 | Not implemented | Explicit paths, PSR and height checks |
| Skidding, fumbles, falls, leg damage | 21–22 | Partial **base** mechanics only | Advanced optional dice/PSR modifiers and falling outcomes |
| Planetary terrain and conditions | 26–66 | Partial **base** weather/terrain only | Exotic terrain, fire, smoke, gravity, weather, atmosphere, expanded tables |
| Critical damage and called shots | 72–77 | Partial basic mechanics | Expanded critical rules, floating criticals, engine explosions, LOS dead zones |
| Glancing/direct blows, missed shots | 78–81 | Not implemented | Per-attack calculation, scatter/impact, edge cases |
| Advanced firing / partial cover | 82–86 | Partial basic mechanics | Opportunity fire, partial cover per expanded charts, specialized firing |
| Physical combat and throwing | 86–97 | Partial standard attacks | Physical defense weapons, special attacks, carrying/throwing, interrupts |
| Specialized weapon/ECM/AMS options | 97–102 | Not implemented | Equipment dependent on the separate *Advanced Units & Equipment* volume |
| Advanced heat | 102–105 | Not implemented | Avoid shutdown, coolant rerouting/failure and related consequences |
| Advanced buildings affecting BattleMechs | 112–140 | Partial basic structures | Construction, movement, collision, collapse and damage interactions |
| Minefields / rearming under fire | 175–182 | Not implemented | Minefield types and detonation; limited tactical resupply |
| Morale, fatigue, unit capture | 166–185 | Not implemented | Pilot / crew and mission behavior |
| Concealed information / double blind | 187–193 | Not implemented | Per-player state, visibility and spotting; hidden deployment |
| Artillery / infantry / vehicles / aerospace | various | **Out of scope** | BattleMechs only; battlefields may still need indirect effects where applicable |

## Implemented optional rules: conformance criteria

### TO:AR p. 16 — Standing Still (Expanded)
- Option ID: `tacticalOptions.standingStill`.
- A moving-capable BattleMech that **expends zero MP** during its Movement Phase receives a **-1** to opponents' to-hit numbers for both weapon and physical attacks. Do not apply to an *immobile* unit (use its immobile modifier alone).
- Only *expenditure of MP* counts, not hex displacement: a BattleMech that pivots in place spent MP and receives no penalty.
- Disabled by default in AGoAC. Applies regardless of chosen weapon if enabled.

### TO:AR pp. 16–17 — Evading (basic option)
- Option ID: `tacticalOptions.evading`. Select the **Evading** movement mode during Movement Phase. Must have **both operational hip actuators**.
- Maximum MP is Running MP; no backward movement and no water at depth 1 or deeper (normal running limitations).
- Evading incurs **two extra heat** beyond normal running (total four for a standard BattleMech), added on confirmation of the Movement order.
- Enemy attacks against an evading BattleMech get **+1 target number** in addition to normal target movement modifiers. The +1 disappears if it falls prone.
- An evading BattleMech cannot make weapon or physical attacks or spot for indirect fire. Spotting is not presently exposed by the engine.
- **Skilled Evading** is a separate optional rule; its bonus table is **not implemented**.
- MASC and supercharger options are not currently available and require an independent source and full system rules.

## Deployment and test invariants

- A new quick battle and a newly launched authenticated operation start with both options **false**.
- The quick-battle user or an authenticated operation owner may set either option in the **first Initiative Phase**, before the first turn. Server-side orders are schema-validated and locked after that point.
- Each rule option is persisted in the battle snapshot, not in the commercial inventory or configuration.
- The unit-level test suite is `tests/tactical-operations.mjs`. Standard tests must verify the options are disabled by default and that legacy scenarios are unaffected.
- Progress on all other sections must remain listed as **not implemented** or **partial** until there is explicit source-backed regression coverage.

## Other books still needed

For the chosen *pre-2026 BattleMech-only* scope, continue to request the relevant printing/errata of **BattleMech Manual**, **TechManual** and **Tactical Operations: Advanced Units & Equipment**. Advanced chassis construction, double sinks, XL/XXL engines and electronic-warfare components should not be sold until their full source rule chains are verified. **Interstellar Operations: Alternate Eras** is needed only for BattleMech era-specific and experimental technology if the user chooses to include it. For advanced campaign economy (repair, procurement, maintenance), the current C-Bills values remain IronHex-specific and should be labeled as such until **Campaign Operations** is audited.
