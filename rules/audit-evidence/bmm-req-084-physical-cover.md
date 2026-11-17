# BMM p.35 — physical attacks against standing Quads in Depth 1 water

Audit scope: `bmm-p005-four-legged-mech`, requirement `bmm-req-084`. This is a **known uncovered interaction**, not a verified rule.

## Source evidence (user-supplied BattleMech Manual, corrected sixth printing, 2022)

Printed p.35, *Physical Attacks and Water*, *Partial Cover*:
- Standing biped in Depth 1: partial cover against physical attacks that do **not** use the Punch Location Table.
- Standing quad in Depth 1: **always** partial cover against physical attacks.
- When partial cover applies and attacker and target are at the same LOS level, hits **not using the Kick Location Table** that resolve to leg locations are ignored; charges explicitly ignore this rule.
- Physical attacks occurring underwater inflict half standard damage, rounded down. The waterline/attack-submersion case must be assessed independently from cover.

## Independent source-to-code trace at SHA 87c2c19705a96503a035e5af12c50b1af462f1e6

- `packages/engine/engine.js`: `physicalPreview()` computes attacker/target waterline, depth and attack hit-location table, but does not compute physical partial cover nor a same-LOS-level flag.
- `declarePhysical()` snapshots the preview into `physicalDeclarations`.
- `resolvePhysical()` calls `this.hit(t,d.damage,d.side,d.table)`, omitting cover/level information.
- `hit(u,amount,side,table,aim,cover,underwaterCover)` supports cover, but the existing `partialCoverObscures()` predicate is shared with weapon fire and does not encode the physical-specific *Kick Location Table* exemption. Its normal table can suppress a leg hit if cover is passed; punch/kick paths can also suppress locations, so a physical-specific guard is necessary.
- `resolveSpecial()` charge path must remain exempt. Do not add blanket water cover to `hit()` or `los()`.
- `packages/engine/dist` must be regenerated/synchronized after implementation.

## Required deterministic gameplay tests before promotion

1. Standing quad in Depth 1, same LOS level: a physical attack using the normal table landing on **each** front/rear leg location deals zero damage, with roll recorded; torso/head hits still damage.
2. Same scenario using Punch Location Table: leg results ignored; using Kick Location Table: leg results **damage**. Test biped contrast: Punch Location Table does not get partial cover from Depth 1.
3. Same scenario with different LOS levels: leg hits are **not** ignored by this p.35 clause.
4. Depth 0 standing quad: no water cover; Depth 2/submerged and prone target: validate separate underwater/physical-attack restrictions rather than blindly reusing Depth 1.
5. Charge into a standing quad in Depth 1: damage not suppressed by the physical-cover exception.
6. Cover must be calculated from declaration/resolution positions consistently, including displacement and phase ordering. Test underwater half-damage separately.
7. Verify source and built `dist` parity; execute engine regression, full CI, Container Smoke, Browser E2E.

## Audit decision

Keep `bmm-req-084` at `tested_case` (not `verified`) and heading `bmm-p005-four-legged-mech` at `known_missing`. Existing weapon-fire partial-cover tests are not proof of physical-attack correctness. No claim of 100% Quad support.
