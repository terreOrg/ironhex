# Ironhex Web

Canonical frontend sources live in `apps/web/src/`. The browser runtime lives in
`dist/` for compatibility with the existing published Sites application and its
existing Playwright tests. Use `node scripts/build-web.mjs` to synchronize frontend
source and the shared engine into `dist/` before committing.

Large GLB models, licensed vendor modules and static documentation remain in `dist/`
and are not duplicated in this source directory. These are copied unchanged into
the production image.

The frontend retains the original local AI and hotseat modes. The backend does
not yet authorize or persist multiplayer turns. This is intentional while game
rules are migrated to a server-authoritative protocol.
