# IRON HEX architecture (first split)

The running client is still the existing Three.js BattleTech prototype.
This change is a foundation for persistent campaigns, hangars and an economy,
**not** a claim that those features are finished.

## Directories

- `apps/web/src`: authoritative frontend source for JavaScript, HTML and CSS.
- `packages/engine`: authoritative shared browser/server BattleTech rules
  (engine, legacy base, construction and firing arcs).
- `scripts/build-web.mjs`: assembles compatible generated files in `dist/`.
- `dist/`: static runtime served by Nginx and currently deployed Sites, with
  GLB assets and third-party Three.js modules.
- `apps/api`: Node.js HTTP API; reads shared engine; PostgreSQL migrations.
- `tests`: deterministic engine checks, read-only API tests and Chromium E2E.

Run `node scripts/build-web.mjs` after editing canonical sources; commit the
resulting `dist` changes, because the existing public Sites build still reads
`dist` directly. CI checks for unsynchronized generated files.
Docker also runs the build in its build stage.

## Current API

- `GET /api/health`: API and database readiness.
- `GET /api/v1/catalog/chassis`: current four-mech chassis catalogue based
  on the *same* engine code as the browser.
- `GET /api/v1/capabilities`: explicit availability of implemented features.

Registration, login and logout now use scrypt password hashes, HttpOnly session cookies and PostgreSQL storage. No wallet, marketplace or battle mutation endpoints are exposed.
The DB schema only reserves tables for future authenticated operations. The
browser remains authoritative for *local* AI and hotseat battles only.

Next milestones: verified-email and password recovery, server-authoritative battle commands,
idempotent wallet ledger, owner-checked hangar transactions, market listing
locking and campaign persistence. Keep all financial state authoritative on the
server; do not trust balances submitted by the browser.

## Hosting

Komodo deploys `ironhex-web`, `ironhex-api` and `ironhex-db` as one stack,
without explicit Compose network declarations. Host Caddy routes `/api/*` to
the API and all other paths to the web container. Both exposed ports bind only
to loopback. Database storage persists in a named volume.
