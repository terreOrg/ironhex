# AGoAC Chapter 11 — Scenario 3 source precedence

The 2018 CAT3500D book, printed p. 47, contains a known map typo: its GAME SET-UP text specifies **Desert #3 + Grassland #3**. That is *not* the authoritative scenario after the official corrections.

Official Catalyst **AGOAC Errata v8.01**, p. 5 (17 September 2023), explicitly replaces Desert #3 with **Desert #2**, preserving Grassland #3:
https://battletech.com/wp-content/uploads/2025/06/64_A-Game-of-Armored-Combat-2023-09-17-v8.01.pdf

The current publisher-hosted **2025 SLDF edition** independently prints **Desert #2 + Grassland #3** in both scenario setup and figure:
https://battletech.com/wp-content/uploads/2025/07/BattleTech-A-Game-of-Armored-Combat-Rulebook-1st-SLDF-Print.pdf

Implementation invariant: source and dist manifest must select the corrected west/east sheets; the 32×17 composite contains 272 source hexes from each sheet, with original printedSheet identity and pinned MegaMek source revision. The API scenario-start regression tests both roster sizes and the corrected sheet names.

**Remaining limit:** exact die-cut counter placement from the scenario figure is still manually attested. This note does not certify those coordinates or upgrade `agoac-150` / `agoac-151` / `agoac-154`; all remain `tested_case` pending independent source evidence and full three-account browser verification. No Chapter 12 and no deployment.

Server-side persistence lock: `apps/api/src/scenario-room-match.mjs` now validates both named source sheets (west `Desert #2`, east `Grassland #3`), 32×17 board, 544 hexes, 272 per sheet and every `printedSheet` marker on **both capture and restore**. The independent room regression rejects obsolete `Desert #3`, reversed sheets, swapped sides, forged tile metadata and missing hexes; an intact source map still round-trips. This is a safety assertion, not a claim that the unresolved printed die-cut counter illustration has been fully certified.

PG three-account smoke: `tests/scenario-rooms-integration.mjs` covers real HTTP authentication, three consenting room roles, full and shortened source map starts, signed/serialized version authority and fail-closed GET snapshot on obsolete Desert #3 JSONB. This strengthens `agoac-154` but does not certify all combat phases in a true three-device browser test or the illustrated terrain-counter coordinates. Keep `agoac-150/151/154` as `tested_case`.
