# AGoAC Chapter 11 — Scenario 3 source precedence

The 2018 CAT3500D book, printed p. 47, contains a known map typo: its GAME SET-UP text specifies **Desert #3 + Grassland #3**. That is *not* the authoritative scenario after the official corrections.

Official Catalyst **AGOAC Errata v8.01**, p. 5 (17 September 2023), explicitly replaces Desert #3 with **Desert #2**, preserving Grassland #3:
https://battletech.com/wp-content/uploads/2025/06/64_A-Game-of-Armored-Combat-2023-09-17-v8.01.pdf

The current publisher-hosted **2025 SLDF edition** independently prints **Desert #2 + Grassland #3** in both scenario setup and figure:
https://battletech.com/wp-content/uploads/2025/07/BattleTech-A-Game-of-Armored-Combat-Rulebook-1st-SLDF-Print.pdf

Implementation invariant: source and dist manifest must select the corrected west/east sheets; the 32×17 composite contains 272 source hexes from each sheet, with original printedSheet identity and pinned MegaMek source revision. The API scenario-start regression tests both roster sizes and the corrected sheet names.

**Remaining limit:** exact die-cut counter placement from the scenario figure is still manually attested. This note does not certify those coordinates or upgrade `agoac-150` / `agoac-151` / `agoac-154`; all remain `tested_case` pending independent source evidence and full three-account browser verification. No Chapter 12 and no deployment.
