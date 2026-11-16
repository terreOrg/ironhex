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

Use **РЫНОК И РЕМОНТ** to purchase one of three surplus Griffin variants or any supported weapon with C-Bills. A purchase appears in the owned hangar. Click **ИЗМЕНИТЬ** to open that mech in MechLab; installing additional weapons consumes owned inventory, removing weapons returns them to the warehouse. The purchased frame's engine, tonnage, armor and permanently installed equipment cannot be changed in this release. MechLab's **Сохранить как новый** creates an unrestricted, free **training-only prototype**, not a licensed campaign mech. Existing saved mechs are grandfathered into campaign eligibility. PvP listings, selling owned mechs to the NPC dealer, ammo purchases and manufacturing remain future work.
