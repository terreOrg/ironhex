# IRON HEX — BattleTech

Browser-based isometric BattleTech fan game with animated 3D models, a cockpit-style interface, animated dice, live mech record sheets and a mech construction tool.

**Play:** https://iron-hex-battletech.chemosh.chatgpt.site/

## Run locally

No build step or npm dependencies are required. Serve `dist/` with an HTTP server:

```sh
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. ES modules require HTTP; opening index.html through file:// is not supported. WebGL enables 3D rendering; a Canvas map is available as fallback. The interface is in Russian. Play against the computer or use local hotseat mode; there is no network multiplayer.

## Tests

Use Node.js 24 or later:

```sh
node tests/combat.mjs
node tests/construction.mjs
node tests/fire-arcs.mjs
```

## Source layout

- `dist/app.js` — scene, interaction, animations and user interface.
- `dist/engine.js` — combat rules and phase resolution.
- `dist/legacy-engine.js` — shared base engine, map and chassis definitions.
- `dist/construction.js`, `dist/mechlab.*` — mech construction and validation.
- `dist/fire-arcs.js` — directional and range overlays.
- `dist/record-sheet.js` — live record sheet.
- `dist/dice.js` — animated dice display.
- `dist/style.css`, `dist/cockpit.css` — responsive UI and cockpit styling.
- `dist/*.glb` — bundled animated 3D assets.
- `dist/three.js` and loader/helper modules — bundled Three.js runtime.
- `tests/` — deterministic combat, construction and firing-sector checks.
- `.openai/hosting.json` — existing Sites deployment configuration.

## Rules coverage

This is an unofficial prototype, **not a complete implementation of the rulebook**. See `dist/coverage.html` for supported mechanics and remaining limitations, including official scenarios and some LOS, displacement and physical-attack edge cases.

The model assets are visual proxies, not canonical models of the named chassis. Custom mech designs are stored locally in the browser.

## Asset licenses and credits

See `dist/ASSET-LICENSE.md` and `dist/LICENSES/`. Third-party code and models retain their original licenses. BattleTech names and rules remain the property of their respective rights holders. This project is not affiliated with or endorsed by them.

Exported from published source commit `5c5274a8719014e069ea29816a2ef7d1d70f135a`.
