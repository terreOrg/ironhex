# AGoAC Chapter 12 — source-to-engine certification, 2026-11-22

**Original source:** Catalyst Game Labs, BattleTech: A Game of Armored Combat, CAT3500D (2018), Construction printed pp.49–55, official PDF:
https://static1.squarespace.com/static/5e5f11b6a6b48b3ae5c4ee36/t/5e69a64e3d430e6e35ad7fda/1583982189894/cat3500d+battletech+a+game+of+armored+combat+rulebook.pdf

**Scope:** Inner Sphere, basic biped BattleMech construction, no advanced/Clan/Quad rules. The 2026-11-22 evidence below documents the first 18 independently certified requirements; the 2026-11-23 final certification section below supersedes its earlier open-gap status. Chapter 12 is now verified, Chapter 13 is not audited.

## Evidence: identical tested and merged trees

- Source-checked and tested PR head: 4dd7073ccd1dde7892c9d9b517ec8ead194bb40e; tree 00f7c69e7e955e6a88d68daba94f3f82067a62d8.
- Merged main: 3e38d19afe5eb3b739c202feeafeb917844ecb33; IDENTICAL tree 00f7c69e7e955e6a88d68daba94f3f82067a62d8.
- CI 45063730458 / job 137335155579: success (671 passing, 0 failing).
- Browser 45063730554 / job 137335242499: success.
- Docker/PG smoke 45063730459 / job 137335159177: success.
- Merged main: CI 45064863880 / 137338650902, Browser 45064863829 / 137338650650, Smoke 45064863911 / 137338651046, Sonar Quality Gate 45064863816 / 137338650851; all success. Main CI reuses the matching parent's test results, rather than repeating all 671 tests.
- Engine source: packages/engine/construction.js and packages/engine/equipment.js; generated dist copies verified synchronized in CI. Independent named cases: tests/agoac-ch12-design-gates.mjs, tests/construction.mjs, tests/market.mjs.
- Source book scanned visually at PDF pages 50–56 (printed pp.49–55); no inferred optional rules.

## Independently checked source requirements and edge cases

| ID | Printed page | Code and acceptance evidence |
|---|---|---|
| 165 | 49–50 | Standard mass 20–100t, 5t increments; all invalid boundaries rejected; internal structure weighs 10% |
| 166 | 50 | All 17 structure table rows match printed CT/side/arm/leg values; immutable allocation; head 3 |
| 167 | 49 | Mandatory head systems, gyro/engine and limb actuators reserve exact critical slots; correct 1/2/12/8/2 open counts |
| 168 | 49 | Critical placement is atomic, contiguous and collision/overrun protected; split AC/20 separately audited |
| 169 | 49,51 | Hand may be removed alone; lower arm removal also removes hand; shoulders and upper arms remain; malformed settings rejected |
| 170 | 51–52 | Engine rating = tonnage × walk; all 77 printed engine mass table entries (ratings 20–400 in steps of 5) compared with engine literal: ZERO discrepancies. Boundary engine ratings and mass checks pass |
| 171 | 51 | Running MP = ceil(1.5 × Walking MP), independent of Jump MP, propagated into constructed unit |
| 172 | 51 | Each jet adds 1 Jump MP; jump cannot exceed walk; mass per jet 0.5t for 20–55, 1t for 60–85, 2t for 90–100; all band boundaries checked |
| 173 | 51 | Jet count must equal Jump MP, each consumes one open torso/leg critical; head and arms rejected |
| 174 | 52 | Gyro tonnage is ceil(engine rating/100), exactly four reserved CT criticals |
| 175 | 52 | Cockpit mass exactly 3t, fixed head slot and both sensor/life-support reservations |
| 176 | 51–52 | Head armor ≤9, other sections front+rear ≤2× internal structure, including torso rear allocation |
| 177 | 52–53 | Armor is 16 points/ton, rounded UP to half-ton blocks of eight points; unallocated points grant no extra protection |
| 178 | 53 | Ten sink units have zero mass, each additional unit 1 ton; integral critical-free engine capacity is floor(rating/25) |
| 179 | 53 | Non-integral sinks cost one individual critical slot anywhere legal; missing count and occupied slots rejected |
| 180 | 54–55 | ALL 17 base energy/ballistic/missile rows checked entry-by-entry for heat, damage, minimum, three ranges, mass, critical slots and ammunition: 17 exact matches. Hatchet uses chassis-based tonnage and required arm location; strict engine excludes non-book equipment; registry guns also tested through live Game fire |
| 181 | 54 | Split permitted only for AC/20 in legal adjacent non-leg locations; allocated slots total 10, invalid splits rejected, torso arc restriction verified in actual Game preview, declaration and resolution |
| 184 | 54 | Full 1t bins and 0.5t machine gun bins, one slot each; shots integral and finite, invalid bins no phantom weight; shared ammunition spent in live battle |

