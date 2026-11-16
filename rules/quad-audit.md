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
| bmm-req-081 | 15, 17 | **Verified:** all four shifts, +1 MP, retained facing, backward walk-only, level/terrain/occupancy rules and explicit player command |
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

### Diagnostic critical persistence and repair topology

The internal-only `auditQuad:true` option is now threaded through
`normalizedCriticalDamage` and `damagedComponents`. It reconstructs
the **actual six slots** on a front or rear Quad leg, drops malformed
critical indices, and correctly identifies the hip actuator, jump jet
and leg-mounted weapon for damage persistence and repair planning.
`construct` supplies four leg actuator records for a diagnostic Quad
unit, so `applyCriticalDamage` can mark leg actuators, lost jump jets
and destroyed weapons rather than silently treating front legs as arms.
The public default path still rejects all Quad designs.

A deterministic test checks occupied/unoccupied slots, duplicate and
invalid critical indices, all four actuator maps, damage capture and
repair descriptors. This closes a previously untested persistence
portion of `bmm-req-080`. **The overall Quad topic stays open.**

### Combat-location vocabulary check (printed pp.5, 33)

The shared combat engine now prints **front/rear leg names** instead
of biped-arm names when resolving hit locations for Quad diagnostic
units. Regression tests check both Quad front-leg entries from the
printed Front/Rear column (2D6 rolls 4 and 11), and ensure Biped
arm names are unaffected. This validates the geometry-to-location
handoff for the current structural requirement, but does not certify
Quad-specific combat consequences such as leg destruction or
falling. Those remain separate known-missing requirements.

### Independent slot/armor boundary sweep

The structural suite now compares all seventeen standard 20–100 ton
leg-internal-structure values against an independent expectation list
instead of comparing the quad's four legs only against each other.
Each Quad leg must have exactly six critical slots (BMM printed p.6).
For every front/rear leg of a 55-ton test chassis, the constructor
accepts the maximum leg armor but rejects one point above the limit
and rejects placement in nonexistent critical slot seven. This is
still a validation of structural topology only.

## Verified atomic requirement: bmm-req-080

The **structural topology only** has been marked `verified` after
source and edge-case review against BMM printed pp. 5, 6, 19, 33,
45 and 49 and successful unit, browser, Docker and deploy checks
on commit `781ebca`. The test evidence covers all chassis mass
brackets, exact 6-slot leg critical footprints, leg-mounted equipment
bounds, leg-specific record sheets and hit report labels, critical
damage persistence, and explicit non-deployability of experimental
Quad chassis.

This does **not** verify any of the other Quad requirements. In
particular, lateral shift, standing/PSR, partial cover, firing while
prone, full hit/physical combat consequences and loss of legs remain
`known_missing`. The strict heading cursor stays at Quad until
every atomic requirement is `verified`.

## Next atomic requirement — lateral shift (bmm-req-081, BMM p.15)

Implemented as diagnostic-engine pathfinding only: an intact Quad can
move to any of its four diagonally adjacent side hexes without changing
facing, at the standard terrain/elevation entry cost **plus 1 MP**.
Backward-side shifts are permitted only while walking, and like
ordinary backward movement cannot change levels. Shift options are
removed if **any** of the four legs is destroyed. A pure helper
exposes legal shift actions; real pathfinding uses them and prefers
the unchanged facing on a legal, equal-cost shift. No biped receives
lateral movement. Source: printed p.15 diagram and Ground Movement
text, p.17 Movement Costs Table.

Three tests cover four directions, facing retention and execution,
walk-versus-run restrictions, height changes, heavy-woods terrain
costs and all four destroyed-leg variants. The parent Quad heading
remains `known_missing` until the complete Quad rule set is verified.

### Explicit player-selected lateral orders

