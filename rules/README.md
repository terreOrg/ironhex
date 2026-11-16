# BattleMech Manual rules audit

**Source:** *BattleTech: BattleMech Manual*, corrected sixth printing (Catalyst Game Labs, 2022), supplied as a PDF to the project. Page numbers use the book's **printed** pagination, not zero-based PDF page indexes.

## What is tracked

- [`battlemech-manual.json`](battlemech-manual.json) — **352 headings and subheadings** verified from the rulebook's table of contents (printed pp. 2–3; 326 extracted automatically and 26 headings restored manually), each with a stable `bmm-pNNN-slug` identifier, printed page, topic group, optional flag and status.
- [`battlemech-manual-requirements.json`](battlemech-manual-requirements.json) — **24 initial individual requirements**, including 18 linked to existing named automated tests and 6 known missing mechanics. This will grow into a paragraph/exception-level specification.
- [`tests/rules-registry.mjs`](../tests/rules-registry.mjs) — checks identifiers, referenced files and **exact test names**, parent/child consistency, status integrity and the reporting baseline.

The book includes optional rules, battlefield support, experimental weapons and technologies; those headings remain in the inventory even where the first-release IronHex game supports only standard BattleMechs.

## Status meanings

| Status | Meaning | Completeness claim |
| --- | --- | --- |
| `not_audited` | Section indexed from TOC but code and tests not individually reviewed | **None** |
| `tested_subset` | At least one exact test is linked to this section | **Only the cited scenario** |
| `known_missing` | Implementation is known to be absent or incomplete | **Not implemented** |
| `verified` | Explicit source review, enumerated requirements and edge-case tests | Allowed only after full audit |

Individual requirements use `tested_case` (a single proven scenario), `known_missing`, or `verified`. **A passing test cannot automatically change a section from `tested_subset` to `verified`.** The validator requires an auditable requirements list and explicit edge-case/source checks for `verified` entries.

Initial baseline after the grounded TOC extraction:

| Topic status | Number |
| --- | ---: |
| Not audited | 300 |
| Tested subset | 36 |
| Known missing | 16 |
| Verified complete | 0 |
| **Total TOC topics** | **352** |

Granular requirement baseline: 18 tested cases + 6 known missing cases. **These counts are audit inventory counts, not a percentage of implemented rules**: one TOC section may contain numerous independent rules, variants and exceptions.

## Audit and implementation workflow

1. Select one `known_missing` or `not_audited` rule and confirm its exact printed-page requirements from the PDF. Do not infer implementation from a function name or a market listing.
2. Add atomic requirements to `battlemech-manual-requirements.json` with the stable parent `topicId`. Record exceptional cases, separate standard and optional rules, and differentiate original/Clan tech where appropriate.
3. Implement the rule in `packages/engine/`, propagate supported statistics to MechLab and the equipment catalogue, then regenerate `dist/` with `node scripts/build-web.mjs`. Unsupported equipment must not be marked battle-ready.
4. Write deterministic tests for success, failure, boundary values, cross-system interactions and persistence where relevant. Add exact named-test references to the requirement. Re-run all affected tests.
5. Mark a parent `verified` **only** after all printed rule text, tables, exceptions and cross-references have been audited, including optional rules **if** the scope says they are included. Require documented `audit.sourceChecked`, `audit.edgeCasesChecked`, `audit.requirements` and linked test evidence.
6. Merge only after CI validates the registry, tests, generated browser assets and relevant server interfaces.

To check the register locally:

```bash
node --test tests/rules-registry.mjs
npm run rules:coverage
npm run test:unit
node scripts/build-web.mjs --check
```

CI: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) executes the registry tests and prints the report on each push to `main`. `node scripts/rules-coverage.mjs --json` emits a machine-readable report; `--missing` lists known gaps; `--require-complete` deliberately exits nonzero until every section and requirement has been fully audited.

## Immediate gaps

