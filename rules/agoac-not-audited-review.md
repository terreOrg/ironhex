# AGoAC targeted audit of four previously unreviewed requirements

Edition: CAT3500D (2018); references below are printed page numbers. Reviewed engine tree at `1d804a813bce00d29871bb3f1b77de573d17bfac`. This is a code/source review, not successful implementation or verification of the whole rulebook. The dependent PR must pass CI before the newly added test cases become confirmed.

| Requirement | Source pages | Finding | Status |
| --- | --- | --- | --- |
| agoac-001 | 3–5 | Scope, dice and scale, record-sheet sections and default pilot skill cases located and tested; introduction is an umbrella entry. Outstanding children and cross-references prevent certification. | tested_case |
| agoac-002 | 6 | Standard non-scenario deployment is absent. | known_missing |
| agoac-006 | 6–7; 30; 38; 40; 44 | Partial phase implementation, with unresolved attack staging, heat avoidance, and stalemate handling. | known_missing |
| agoac-033 | 11; 30; 35; 40; 44 | Destruction and removal from the playing area need separate phase-boundary semantics. | known_missing |

## Implementation evidence and acceptance tests

### agoac-001 — introduction
`packages/engine/engine.js` contains scale constants, dice, default skill data, and pilot damage handling; `apps/web/src/record-sheet.js` displays record-sheet state. Existing AGoAC tests cover explicit examples. Continue auditing each child and remaining interactions. No umbrella or parent-topic verification.

### agoac-002 — setup
`packages/engine/legacy-engine.js:reset` places four units at fixed interior coordinates. `Game.initiative` sets the movement phase, and `apps/api/src/operations.mjs:makeRuntime` substitutes roster data without a standard entry-edge selection. The current game can begin a scenario-like battle but does not model standard entry.

Required follow-up: map/force configuration, independent deployment initiative, winner's edge choice and opposite edge assignment, entry per declared movement mode, first-hex MP calculation (including terrain and facing), occupancy, unequal selections, save/restore and server validation. Distinguish standard deployment from explicit scenario deployment.

### agoac-006 — phase sequence
`Game.buildQueue` counts all surviving units, and `hold` consumes a selection. `resolveFire` stores declaration snapshots but mixes to-hit throws and damage processing; review the general p.6 summary together with the specific attack-staging requirement on p.30. `resolvePhysical` also handles special attacks before ordinary declarations, which needs an independent ordering audit. Do not change either until exact declaration and resolution invariants have tests. Heat avoidance for an unconscious pilot is missing from `heatPhase` (p.38); automatic restart below the threshold is a distinct rule. `Legacy.checkWin` recognizes elimination and mutual destruction but not the permanent no-movement/no-damage stalemate on p.7. Do not classify temporarily unconscious or overheated pilots as permanent stalemate.

Required follow-up: all to-hit results before hit-location/damage resolution, fully resolve each packet and critical before the next packet, immutable declared attacks despite same-phase damage, attacker/controller order, special-attack exceptions, consciousness/PSR and heat/end sequencing, permanent stalemate with symmetric and asymmetric counterexamples. Existing tests plus two new tests cover only surviving selections and elimination outcomes.

### agoac-033 — phase-end removal
`Game.wound`, `destroyLocation` and the inherited occupancy predicate use `dead` for both destruction and board presence. Damage processing must preserve declared attacks; the phase-end map removal rule is separately observable. The current renderer starts a collapse on `dead` and does not explicitly distinguish removal. Review the displacement/fall exceptions before changing this state model.

Required follow-up: destruction via sixth wound, cockpit/head, engine or CT; immediate fall/displacement consequences; same-phase occupied hexes and attack declarations; cleanup at each phase transition; snapshot restoration (including older saves); map/renderer removal without deleting historical record-sheet state. Do not enable stale attacks in subsequent phases.

No production code, rules scope, strict Quality Gate, or existing verified status was changed in this review.