Added a validated optional `lateral` field to server tactical
`move` commands, and a corresponding `Game.move(...,{lateral})`
path. This makes the four directions explicitly selectable even if
the default shortest-path algorithm prefers a facing change and a
different route. The command reuses normal phase/turn constraints,
movement budget, occupancy, terrain and elevation restrictions.
Input direction/destination mismatches, invalid strings, missing
legs and biped chassis are rejected.

Regression tests cover each of the four directions, walking and
running, explicit facing retention, rearward running denial,
no backward level changes, terrain/elevation MP surcharge,
occupied target hexes and command schema validation.

## Verified atomic requirement: bmm-req-081

BMM p.15 lateral-shift mechanics and p.17 movement cost have now
been independently compared to source and marked `verified`.
Implementation includes four directions with no facing change,
correct terrain and level surcharge, backward walk-only constraint
(no backward level changes), all-four-legs requirement, normal
turn/occupancy checks, and an explicitly selectable lateral tactical
order. Unit tests cover boundary, invalid and biped cases.
All four GitHub Actions checks passed for `2e93b1a`.

The Quad heading remains `known_missing`, with standing,
movement after leg loss, combat and remaining exceptions outstanding.

## Quad standing — first implementation (bmm-req-082, BMM pp.19, 44)

The tactical engine now distinguishes intact Quads from damaged
ones when standing: all four legs intact means no standing PSR;
one or more lost legs requires the usual PSR. With only two legs
remaining, a Quad receives just one attempt per turn and counts
as running; three lost legs block standing entirely. Standing
still costs 2 MP and generates 1 heat. The standard right to select
a new facing free of charge on successful standing is exposed as
an optional, strictly validated `facing` value in the server
tactical order.

Deterministic tests cover intact Quad versus biped, one/two/three
destroyed legs, repeated stand attempt denial, facing bounds,
heat, MP and PSR emission. This **does not** yet certify all PSR
modifiers or lost-leg speed effects (separate Quad requirements),
so `bmm-req-082` remains `tested_case`.

### Quad PSR modifiers feeding stand/fall logic

`Game.psrMod(u,fallAvoidance)` now distinguishes all four Quad legs
from the biped pair. Intact Quads receive the p.53 **-2 only when
making a fall-avoidance PSR**, not for standing or preventing pilot
injury in an already-occurring fall. A single destroyed Quad leg
does not acquire the biped +5 lost-leg PSR penalty; losing two legs
uses the biped one-leg equivalent; three legs the two-leg equivalent.
The PSR contributions of hip/upper/lower/foot actuator damage
include the front legs and ignore the destroyed leg's obsolete
actuators. Biped PSR math remains unchanged.

The standing test checks the exact 2D6 target after loss of a *rear*
leg, the case that previously inherited a spurious biped +5 penalty.
This is evidence for the standing requirement, but Quad movement
speed / catastrophic leg loss still need independent checks.

### Regression found in CI and corrected: lost rear leg blocked all standing

GitHub Actions on `426bb30` caught a failed standing test
(`Нужно 2 MP`). The root cause was the biped movement rule:
destroying either rear leg had set running MP to zero, even for
a quad with three intact legs. The Quad-specific movement branch
now applies BMM p.44: first lost leg reduces Walking MP by 1,
but running remains available; two lost legs produce 1 Walking
MP and no running; three or more lost legs give 0 ground MP.
The condition is symmetric for LA, RA, LL and RL. Biped movement
is retained in its independent branch.

Tests enumerate all four ways to lose the first leg and the next
loss thresholds. This is necessary groundwork for correct Quad
standing and other p.44 damage consequences; the subsection
remains `tested_case`, not certified until all relevant exclusions
and failure rolls are independently checked.

### Failed standing attempt edge case

A deterministic failed-PSR test for a Quad with exactly two
remaining legs verifies that the unit stays prone, does not get
the requested free facing, consumes exactly 2 MP and 1 heat,
takes the fall consequence, and cannot attempt another stand
during the same phase. This prevents treating the successful
attempt path as evidence for all standing outcomes.

### Minimum Movement stand (printed pp.16 and 19)