Source-to-code checks are corroborated by the already-passing, named requirement tests. Compared values derive from the publisher's PDF, not from generating an expected list from the implementation.

## Final independent source/edge certification, 2026-11-23

**Baseline remains unchanged:** the previously verified 18 construction rules (165–181 and 184) are corroborated by the prior source review above. The four additional rules below were compared directly with the publisher PDF screenshots and code, not merely promoted because the CI is green.

| ID | Printed source | Code path and independent acceptance |
|---|---|---|
| agoac-182 | pp.14–15; p.54 | `Game.arc`, `Game.twist`, `Game.flipArms`: six real hex directions, torso forward/side/rear distinctions, flipped arms, leg arc unaffected by twist, rear-mounted weapons and split AC/20 restrictive torso arcs; cannot evade same-turn flip/twist exclusivity by returning the switch to neutral; resets at End Phase. Named independent source-linked `tests/agoac-ch12-design-gates.mjs` and `tests/agoac-foundations.mjs` cases. |
| agoac-183 | pp.54–55 | `construct(...,{strictAgoac:true})` requires one ton of ballistics/missile ammunition per newly constructed weapon (0.5 t Machine Gun bins permissible), legal slots and finite table-derived shots. The original pinned `data/megamek/scenarios/COM-3A.mtf` remains a trusted historical source imported without new-build strictness: two SRM6s fire successfully from the same 15-shot bin and leave 13; this stock-only exception is explicitly **not** a book-legal construction claim. `tests/market.mjs`, `tests/construction.mjs` and actual `Game` fire tests. |
| agoac-185 | p.54 Step 8; p.15 rear `(R)` | The live MechLab sheet uses canonical construction data: name, mass, MP, criticals, labels, ammo shots per bin, unused slots `Roll Again`, unused armor/structure points including rear torso, 0–30 heat scale and heat sink data, and wasted unused weight. The shared front/rear torso diagram never double-counts the template's 2×structure capacity; `tests/browser.mjs` asserts actual rendered circles and actual Griffin values. |
| agoac-186 | pp.49–55 | Uniform typed field/page reasons and strict admission throughout `designSubmissionDiagnostics()`, `construct()`, MechLab, authenticated Hangar (HTTP 422), saved localStorage design and custom battle setup. Source-only stock MTFs unaffected. Review specifically closes prior malformed armor array/object coercion and the Check-button invalid-draft bypass, with named browser and `tests/market.mjs` regressions; invalid configurations cannot save or launch. |

### Exact immutable code and successful gating evidence

- Source-checked PR #291 branch head: `51a54380bfaeac7d85511d236d49db4f06a231df`; squash-merged `main`: `f17526102169608480686e5e34e6742d28784c49`. **Both have exactly identical tree** `59840fda24afc07e65e7d4cb817e527f7a408940`; no deployment.
- PR branch CI #45072565945, Chromium #45072565934, Container #45072565952: all passed.
- Merged `main` CI #45073556998: **678 passed, 0 failed**, source/dist synchronized.
- Merged `main` Chromium E2E #45073557010: **52 passed, 0 failed**, including Chapter 12 technical-sheet and invalid-save flows.
- Merged `main` Container/PG Smoke #45073556988: **success**, including live PostgreSQL hangar, market, auth, scenario and ammunition integration.
- Merged `main` SonarQube #45073556971: **Quality Gate PASSED**, 92.0% new-code coverage (80% minimum), 87.4% overall coverage (80% minimum); CI recorded zero outstanding issues.

**Certification:** All 22/22 atomic requirements and parent `agoac-construction` meet source/edge/gate criteria. Chapter 12 `Verified`. The chapter 13 pointer `agoac-equipment` remains `not_audited`; pointer advancement is not authorization to work on it. Scenario 3 board remains immutable: Desert #2 **WEST**, Grassland #3 **EAST**. No production deployment.
