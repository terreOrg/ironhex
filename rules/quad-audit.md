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
| bmm-req-080 | 5, 6, 33, 45 | **Tested subset:** separate four-leg structural map and actuator slots; genuine quad record sheet, MTF import and battle construction still blocked |
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

## First atomic implementation: four-leg structural layout

The constructor now exports `QUAD_LEG_LOCATIONS` and
`quadStructuralLayout(tonnage)`: Left/Right Front and Rear Leg map to
legacy slot keys LA/RA/LL/RL, each with leg internal-structure allocation,
six critical slots, and hip/upper/lower/foot actuators (never a biped
shoulder/hand). Tests iterate the full 20–100 ton standard chassis range,
check slot sizes, compare a 55-ton quad front leg with a biped arm, and
reject invalid masses.

`construct({config:'Quad', ...})` returns a **rejected** design together
with an inspectable `quadLayout` for audit. It does not supply a playable
unit or import/sell a quad. This is `tested_case` for bmm-req-080,
**not verified**: weapon installation, integration with critical hits,
MTF parsing, record sheets, and movement remain missing.
The strict cursor remains at `bmm-p005-four-legged-mech`.

### Audit-only constructor integration

`construct(config,{auditQuad:true})` now builds a **non-deployable
diagnostic unit** with the correct quad front/rear leg structure, slots
and critical arrays. This deliberately requires an explicit internal
flag. Ordinary `construct(config)` still rejects quads, and
`validateDesign`, MTF import, the market and campaign continue to
deny them. Tests cover the blocked normal path, internal structure
(55 ton comparison), a front-leg weapon's actual location, no biped
arm-actuator removal and rejection of hatchets in front legs.

This does not verify bmm-req-080 yet because the normal game engine,
records, damage and campaign do not support the design.

### Quad leg hardpoint validation

The diagnostic constructor now treats both front legs as true legs
for standard jump-jet placement (see BMM p.19 example of leg-mounted
jets). Unlike a biped, it can mount a standard jump jet in slot 5 of
LA or RA; the rear legs LL and RL keep the same rule. Conversely,
quad front legs **cannot** be exploited as biped arms for split
torso/arm weapons. Deterministic tests cover all four legs, a
biped-arm rejection and a split-weapon rejection. Normal quad
deployment remains disabled; `bmm-req-080` is still `tested_case`,
not fully verified.

### Diagnostic record-sheet adaptation

The browser record sheet now detects the chassis configuration and
displays four **separately drawn** leg sections for Quad:
Left/Right Front and Left/Right Rear. It labels the critical-slot
tables and damage-transfer hints as legs and exposes the configuration
as a diagnostic-only layout. The original biped diagram and labels
remain unchanged. A Node regression test renders both a quad
diagnostic sheet and the existing Griffin-style biped sheet.

This is still not evidence of playable Quad movement, firing arcs,
critical-hit locations or combat persistence. The quad remains
blocked from ordinary constructor and market paths.
