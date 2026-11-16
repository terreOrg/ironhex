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
