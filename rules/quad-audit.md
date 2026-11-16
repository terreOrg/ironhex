# Strict sequential audit: Four-Legged ’Mech (BMM p. 5)

**Cursor:** `bmm-p005-four-legged-mech`, index 1 of 352. The previous
`bmm-p005-mech` heading is verified as a **glossary term only**.
This quad heading is **known_missing** and must not be promoted while any
mechanic or exception below lacks a source-backed deterministic test.

## Reference coverage in the corrected sixth printing (2022)

The book defines a quad on printed p. 5, but its actionable rules are
distributed throughout the book. Cross-references here use printed page
numbers. This is an audit inventory, not copied rules text and not a claim
that gameplay support exists.

| Requirement | Printed pages | Missing behavior / test focus |
| --- | --- | --- |
| bmm-req-080 | 5, 6, 45 | Four legs with front/rear designation, proper internal sections and actuator slots |
| bmm-req-081 | 15, 17 | Sideways movement and terrain/MP charges, restrictions on rearward shifts |
| bmm-req-082 | 19 | Standing without normal PSR for an intact quad, damaged/two-leg exceptions |
| bmm-req-083 | 25, 83 | Normal torso twist prohibition and optional-quirk exception |
| bmm-req-084 | 26, 35 | Quad partial-cover handling for all four legs and standing in Depth 1 |
| bmm-req-085 | 30, 48 | Prone firing with all legs and undamaged hips, leg-mounted weapons |
| bmm-req-086 | 24, 25, 30 | Arcs and weapon location restrictions |
| bmm-req-087 | 33, 38, 39 | Quad hit/kick/punch tables, rear/front distinctions |
| bmm-req-088 | 38 | Backward kicking, hips and TN modifier |
| bmm-req-089 | 19, 45 | First, second, third and fourth lost-leg consequences |
| bmm-req-090 | 48 | Hip critical damage, movement and prone-firing penalties |
| bmm-req-091 | 53, 54 | Fall-avoidance PSR modifier only with intact legs |
| bmm-req-092 | 45, 65 | Side torso destruction and flooding disables corresponding *front* leg |
| bmm-req-093 | 67 | Directional building collision damage from sideways movement |
| bmm-req-094 | 83 | Optional directional turret mount and torso twist quirk interactions |

## Existing executable behavior

- `isBattleMechConfiguration('Quad')` correctly classifies quads as
  BattleMechs for p.5 terminology.
- `construct({...example, config: 'Quad'})` **rejects** a quad rather
  than interpreting it as a biped.
- The MTF importer distinguishes unsupported `Quad` from a non-BattleMech
  `Vehicle`. The hangar recognizes explicitly typed `Biped` MTF
  records while still refusing quad combat configurations.
- These safety checks are `tested_case`; they do not implement a quad.

## Blocking implementation surfaces

`packages/engine/construction.js` and the damage/critical tables require
four-leg-specific slots and structure mappings. `packages/engine/engine.js`
requires movement, standing, fall and physical-attack behavior.
`apps/api/src/mtf.mjs` and `apps/api/src/hangar.mjs` must admit genuine
supported quad designs only *after* the rules engine is correct.
The browser record sheet, market dossier, campaign snapshot and persistent
damage must preserve the quad chassis and locations. Tests must cover all
boundary cases and cross-system paths, then run through CI.

**Do not advance the cursor** until all fifteen specific requirements and
the umbrella requirement `bmm-req-070` are independently verified. The
earlier isolated verifications on printed pages 6 and 7 do not waive this gate.