The first detailed backlog includes: skidding; CASE II; AMS interception; ECM; targeting computers; hidden BattleMechs. Other unreviewed chapter entries remain **unverified**, even if the engine exposes a similarly named function.

This audit records implementation evidence and engineering status, not copyrighted page text. This project is an unofficial BattleTech implementation and does not claim complete rules conformity.

## Skidding progress (2026-11-16)

The basic Skidding PSR and damage pathway is implemented and tested against
BMM pp. 20 and 68. **This is still not section-complete:** involuntary charges,
domino displacement and collisions with buildings during a skid remain separate
`known_missing` granular requirements. Do not promote p.68 to `verified`
until those interactions have their own deterministic tests.

## CASE II progress (2026-11-16)

Inner Sphere CASE II is implemented as a 1-ton, 1-slot system in MechLab,
market and combat. It vents explosion damage into rear/limb/head armor,
limits internal structure damage to one point and suppresses explosion
criticals on a secondary 8+ roll. Tests also check campaign persistence.
The Clan-specific 0.5-ton variant and automatic standard Clan CASE remain
**known missing requirements**, so the CASE II section remains
`tested_subset`, never `verified`.

### Skid collisions (2026-11-16)

A skidding mech now resolves the fall/slide packets before an involuntary
charge; successful charges damage the target and displace it, and unmoved
targets get an avoidance PSR. The route after a failed or dodged charge and
collisions with structures remain unverified. The p.68 heading remains
`known_missing` until those edge cases are tested.

### Floating Criticals (optional, BMM p.45)

This rule is disabled by default and can be enabled at battle setup via the
browser or the authoritative server command. Normal location-table rolls of 2
are rerolled to determine the affected location; a second roll of 2 does not
cause another through-armor critical. Partial cover forces a covered leg
location to reroll. Five explicit combat cases are tracked above; this
heading is **tested_subset**, not certified fully verified.

### Automatic Clan CASE (TechManual p.58)

Clan-designated units now receive standard CASE-style ammunition-explosion
containment automatically, without adding tonnage or critical slots. The
special-case CASE II installed in the same location takes precedence. Four
combat tests cover these distinctions. MechLab explicitly refuses a Clan
technology-base request until Clan construction masses, equipment tables and
MTF parsing have their own verified implementation, preventing silent
Inner Sphere stand-ins. The broader Clan construction requirement remains
`known_missing`.

### Skid continuation after a collision (BMM pp. 69–71)

An unsuccessful involuntary charge no longer stops an ongoing skid. The
engine tracks crossing an occupied hex without ending in an illegal
same-hex overlap; fall and skid damage are resolved before the first
collision, with further skid damage applied after that collision.
Destroying the defender allows the skid to resume, while destroying the
attacker ends it before any charge attack. The separate requirements for
**defender-selected immediate dodge movement**, building damage and
water/level interruptions remain `known_missing`. The Skidding heading
is not yet `verified`.

### Water interruption of a skid (BMM p.70)

A skid into an unoccupied Depth 1+ water hex ends immediately, without
charging an extra skid-damage packet for the water hex. Previously earned
fall/slide damage resolves on the prior terrain, then the mech enters
water and checks existing hull breaches. Three deterministic tests cover
Depth 1, Depth 2 and hull-breach checks. Occupied-water interactions,
height-change collisions and building impacts are still not verified.

### Skid elevation interruptions (BMM pp.70–71)

A skid stops before a higher-level obstruction and applies an extra frontal
impact packet of one point per 20 tons (rounded up), after earlier fall and
slide damage. An unoccupied cliff drop of two or more levels interrupts the
skid, moves the unit to the lower hex and adds standard falling damage
without another skid-per-hex packet for crossing open air. Four
regression tests cover a one-level rise, a rise after sliding, and drops of
2 and 4 levels. **Still missing:** accidental falls from above into occupied
lower hexes, as well as combined basement/building/water edge cases.
