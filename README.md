# IRON HEX — BattleTech

Unofficial browser-based isometric BattleTech prototype, with animated 3D models,
cockpit UI, dice, mech record sheets and a construction tool.

**Published prototype:** https://iron-hex-battletech.chemosh.chatgpt.site/

## Architecture

The project has a modular web/API structure with a shared rules engine:

- `apps/web/src/` — authoritative browser JavaScript, HTML and CSS
- `packages/engine/` — shared BattleTech rules used by browser and backend
- `apps/api/` — authenticated Node.js API, operations, economy and PostgreSQL persistence
- `dist/` — generated browser runtime, vendored 3D assets and GLB models
- `compose.yaml` — Komodo Docker stack: frontend, API and PostgreSQL

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SELF-HOSTING.md](SELF-HOSTING.md).

The existing browser AI and hotseat game work independently of the API.
**Registration, login and server-side sessions are implemented.** Server-owned campaign operations, persistent C-Bills, fixed NPC contracts, supply purchasing and repair are playable. Player-to-player trading, open-world campaigns, live pricing and multiplayer are not implemented.

## Development

Use Node.js 24 or later. After editing `apps/web/src` or `packages/engine`,
regenerate and commit the static runtime to preserve the published Sites app:

```bash
node scripts/build-web.mjs
node scripts/build-web.mjs --check
node --test tests/combat.mjs tests/construction.mjs tests/fire-arcs.mjs tests/api.mjs
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. Opening index.html using file:// does not work.
WebGL is needed for 3D; Canvas is the fallback.

For full frontend/API/PostgreSQL hosting, follow [SELF-HOSTING.md](SELF-HOSTING.md).
The API uses `/api/health`, `/api/v1/catalog/chassis` and
`/api/v1/capabilities`. It has no unauthenticated write endpoints.

## Automated tests

GitHub Actions on the existing self-hosted runners runs unit tests, browser
Playwright tests and Docker image smoke checks.

## Rules and licenses

This is an unofficial prototype, **not a complete implementation of the AGoAC
rulebook**. See `dist/coverage.html` for rules coverage and limitations.
The models are visual proxies, not canonical depictions.

See `dist/ASSET-LICENSE.md` and `dist/LICENSES/` for bundled asset credits
and licensing. BattleTech names and rules remain the property of their
respective owners; this project is not affiliated with or endorsed by them.


The standalone battlefield and MechLab now require an authenticated commander session before their JavaScript modules load. Visiting the site without a valid session opens the full-screen commander login / registration console first. An API outage blocks entry rather than falling back to anonymous gameplay. Static game assets remain publicly downloadable; the access gate is a UI restriction, not an authorization boundary for static files.

## Campaign economy (first release)

Each commander starts with 150,000 C-Bills. In **ОПЕРАЦИИ**, choose a contract and a repaired hangar roster; the higher-risk contracts improve the opposing AI's Gunnery skill. Victory/draw/defeat payouts are computed once by the server. Armor, structure loss and destroyed status persist in the hangar after an operation; damaged mechs require repair before starting another contract. **РЫНОК И РЕМОНТ** shows the wallet, signed ledger, two repair-supply SKUs and full repair quotes. Purchases and repairs are atomic, owner-scoped PostgreSQL operations.

This is a fixed-price NPC market, **not** a live player exchange: purchased licensed mechs and weapon inventories are persistent, while MechLab's free design creations remain training-only prototypes. Ammunition and chassis production are not charged, and automatic missions can be repeated. See `SELF-HOSTING.md` for costs, endpoints and limits.

## NPC dealer, licensed mechs and MechLab warehouse

Use **РЫНОК И РЕМОНТ** to purchase one of the supported MegaMek-derived classic variants or any supported weapon with C-Bills. A purchase appears in the owned hangar. Click **ИЗМЕНИТЬ** to open that mech in MechLab; installing additional weapons consumes owned inventory, removing weapons returns them to the warehouse. The purchased frame's engine, tonnage, armor and permanently installed equipment cannot be changed in this release. MechLab's **Сохранить как новый** creates an unrestricted, free **training-only prototype**, not a licensed campaign mech. Existing saved mechs are grandfathered into campaign eligibility. PvP listings, selling owned mechs to the NPC dealer, ammo purchases and manufacturing remain future work.

## MegaMek Data source and fidelity

The dealer now uses a pinned snapshot of selected MTF unit records from [MegaMek/mm-data](https://github.com/MegaMek/mm-data), the data ecosystem used alongside MekBay. The source records and original license are in [data/megamek](data/megamek/). The importer builds actual chassis mass, movement, heat sinks, armor (front and rear), weapon locations, ammunition bins and slots. Unsupported technology is rejected, not silently reinterpreted. The market lists only variants that pass the shared Classic-style construction validation. Source links and the CC BY-NC-SA 4.0 attribution accompany offers. Prices are derived *IronHex balancing values*, not authoritative MegaMek or MekBay valuations. No live sync is needed to play; the curated snapshot is bundled with the server. This is not a full MegaMek simulation, and some unit files are deliberately excluded until their mechanics are supported.

The full catalog browser indexes **4,305 MTF variant filenames** from the same pinned MegaMek Data revision. Search is server-paginated and links to the source. **Catalog listing is not a promise of battle support**: only MTF definitions validated by the current IronHex rules engine have an active purchase button. Engines, weapons, heat sinks and armor are identified within every MTF, but standalone expanded component definitions still need an importer; MegaMek implements these mainly in its separately GPL-licensed Java source. No MegaMek Java code is bundled here.

## Market filters and technical dossiers

Click any mech name in **РЫНОК И РЕМОНТ** to open an accessible modal dossier. For variants already imported into the combat engine this includes the pinned source record, mass, engine rating, year, tactical role, walk/run/jump MP, heat sinks, front/rear armor, internal structure, mounted weapons and ranges, ammunition bins, equipment placement and all critical slots. The source MTF link and CC BY-NC-SA 4.0 credit remain visible. Reference-only entries open a dossier with their confirmed name, source and (where explicitly marked by their archive folder) weight class, **not guessed specifications**; consult the original MTF for additional details until that model is imported.

Full-catalog server-side filters support name/model, class, minimum/maximum mass, minimum/maximum era, maximum IronHex price, role, weapon substring, playable availability, and sorting by name, mass, era or price. All filters are applied **before** pagination. Since the complete 4,305-entry archive currently contains names and source paths rather than parsed statistics, quantitative filters (including exact tonnage, year, price, weapon and role) only match imported, validated variants. Unavailable entries are excluded when those fields are requested. The search UI explicitly explains this limitation.

## Engine-linked equipment and ammunition (first integrated release)

`packages/engine/equipment.js` now owns the supported Classic-style 3025 weapon mechanics and their gameplay prices. MechLab construction, the fixed NPC catalog and server combat share these definitions. The catalog also sells ammunition packs for each ammo-using weapon; packs use IronHex economy prices and replenish one compatible magazine, not a whole mech.

The server stores the number of live rounds in each owned mech magazine by location and critical slot. Starting a campaign operation freezes the current ammunition snapshot; battle firing, jettisoned ammo and destroyed bins reduce that quantity. When a contract completes, the after-action report lists consumed rounds and the remaining amount is written to PostgreSQL along with damage and rewards, in one transaction. No free restock occurs between missions. A commander purchases a compatible `ammo:<weapon>` pack and uses **ПЕРЕЗАРЯДИТЬ** in the market to restore one incomplete magazine. The server checks ownership, stock, repairs and active operations. Moving/adding magazine bins in a paid MechLab refit also consumes an inventory ammo pack; training-only designs remain free.

Existing mechs with no saved ammunition state start with their configured magazines full for backward compatibility. Reloading costs one full pack even for a partially depleted bin. **Advanced weapons, alternate armor/engine systems, ECM and other technology remain reference-only until their construction and combat effects are implemented.** Standard jump jets, single heat sinks and hatchets are purchasable physical systems and require stocked parts for licensed refits; the existing combat engine applies their jump MP, cooling and physical attacks. Chassis tonnage, engine rating and armor distribution remain fixed for purchased mechs.

## Persistent critical systems and supported Inner Sphere ER energy weapons

Battle-damaged equipment is no longer silently recovered after a credited operation. Every occupied critical slot the battle engine reports as destroyed (weapons, ammunition bins, heat sinks, jump jets, hatchets, engine, gyro, sensors, life support, cockpit or limb actuators) is saved in `hangar_mechs.critical_damage`. Subsequent battles reconstruct those faults before initiative: a destroyed gun cannot fire, an engine hit adds heat, a broken hip reduces movement, lost sinks reduce cooling and a destroyed magazine cannot supply ammunition. A wrecked hull must still be repaired separately. A mech with a destroyed cockpit or three engine hits cannot be launched until serviced.

**Рынок и ремонт → Повреждённые компоненты** now shows actual damaged components, their section and slot, and whether they require spare inventory or paid maintenance. Damaged weapons and physical systems require purchasing a compatible spare; a destroyed magazine requires an ammo pack, which also refills it. Built-in core/actuator systems are repaired for explicit IronHex C-Bills service charges. Repair is server-authoritative, owner-scoped and atomic. No repairs/refits while the mech belongs to an open operation, no duplicated damaged-part credit, no client-supplied prices. Hull repair and individual critical-component repair are separate actions.

Four additional **Inner Sphere direct-fire extended-range energy weapons** are active in both market and combat: ER Small Laser, ER Medium Laser, ER Large Laser and ER PPC. Their mass, critical slots, heat, damage and range brackets use BattleTech tabletop values; their market prices remain IronHex balance values. Clan ER lasers/PPC and standard pulse lasers are also playable and tradeable as explicitly named parts, with per-tech-base values and the pulse-laser **–2 to-hit bonus** applied by the battle engine. This is **not** general support for Clan chassis, AMS, ECM, XL engines or exotic armor; those mechanics and valid construction rules still need separate work.

### Extended direct-fire arsenal

The component registry also contains Inner Sphere Small/Medium/Large Pulse Lasers, Clan ER Small/Medium/Large Lasers and Clan ER PPC, and Clan Small/Medium/Large Pulse Lasers. The statistics are taken from BattleTech tabletop equipment tables (not the HBS computer-game damage scale). The exact `accuracyModifier=-2` for standard pulse lasers is carried through construction into the authoritative `Game.preview()` target number and therefore affects the actual dice roll and the AI's firing decisions. Clan equipment is labeled by tech base and earliest IronHex market era (3049), but the campaign does not yet enforce era restrictions. Clan full-mech MTF imports are still unsupported; only compatible weapons in the mixed-tech MechLab are enabled.
