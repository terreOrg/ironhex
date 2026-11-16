# IRON HEX — BattleTech

Unofficial browser-based isometric BattleTech prototype, with animated 3D models,
cockpit UI, dice, mech record sheets and a construction tool.

**Published prototype:** https://iron-hex-battletech.chemosh.chatgpt.site/

## Architecture

The project has a modular web/API structure with a shared rules engine:

- `apps/web/src/` — authoritative browser JavaScript, HTML and CSS
- `packages/engine/` — shared BattleTech rules used by browser and backend
- `apps/api/` — Node.js read-only API and PostgreSQL schema foundation
- `dist/` — generated browser runtime, vendored 3D assets and GLB models
- `compose.yaml` — Komodo Docker stack: frontend, API and PostgreSQL

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SELF-HOSTING.md](SELF-HOSTING.md).

The existing browser AI and hotseat game work independently of the API.
**Registration, login and server-side sessions are implemented.** Campaign persistence, a functioning market and online multiplayer are not implemented yet. The database tables are only preparation.

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