An explicit `minimum:true` tactical standing order now permits one
attempt by a prone mech with **exactly one available MP** (and no
previous MP spent/standing attempt), counted as running. This
exception does not allow standing with zero MP and does not bypass
the normal standing option when two or more MP are available.
The successful facing remains free; the option is schema-validated.
Tests cover one-MP Quad recovery after two legs destroyed, zero- and
two-MP rejection and single-attempt limitation.

### Corrected regression fixture and phase validation

The initial Minimum Movement test failed CI because a 55-ton,
55-rating engine includes only two integral heat sinks: the
test fixture now places all eight required external heat sinks.
This respects the construction rules instead of weakening
validation to make a test pass. Standing also rejects orders
outside the Movement Phase; the regression suite covers
initiative, weapon, physical and heat phases.

### Walking-versus-running declaration on a stand

The printed p.19 rule requires a mech starting prone to declare
Walking or Running movement before attempting to stand.
`stand(...,{mode:'walk'|'run'})` now preserves that declaration:
the chosen MP budget is enforced, movement type cannot switch
after it has already been selected, standing after a jump is
blocked, and running versus walking heat is charged correctly
when the movement selection completes. When absent, the existing
single-command UI chooses an allowed mode for backward
compatibility. For a two-legged Quad and minimum stands, running
is mandatory, so an explicit Walking declaration is invalid.
Validation and deterministic heat tests cover all cases.

### Quad torso-twist and arm-flip fail-closed guard

The combat action now rejects Quad torso twist commands (including
zero-angle twist orders), and forbids flipping front legs as biped
arms. The AI's fire search also restricts a Quad to zero twist.
The standard biped twist remains available; fractional twist values
are now rejected for both chassis. This is the standard, non-quirk
case only: qualifying optional torso-twist quirks are **not yet
implemented**, so bmm-req-083 and bmm-req-094 remain open.

### Explicit Extended Torso Twist quirk (BMM pp.25, 30, 83)

A Quad now accepts a one-hexside torso twist only with the explicit
unit flag `quirks.extendedTorsoTwist === true`. Standard Quads still
reject twist orders. The same flag permits a biped to twist up to two
hexsides; without it the existing one-hexside limit remains.
Quad front and rear leg-mounted weapons retain their original firing
arcs while torso weapons follow torso twist. The AI respects the same
limits. Tests cover absent/false/true flags, invalid twist magnitudes,
biped compatibility, leg arcs and torso arcs. Directional Torso Mount
remains unimplemented, so full optional-quirk coverage is still open.

### Quad front-leg firing arcs, verified against pp.24–25

A targeted code review found that earlier Quad arc support froze the
front legs when the torso twisted but still granted them biped **arm**
side arcs, incorrectly allowing front-leg weapons to shoot around the
flank. The new arc calculation explicitly identifies biped arms and
treats **all four Quad limbs** as legs. Front-mounted leg weapons use
only the forward arc; rear-mounted leg weapons use only the rear arc.
A Quad's torso twist (only when its optional Extended Torso Twist
quirk is enabled) shifts torso weapons but **never** leg weapons.
Biped left/right arm side arcs are unchanged. A deterministic regression
enumerates the four legs and all forward, left, right, and rear firing
directions, plus rear-mounted weapons and the optional torso twist.
The first known case of this bug existed despite previously passing
tests which only checked that an arc did not *change* upon torso twist.

Two subrequirements `bmm-req-083` and `bmm-req-086` are now
`tested_case`, not `verified`; directional torso mounts and
complete battle integration are not certified. The sequential
cursor remains at `bmm-p005-four-legged-mech`.

### Four-legged partial cover and Depth 1 water (printed p.26)

All Quad front/rear limb locations now count as legs for partial
cover, including a standing Quad in Depth 1 water. For a shot from
above water, a leg result hits the cover instead; from under water
toward a standing Depth 1 target, only leg hits penetrate. The same
rule controls aimed-location validation and underwater leg weapon
classification; biped arm behavior remains unchanged. Tests verify
all four Quad leg codes and explicit under/over-water hit results.

