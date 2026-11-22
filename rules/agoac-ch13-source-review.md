# AGoAC Chapter 13 — final source-to-engine audit

Source: Catalyst Game Labs, *BattleTech: A Game of Armored Combat* CAT3500D (2018), last printed page **56**, table printed page **55**. Original publisher PDF:
https://static1.squarespace.com/static/5e5f11b6a6b48b3ae5c4ee36/t/5e69a64e3d430e6e35ad7fda/1583982189894/cat3500d+battletech+a+game+of+armored+combat+rulebook.pdf

Verified by visual inspection of PDF page index 57 = printed page 56; PDF index 56 = printed p.55. The previous p.56–57 range was incorrect; there is no printed p.57 in this publisher PDF.

## Source scope: description, not a new construction/rules chapter

The chapter names Autocannons, Flamers, Lasers, Machine Guns, Missile Launchers, Long-Range Missiles, Short-Range Missiles, Particle Projector Cannons, and Physical Weapons. The introductory text explicitly refers numerical heat, range, damage and tonnage data to the printed p.55 Weapons and Equipment Table. No advanced/Clan, infantry, vehicles or ancillary equipment are introduced as playable standard AGoAC components by this descriptive page.

| ID | Printed material | Independently checked implementation and executable evidence |
|---|---|---|
| agoac-187 | p.56 opening; p.55 table; p.54 equipment boundary | Reference scope and source table: The chapter refers to the page-55 data, covers exactly seventeen standard box weapons plus Hatchet and Heat Sink, and does not make advanced technology part of basic AGoAC. Named test: CAT3500D pp.55–56: reference chapter has exactly seventeen independently transcribed base weapons |
| agoac-188 | p.56 Autocannons; p.55 Direct-Fire Ballistic Weapons | Autocannons: All four autocannon calibers AC/2, AC/5, AC/10 and AC/20 match printed mass, slots, heat, damage, ranges and shots and resolve as direct-fire packets. Named test: CAT3500D pp.55–56: all autocannon calibers match their source table and direct-fire packets |
| agoac-189 | p.56 Flamers; p.55 Direct-Fire Energy Weapons | Flamers: The base Flamer is a standard close-range direct-fire energy weapon with heat 3, damage 2, no magazine and p.55 ranges; flavor text does not authorize advanced flamer options. Named test: CAT3500D pp.55–56: flamers retain their printed direct-fire stats without inventing infantry rules |
| agoac-190 | p.56 Lasers; p.55 Direct-Fire Energy Weapons | Lasers: Standard Small, Medium and Large Laser use the printed base heat, armor damage, mass, slots and ranges and are not charged ammunition. Named test: CAT3500D pp.55–56: three laser sizes match mass, heat, range and damage without ammunition |
| agoac-191 | p.56 Machine Guns; p.55 Ballistic Weapons; p.54 | Machine guns: Standard Machine Gun uses zero weapon heat, damage 2, short range, half-ton weapon mass and 200 shots/ton; half-ton ammo-bin exception is in earlier Construction rules. Named test: CAT3500D pp.55–56: machine gun preserves its zero heat, two damage and 200-shot capacity |
| agoac-192 | p.56 Missile Launchers; p.55 Missile Weapons | Missile launchers: LRM and SRM base families use printed launcher racks, finite compatible ammunition and cluster damage resolution; descriptive guidance supplies no new attack mechanic. Named test: CAT3500D p.56: missile launcher family uses exact rack groups and finite ammunition |
| agoac-193 | p.56 Long-Range Missiles; p.55 Missile Weapons | Long-range missiles: All LRM 5/10/15/20 use six-hex minimum, printed long brackets, shots/ton and five-point cluster damage packets. Named test: CAT3500D pp.55–56: LRM family has six-hex minimum and five-point cluster packets |
| agoac-194 | p.56 Short-Range Missiles; p.55 Missile Weapons | Short-range missiles: All SRM 2/4/6 use no minimum range, printed short brackets and two damage per missile with one packet per missile. Named test: CAT3500D pp.55–56: SRM family has no minimum and applies two damage per missile |
| agoac-195 | p.56 Particle Projector Cannons; p.55 Energy Weapons | Particle projector cannons: Base PPC retains 10 heat, 10 damage, 3 minimum range, mass 7 tons and 3 critical slots; advanced ER PPC is outside base scope. Named test: CAT3500D pp.55–56: PPC keeps ten heat, ten damage and three-hex minimum |
| agoac-196 | p.56 Physical Weapons; p.55 Hatchet; p.28 | Physical weapons: Basic Hatchet is legal in the box rulebook with a biped arm mount, chassis-based critical size and physical damage as certified previously under combat/Construction. Named test: CAT3500D pp.55–56: Hatchet is a basic physical weapon with chassis-based criticals |

## Cross-layer assessment

- Publisher p.55 has exactly **17 standard energy, ballistic and missile weapon rows**. Every row was independently transcribed into the page-55 values in `tests/agoac-ch13-weapon-reference.mjs`, not generated from runtime `WEAPON_SPECS`.
- `packages/engine/equipment.js` and `packages/engine/rulebook.js` share weapon identity, thermal/damage/range/weight/critical-slot data and base eligibility across constructor, market, and combat. Advanced ER/Pulse/Clan/CASE equipment is deliberately still defined for supplements, but excluded from base campaigns.
- Live `Game.fireAmounts` checks use deterministic successful shots for direct-fire weapons and 12 cluster rolls for all LRM and SRM racks, verifying five-point LRM and two-point SRM damage packet shapes, alongside the existing full cluster-source case in `tests/agoac-foundations.mjs`.
- Hatchet acceptance and chassis-based critical slots are checked through strict AGoAC construction; side-arc, physical TN and hit-location behavior remain linked to previously verified p.28 tests.
- Flamer p.56 prose is descriptive. Additional flamer heat-mode mechanics from later books are **not** treated as sourced to this page. Likewise, the machine-gun anti-infantry description does not claim implementation of infantry.
- Chapters 1–12 source-registry facts and locked Chapter 11 Scenario 3 board (Desert #2 WEST + Grassland #3 EAST) remain unchanged; no production deployment.

## Baseline and release checks

- Code baseline before this reference-only audit: `3f7509e8fd6d0ebdfaf4e7fb9cb7fdbef793f3b6`. That `main` SHA passed CI run 45076774615, Browser E2E 45076774654, full manual Container Smoke 45078438569, and SonarQube Quality Gate 45076774587, all successful.
- The certification PR adds tests and documentation, not new game mechanics. It is **not considered completed** until CI, Browser E2E and Container Smoke pass on its exact head, followed by successful CI, Browser E2E, Container Smoke and SonarQube on its merged `main` head.
- The audit registry covers the **13 currently enumerated chapter topics and 196 atomic entries**. It is not an exhaustive sentence-by-sentence certification of all potential AGoAC edge cases or of other BattleTech manuals.
