# IRON HEX architecture (first split)

The running client is still the existing Three.js BattleTech prototype.
IRON HEX now has authenticated server operations and a starter transactional economy. It is not a complete player market, open-ended campaign or multiplayer game.

## Directories

- `apps/web/src`: authoritative frontend source for JavaScript, HTML and CSS.
- `packages/engine`: authoritative shared browser/server BattleTech rules
  (engine, legacy base, construction and firing arcs).
- `scripts/build-web.mjs`: assembles compatible generated files in `dist/`.
- `dist/`: static runtime served by Nginx and currently deployed Sites, with
  GLB assets and third-party Three.js modules.
- `apps/api`: Node.js HTTP API; reads shared engine; PostgreSQL migrations.
- `tests`: deterministic engine checks, authenticated PostgreSQL operations/economy integration and Chromium E2E.

Run `node scripts/build-web.mjs` after editing canonical sources; commit the
resulting `dist` changes, because the existing public Sites build still reads
`dist` directly. CI checks for unsynchronized generated files.
Docker also runs the build in its build stage.

## Current API

- `GET /api/health`: API and database readiness.
- `GET /api/v1/catalog/chassis`: current four-mech chassis catalogue based
  on the *same* engine code as the browser.
- `GET /api/v1/capabilities`: explicit availability of implemented features.

Registration, login and logout use scrypt password hashes, HttpOnly session cookies and PostgreSQL storage. Interactive battle commands and operations are server-owned. A C-Bills wallet and immutable ledger record contract payouts and repair-kit purchases, while persistent hangar wear requires paid servicing.
The DB schema only reserves tables for future authenticated operations. The
browser remains authoritative for *local* AI and hotseat battles only.

Next milestones: first-class player-to-player listings with locking and title transfers, ammunition accounting, repair times, chassis manufacturing, contract availability, travel and multiplayer. Keep all financial state authoritative on the server; never trust submitted balances or prices.

## Hosting

Komodo deploys `ironhex-web`, `ironhex-api` and `ironhex-db` as one stack,
without explicit Compose network declarations. Host Caddy routes `/api/*` to
the API and all other paths to the web container. Both exposed ports bind only
to loopback. Database storage persists in a named volume.

## Licensed hangar and NPC market

`market_owned` is true for pre-existing legacy saves and purchased NPC units, false for new free MechLab prototypes. Only licensed mechs are accepted by the campaign operation API. The fixed dealer validates its stock with the shared construction engine. A successful purchase debits the wallet and creates a hangar mech within one database transaction. Weapon parts bought from the same dealer live in `commander_equipment`. Licensed-mech PATCH requests compare weapon counts with the stored loadout, deduct additions and return removals under a PostgreSQL row lock; missing stock rolls the refit back. Prototypes retain the legacy free-design experience but cannot join rewarded missions. No inter-player transfers, crafting or auction matching are implemented yet.

## MegaMek MTF source adapter

The backend loads a pinned, local, CC BY-NC-SA 4.0 subset of MegaMek/mm-data via `apps/api/src/mtf.mjs`. It creates individually validated configurations instead of renaming one example mech. Every offer has an origin MTF and attribution link. Missing tech is rejected, not silently approximated. The API and imported snapshots use the same constructor as the tactical engine. This is a curated import and does not entail linking or copying MekBay's GPL code. Read `data/megamek/README.md` before redistributing the imported records.

A separate `full-index.json` lets the market list all 4,305 source MTF paths with server pagination without downloading unsupported data or falsely assigning them game values. `available=false` entries are reference-only. MegaMek Java definitions for components have separate GPL licensing and are not bundled; later adapters must keep licenses and game mechanics distinct.

## Equipment registry and persistent magazines

`packages/engine/equipment.js` defines each supported 3025 weapon with heat, damage, minimum and bracket ranges, mass, critical slots, rounds/ton, missile rack and server-authoritative procurement pricing. This is used by `construction.js`, `market.mjs` and the combat engine via constructed unit records. `AMMO_PACKS` derive one magazine reload SKU per ballistic/missile weapon. Unimplemented advanced technologies have no purchasable SKU.

The `hangar_mechs.ammo_state` JSONB column tracks each physical ammunition bin by `<location>:<slot>`; absence means a full initial magazine for migration. Refit updates reconcile bins, retaining existing rounds and debiting a purchased pack for every newly inserted or moved bin. An operation snapshots normalized ammunition at creation; the game rebuild applies this state before the first initiative, and the completed report computes spent and remaining rounds from the authoritative unit bins. Result, damage, XP and ammo counts commit together. `economy.reload` is a transaction that locks the owner and mech, consumes one ammunition pack in `commander_equipment` and updates precisely one depleted bin. No client-settable numeric ammo quantity is accepted.

### Engine-backed physical systems

`FIXED_COMPONENTS` in the registry now exposes the already implemented jump jet, single heat sink and hatchet as purchasable `system:<type>` SKUs. Weapon and system delta counts are resolved transactionally in one licensed hangar PATCH; removing a system returns a physical unit to commander stock, adding requires stock. Engine rating, tonnage, armor and limb actuator configuration remain locked. Jump MP and sink quantity may change only as allowed by construction (corresponding actual placed equipment and mass/critical slot limits); the combat rules already use those fields in movement and heat phases. Hatchets are enabled by the existing physical attack rules. Advanced systems remain excluded.
