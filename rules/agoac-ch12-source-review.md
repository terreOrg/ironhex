# AGoAC Chapter 12 — source-to-engine certification, 2026-11-22

**Original source:** Catalyst Game Labs, BattleTech: A Game of Armored Combat, CAT3500D (2018), Construction printed pp.49–55, official PDF:
https://static1.squarespace.com/static/5e5f11b6a6b48b3ae5c4ee36/t/5e69a64e3d430e6e35ad7fda/1583982189894/cat3500d+battletech+a+game+of+armored+combat+rulebook.pdf

**Scope:** Inner Sphere, basic biped BattleMech construction, no advanced/Clan/Quad rules. The Chapter 12 heading remains known_missing while four atomic requirements remain unverified.

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

## NOT YET Verified: four independent gaps

- agoac-182: full forward/rear arc matrix for torso, head, legs, arms and flipped-arm interactions needs exhaustive source/engine/UI review.
- agoac-183: verify strict custom-built minimum ammo versus source-authoritative legacy COM-3A shared SRM magazines and complete compatibility/persistence.
- agoac-185: final record sheet completeness including heat scale/circles, front/rear armor and structure diagrams, individual ammo and component slots remains insufficiently audited.
- agoac-186: equivalent diagnostics and refusal across MechLab, authenticated Hangar API, direct engine battle launch for all invalid categories remain insufficiently audited.

No topic-level certification before every child is Verified. No Chapter 13, no deployment, and immutable Chapter 11 Scenario 3 Desert #2 WEST + Grassland #3 EAST.