`bmm-req-084` remains `tested_case`, **not verified**, because
separate Quad hit-location tables (`bmm-req-087`) and physical-attack
partial-cover interactions (printed p.35) still need full integration.
The current combat table used in isolated tests is an existing engine
table and is not presented as an authoritative Quad hit-location table.

### Quad hit-location tables (printed pp.33, 38–39)

The ordinary 2D6 BattleMech Hit Location Table on p.33 labels each
entry **Biped (Four-Legged)**: the numeric locations are shared;
arm-location rows on a Quad denote front legs and regular leg rows
denote rear legs. A separate 2D6 quad-normal table is *not* invented.
The 1D6 Punch and Kick Location Tables on pp.38–39 **do have**
four-legged columns. These are now implemented as explicit
`QUAD_PUNCH_LOCATIONS` and `QUAD_KICK_LOCATIONS` mappings for
left, front, rear and right attacks, including correct differences
between a hit from the front versus a hit from the rear.

A deterministic test exhaustively checks all 44 standard (2D6
side/roll), 24 Quad punch and 24 Quad kick results (92 combinations),
and checks biped physical-table regressions. This is
`bmm-req-087: tested_case`, not verified: physical attack declaration
constraints, cover interactions, rear kicks and critical-hit
resolution require independent integration tests.

### Quad backward kicking (printed p.38)

Quad kicking now accepts both front legs in the forward arc and
both rear legs in the rear arc. It checks *both* corresponding hip
actuators, the selected leg's weapon fire, terrain elevation, and
applies the p.38 **+1 Target Number** modifier to a rear kick.
For side effects it resolves the p.38 Quad Kick Location Table already
added to the hit-location engine. The AI considers four-legged
forward and backward kick choices. Quads are explicitly barred from
punching, pushing or club attacks requiring biped arms.

The focused regression covers front and rear targets, all four
candidate legs, the +1 TN differential, damage and location table,
damaged front/rear hip pairs, leg-weapon fire, and biped compatibility.
The status of `bmm-req-088` is `tested_case`, **not verified**
pending an end-to-end physical phase, fall PSRs and detailed rear-arc
critical/flooding interactions.

### Side-torso loss and flooding (printed pp.45,65)

The existing side-torso transfer implementation was checked with
a new deterministic Quad audit fixture. Losing LT or RT destroys the
matching **front** leg (LA or RA), but does not damage the same-side
rear leg (LL or RL). Flooding a side torso likewise disables the
front leg and its contents, while leaving the rear leg operational;
flooding does not erase structure as destruction does. A biped
retains its standard arm-loss behavior. The tests cover **both**
sides and both destruction and flooding.

`bmm-req-092` is `tested_case` rather than fully verified because
the separate quad lost-leg fall and movement consequences still need
a full phase-level audit (bmm-req-089), including removal while prone.

### Quad prone fire (printed pp.30, 45, 48)

The combat preview/declaration pipeline now implements the p.30
exception: a prone Quad with all four functional legs and no hip
critical damage fires with **no +2 prone modifier** and can fire
from each of its four leg-mounted weapon locations. There is no
biped arm-bracing requirement because Quad front legs are not arms.
The predicate checks structure, actuator damage, the critical-slot
record and flooding, avoiding a mismatch after restoring persistent
damage. Losing a leg or suffering a hip critical removes the
exception: torso-mounted guns use the ordinary +2 prone modifier
and leg-mounted guns are no longer available while prone. Biped
prone penalties and bracing behavior remain unchanged.

Tests compare standing and prone TNs for all four leg locations,
confirm actual weapon declaration, enumerate damage to each hip,
test destroyed/flooded legs and saved hip critical slots, and check
biped regression. Requirement `bmm-req-085` is **tested_case**
until full quad physical/damage round-trip certification.

