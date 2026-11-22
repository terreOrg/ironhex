# AGoAC Chapter 12: consolidated four-requirement gap audit

Source: Catalyst Game Labs *BattleTech: A Game of Armored Combat*, CAT3500D (2018), official printed pp.14–15 and 49, 54–55.
Original publisher PDF: https://static1.squarespace.com/static/5e5f11b6a6b48b3ae5c4ee36/t/5e69a64e3d430e6e35ad7fda/1583982189894/cat3500d+battletech+a+game+of+armored+combat+rulebook.pdf

Reviewed on 2026-11-22. This document is a **gap inventory and implementation patch**; do not label any of the remaining four requirements Verified until the exact combined patch and merged main CI, Browser E2E, Container Smoke, and main Sonar Quality Gate have all succeeded, and this review is reconciled to those results.

## agoac-182: weapon arcs / arm flipping

Printed p.14 specifies forward + appropriate side for forward biped arms, torso forward arc, leg arc following the feet. Printed p.15 requires rear-installed weapons to use only the rear arc, torso twists not to change leg arcs, and flipping arms to use the rear arc only when the **original** arms lack lower/hand actuators and no guns cross the arm-torso boundary. A turn cannot both flip arms and twist. The prior Game.arc sector masks already matched the six hex directions, but Game.twist / Game.flipArms could circumvent same-turn exclusivity by returning a toggle to neutral.

Fix: persist armArcMode='twist' or 'flip' for the **entire turn** once invoked, even if the toggle is undone. Reject opposite mode without changing state and clear the mode in End Phase. Preserve full backward compatibility for neutral and independent actions. Add 6-bearing arc matrix, legs/torso twist and split AC/20 checks plus toggle-order tests; amend the prior test that mistakenly allowed flipping off then twisting the same turn.

## agoac-183: compatible ammo, exact capacity and source-authoritative imports

Printed p.54: at least one ton per ballistic/missile weapon (half-ton bins permitted for Machine Guns), one critical slot per bin, per-ton shot counts from printed p.55 table, identical type bins need not be adjacent. The strict authored-design constructor already enforces per-weapon minimum mass and the shared pool correctly; the non-strict pinned MTF importer retains legacy source records. The **actual** pinned COM-3A MTF has two SRM 6 launchers fed from **one 15-shot ammo bin** (source: data/megamek/scenarios/COM-3A.mtf), and would violate the custom-design minimum if wrongly routed through strict validation.

Action: add a real pinned-MTF import -> construction -> two-weapon live Game firing regression that confirms both launches decrement one physical 15-round magazine to 13. Validate the equivalent edited custom design rejects with the p.54 minimum. Improve equipment-row diagnostics for custom ammo minimum errors so MechLab and Hangar both identify the offending weapon type rather than a generic equipment row. Do not modify or reassign the locked scenario map.

## agoac-185: complete record sheet

Printed p.54 Step 8 explicitly requires:
- Mech Data including name, tonnage and Walk/Run/Jump MP;
- full Critical Hit Table containing equipment, ammunition **shots per bin**, and rear-mounted '(R)' labels mandated by printed p.15;
- unused criticals marked 'Roll Again';
- all unused armor and structure circles blacked out, including the **rear armor** diagrams;
- Heat Data with installed sink circles and blank circles crossed out or extra circles drawn;
- no rounding of unallocated tonnage into spendable capacity.

The existing UI already contained header, critical slots, armor values, weapons table, bin table, heat sink circles and 0–30 Heat Data, but missed '(R)' on critical lines, shots **on ammo critical lines**, and graphical unused point markings. Build a general standard-biped 100t template of 3/31/21/21/17/17/21/21 internal points and display actual structure with remaining points crossed out. For torso armor partition the front and rear across **one shared template pool** of 2×structure, never two separate copies; show filled points vs crossed-out spare points for each, with actual legal limits still determined by the selected chassis. Critical weapon labels use '(R)' and ammo labels show current rounds per bin. Browser checks cover default actual Griffin CT structures (18/31), front/rear allocation 20/7, one 62-circle combined CT template, real 12 heat sinks, ammo rounds, invalid draft and an explicit rear-mounted weapon case.

## agoac-186: identical rejection and safe admission

The direct strict construction engine already handles mechanics, but API previously had an independent metadata schema check with bare 422 errors and the browser could crash opening malformed persisted projects. A forged custom battle setup could bypass the API's metadata-only restrictions.

Fix: one exported designSubmissionDiagnostics() shared by Hangar, MechLab, app loader and Game.configureSetupForces; covers required/long name, allowed keys, shape, equipment max length/rows, armor/rear shape, selectors and serialized size with field/page/reason. Engine mechanical diagnostics remain canonical. Dist and source synced; malformed saved design displays its refusal against a safe draft and disables both save and launch rather than silently accepting or crashing. The custom battle setup also rejects with an actual rule-specific reason before admitting a unit. Add API error parity, localStorage browser and direct battle-source checks.

## Release/acceptance boundary

The patch must be ONE code commit on a single branch containing engine, MechLab, API, source/dist assets, tests and this review. Do not change prior 18 Verified entries yet. Keep remaining four at tested_case until they can be independently certified on exact successful post-merge checks; parent Chapter 12 remains known_missing until all 22 are done. No Ch13, no production deployment. Immutable Scenario 3 map Desert #2 WEST + Grassland #3 EAST.

## 2026-11-22 post-review hardening in the same single commit

- Invalid saved MechLab metadata remains blocked until an actual editor change or explicit Griffin restore; a read-only **Проверить конструкцию** click cannot clear the rejection. Template restore also discards the corrupt stored draft. Chromium covers the original bypass and nested-invalid field.
- CAT3500D p.52: per-location armor and rear-armor fields must be nonnegative integers with permitted section names. Arrays, booleans, empty or numeric strings, fractions and unknown sections receive exact p.52 field reasons. Enforced by strict construction, Hangar 422, custom battle admission and editor. Trusted non-strict source MTF import is preserved.
- Pending children remain tested_case until the new exact SHA passes all required CI/Browser/Smoke/Sonar source checks.