### Quad hip criticals (printed p.48)

The critical-hit resolver now treats **all four** quad legs as leg
locations for phase-end Piloting Skill Rolls. Previously, a hip
critical in LA or RA updated the actuator flag but failed to enqueue
the required PSR because the handler recognized only LL/RL.
The corrected rule uses chassis-aware leg classification and
preserves the original biped behavior. A deterministic integration
test forces a hip-slot critical in each of the four legs, one by one,
checking the slot and actuator damage, queued PSR, remaining Walking
and Running MP, and loss of prone firing bonus.

One, two and three Quad hip criticals reduce Walking MP from 5 to 3
(and Running MP from 8 to 5), while **all four** reduce both to zero
without treating the Quad as immobile (BMM p.48). Full critical
damage timing, new criticals in the same leg, and advanced mobility
interaction remain unverified, so `bmm-req-090` is `tested_case`.

### Immediate fall on Quad leg destruction (printed pp.44–45)

A previously missing effect is now triggered directly in
`Game.destroyLocation`: destruction of **any** of the four Quad
legs immediately knocks a standing Quad prone and resolves the
usual falling damage. This is not a deferred PSR. A Quad that
was already prone does **not** fall again. Side-torso destruction
recursively removing its front leg triggers the same single fall;
a per-section idempotency record prevents double application
when damage transfer touches an already destroyed section.

Movement is blocked for the remainder of the current Movement
Phase (including attempted stands), and the block is reset for
the next round. Deterministic tests exercise all four legs,
idempotent re-destruction, prone leg loss, the first-loss MP
reduction, and a real fall from LT removal.

`bmm-req-089` remains `tested_case`: additional cases for
two/three/four leg losses, jumping after losing a leg, immobility
when all four are lost and phase-edge collision timing are still
required. The strict sequential cursor does not advance.

### Four destroyed legs versus four hip criticals (printed pp.45,48)

A Quad becomes **immobile** specifically on destruction of
all four legs. The distinction is mechanically significant:
a Quad with three destroyed legs has 0 ground MP but is
not immobile, and a Quad with four hip criticals also has
0 MP but is **not** immobile. These three states now differ
in ranged target-movement modifiers and whether attackers
may declare aimed shots against an immobile target. The
engine retains `mobile(u)` for a conscious operational
unit so an immobile Quad is not erroneously barred from
weapon fire. A regression test covers 0..4 lost legs, the
four-hip case, a biped with two lost legs, and the actual
aimed-shot declaration pipeline.

`bmm-req-089` remains `tested_case` while other
leg-loss effects and combined pilot rolls are audited.

### Jumping after loss of a Quad leg (printed p.45)

Landing from a jump now checks the special **+5 PSR modifier**
for a Quad with exactly one destroyed leg, regardless of which
of the four legs was lost. A normal intact Quad does not acquire
this extra landing roll. With two lost legs, the inherited one-legged
biped-equivalent PSR modifier is already +5, so the new rule does
**not** double-count it to +10. The modifier is applied to water
landings as well as ordinary landings.

A deterministic movement-phase test uses a valid Quad with a
torso-mounted jump jet and 2D6=8, checking that intact landing
succeeds without a new PSR, either front or rear missing-leg
landing fails against TN10, and two-leg loss does not double
count. `bmm-req-089` remains `tested_case`.

### Quad fall-avoidance PSR -2 (printed p.53)

Added a deterministic end-to-end PSR timing and target-number
matrix beyond the existing pure modifier checks. An intact Quad
with Piloting 5 avoids a fall on 3+, not 5+. Losing any one leg
removes this -2 bonus, so 4 fails and 5 succeeds; a hip critical
on an intact Quad raises the effective target back to 5. Biped
PSRs remain unchanged. The deferred end-of-phase PSR path is
also covered, including the removal of the -2 benefit after
destroying a leg. `bmm-req-091` is `tested_case` pending
full GitHub CI confirmation, not prematurely `verified`.
