# IRON HEX on CentOS Stream / Komodo

The repository contains a **three-service** Docker Compose stack:

- `ironhex-web`: non-root Nginx serving the existing BattleTech game
- `ironhex-api`: Node.js 24 authenticated API for hangar, operations, payments and repair
- `ironhex-db`: PostgreSQL 17 with persistent `ironhex-db-data` volume

No explicit Compose networks are defined; Komodo manages the stack's default
network. Caddy stays on the host as a systemd service.

## 1. Create or update the Komodo Stack

| Setting | Value |
| --- | --- |
| Name | `ironhex` |
| Server | CentOS host |
| Source | Git Repository |
| Repository | `terreOrg/ironhex` |
| Branch | `main` |
| Compose file | `compose.yaml` |
| Pre Build Images | **Enabled** |

In **Stack environment variables**, set a long random password:

```
IRONHEX_DB_PASSWORD=<set-a-unique-strong-password-in-Komodo>
IRONHEX_PORT=18088
IRONHEX_API_PORT=18089
IRONHEX_PUBLIC_ORIGIN=http://ironhex.lan
IRONHEX_AUTH_COOKIE_SECURE=false
```

The password is required. Do not commit it to Git, paste it into a chat, or
create a public `.env` file. To generate one privately on the server:
`openssl rand -hex 32`. Put the result directly in Komodo's environment editor.

If you already deployed the previous *frontend-only* Stack, update its Git source
and use **Deploy** with building enabled; it will replace the old one-container
stack with three services. Do not delete the named database volume after
initialization.

No port forwarding or public DNS record is needed. Both HTTP ports bind to
`127.0.0.1` on the host. Database port 5432 is not published at all.

## 2. Verify containers before enabling the reverse proxy

```bash
docker ps --filter name=ironhex
curl -fsS http://127.0.0.1:18088/health
curl -fsS http://127.0.0.1:18089/api/health
curl -fsS http://127.0.0.1:18089/api/v1/catalog/chassis
```

Expected health checks: web returns `OK` and API returns
`{"status":"ok","service":"ironhex-api","database":"ok"}`.

The chassis endpoint returns four units from the shared rules engine.

## 3. Caddy (host service, not a Docker container)

Replace the previous `http://ironhex.lan` block with:

```caddyfile
http://ironhex.lan {
    handle /api/* {
        reverse_proxy 127.0.0.1:18089
    }
    handle {
        reverse_proxy 127.0.0.1:18088
    }
}
```

**Use `handle`, not `handle_path`:** the API expects the `/api/` prefix.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

In Technitium DNS, create a local A record:
`ironhex.lan -> 192.168.0.117`.

From a device on the LAN (or VPN with local DNS), open:

- `http://ironhex.lan/` — current browser game
- `http://ironhex.lan/api/health` — backend/database health
- `http://ironhex.lan/api/v1/catalog/chassis` — starter chassis catalog

The game now includes account registration and a cockpit login button.
Sessions and user profiles are persisted in PostgreSQL. Online gameplay,
server-backed operations, a starter fixed-price C-Bills market and repairs are implemented; multiplayer and player-to-player trading are not.

**Before using real passwords or inviting other players, enable HTTPS.**
The original LAN-only `http://ironhex.lan` route is not encrypted. You can
use the existing wildcard TLS configuration for a local-only hostname such
as `ironhex.krbox.top` and add a local Technitium DNS record pointing it to
the CentOS host. Then set:
```
IRONHEX_PUBLIC_ORIGIN=https://ironhex.krbox.top
IRONHEX_AUTH_COOKIE_SECURE=true
```
in Komodo and redeploy. Both values must match the actual browser origin.
Add the `ironhex.krbox.top` host to your existing wildcard Caddy
site and route `/api/*` to port 18089 and other paths to 18088.
Do not create a public DNS record. Do not disable the existing Caddy
external-access restrictions. Cookies should use `Secure` in HTTPS mode.

Email addresses are collected but **not yet verified** and SMTP password
reset is **not yet implemented**; do not treat these as verified identities.

## 4. Seeing updates

Commit updates to `main` and ensure Actions are green. In Komodo press
**Deploy**, not just Restart. This fetches changes and rebuilds both images
(using canonical web sources and shared engine). Refresh the browser. For
existing Sites publishing, run `node scripts/build-web.mjs` and commit
generated `dist` files as well.

A future automated deployment can be triggered locally by GitHub Actions
on `jig`/`jog` after tests succeed. Do not publicly expose Komodo just
to receive webhooks.

## 5. Automatic deployment only after tests pass

Komodo Stack → Config → Webhooks:

1. Enable the webhook and **Force Deploy** (so `dist/`, JavaScript and GLB
   changes trigger a rebuild, not just changes to `compose.yaml`).
2. Set a **unique Stack Webhook Secret**, generated locally with
   `openssl rand -hex 32`. Do not reuse the PostgreSQL password or any
   Caddy credentials.
3. Copy the **GitHub Stack /deploy webhook URL**, using the exact stack ID
   or name shown in Komodo. The URL must be reachable from the same CentOS
   host where the `jig` and `jog` runners run.
4. Prefer loopback, for example change *only the hostname and scheme*
   in the URL to `http://127.0.0.1:9120` **if the Komodo Core port
   is actually published there**. Otherwise use the existing internal
   HTTPS Komodo URL. Never expose Komodo to the public Internet.
5. Under GitHub repository → Settings → Secrets and variables → Actions,
   create two **repository secrets**:
   - `KOMODO_WEBHOOK_URL`: private exact `/listener/github/stack/.../deploy` URL
   - `KOMODO_WEBHOOK_SECRET`: same secret as the Komodo Stack field

The workflow [Ironhex Deploy](.github/workflows/deploy.yml) is triggered once
on successful completion of Ironhex CI for a `main` push. It waits up to
eight minutes for the same commit to pass Ironhex Browser E2E and Ironhex
Container Smoke, then sends one signed GitHub-compatible webhook from
`jig` or `jog` over the server's local network. A later commit supersedes
older runs. Manual workflow dispatch remains available.
No GitHub → public inbound access to Komodo is needed.

The webhook returns before a deployment necessarily finishes. Review Komodo
execution logs and check `/health` after it completes. GitHub Actions logs
show whether Komodo accepted the request, not necessarily whether the new
containers eventually became healthy.

The two secrets must be set before auto-deploy is enabled. Until then, the
workflow logs an explicit warning and skips deployment.

Do **not** also configure the same direct GitHub push webhook in the
GitHub repo's Settings → Webhooks: it would deploy *before tests pass*
and potentially deploy twice.

## 6. Persistence and security

The DB volume retains application schema across routine rebuilds. Back it up
before upgrades and never use `docker compose down -v` on this stack.

All mutation endpoints require authentication, same-origin JSON and owner scoping. Operations and economy commands use PostgreSQL transactions, account-level wallet locks and replay-safe payout references.
The current game has local browser state only. Keep Ironhex limited to LAN/VPN
unless you add authentication, rate limits, and more restrictive controls.

## 7. LAN-only HTTPS and Brevo account email

Keep Ironhex private to LAN/WireGuard. Reuse the existing Caddy wildcard
certificate for `*.krbox.top` rather than creating a public DNS entry.

1. In Technitium add a local A record: `ironhex.krbox.top` -> `192.168.0.117`.
2. Inside the **existing** `*.krbox.top` Caddy site block, before its
   fallback `handle`, add these two host-based handlers:

   ```caddyfile
   @ironhex_api {
       host ironhex.krbox.top
       path /api/*
   }
   handle @ironhex_api {
       reverse_proxy 127.0.0.1:18089
   }
   @ironhex_web host ironhex.krbox.top
   handle @ironhex_web {
       reverse_proxy 127.0.0.1:18088
   }
   ```

   Keep the existing external-access restriction for everything except
   Playmat. Do not create another wildcard site and do not expose 2019.
3. After testing the HTTPS endpoint, redirect the old LAN-only HTTP site:

   ```caddyfile
   http://ironhex.lan {
       redir https://ironhex.krbox.top{uri} permanent
   }
   ```

4. Run `sudo caddy validate --config /etc/caddy/Caddyfile`, then
   `sudo systemctl reload caddy`.
5. In Komodo Stack environment set:

   ```dotenv
   IRONHEX_PUBLIC_ORIGIN=https://ironhex.krbox.top
   IRONHEX_AUTH_COOKIE_SECURE=true
   ```

   Redeploy after changing environment. Browser origin must match exactly.
   Do not send passwords over the old HTTP address.

### Brevo configuration

Brevo integration uses a **Brevo v3 REST API key**, not the SMTP relay
password. Choose an address verified in Brevo as the sender and set
these environment variables **only in Komodo**, never in Git:

```dotenv
IRONHEX_BREVO_API_KEY=<Brevo-v3-API-key>
IRONHEX_EMAIL_FROM=<verified-sender-address>
IRONHEX_REQUIRE_VERIFIED_EMAIL=false
```

Deploy and verify a real email arrives at a mailbox you control. Existing
accounts start as unverified; they can request a verification message
from the Profile screen, or from the verification gate. The email contains
a short-lived link to the private HTTPS Ironhex domain.

Verification links expire after 24 hours; password-reset links after
30 minutes. A token is stored hashed in PostgreSQL, is single-use, and
resetting a password invalidates all existing sessions. The password reset
form does not reveal whether the address exists.

**Only after testing HTTPS and delivery**, change
`IRONHEX_REQUIRE_VERIFIED_EMAIL=true` in Komodo and redeploy.
That prevents unverified accounts from using the battle UI or hangar.
Do not enable it until existing users have an opportunity to verify.

If the Brevo API key is absent, existing registration and login keep
working, while verification and reset requests return 503.

To verify API configuration after deployment:

```bash
curl -fsS https://ironhex.krbox.top/api/health
curl -fsS https://ironhex.krbox.top/api/v1/capabilities
```


## 8. MechWarrior personnel IDs

The authenticated command hub now includes **ЛИЧНЫЙ СОСТАВ** with fictional
military-style MechWarrior ID cards: procedural illustrated portraits,
unique credential numbers, callsigns, affiliations, ranks, Gunnery/Piloting,
and a read-only service record. Each account can create up to 24 pilots.

Personnel records are stored in PostgreSQL and scoped to their owner.
In the hangar, assign a pilot to a mech through the **ПИЛОТ МЕХА** selector.
One pilot can crew only one saved mech at a time. Pilots may be unassigned,
edited or deleted; deleting a pilot clears their mech assignment.

Initial skills are Gunnery 4 and Piloting 5. The client may use these for
local hotseat/AI battles, but **combat results are not yet server-authoritative**.
Experience, victories, kills, wounds and ranks are read-only in this release:
no API permits users to award themselves XP or fake battles. A future
server-side combat referee will record verifiable battle results and handle
pilot advancement and campaign rosters.


## 9. Persistent server battle operations (first release)

The **ОПЕРАЦИИ** menu in headquarters is the first campaign-ready
server-mode mission board, separate from the existing **БЫСТРЫЙ БОЙ**
browser-controlled 3D training game.

1. In the hangar, save one or two BattleTech-legal designs and optionally
   assign pilots. Open **ОПЕРАЦИИ** and select 1–2 saved mechs.
2. The server freezes the selected chassis and pilot skills in a PostgreSQL
   mission draft. Other commanders cannot read or modify it.
3. Start the operation and advance one round per click. The API uses
   `packages/engine/engine.js` to simulate movement, initiative, firing,
   physical attacks, heat and damage **on the server** against two AI mechs.
   Each request persists the state and random generator position.
4. Completed operations produce a saved report with winner, rounds,
   damage, pilot wounds and battle log. Awards are calculated exclusively
   by the server and granted once, inside the database transaction.
5. The report is linked to the pilot's service record. Experience and
   rank update; the currently active hangar design is not automatically
   changed by damage. Stopping an operation grants no XP.
6. Automatic resolution ends in a draw after at most 12 rounds. It is
   intended as a campaign-operation prototype, **not yet an interactive
   server-authoritative version of the full 3D skirmish**. The existing
   quick battle continues to use local browser simulation and cannot
   grant verified XP or generate official campaign reports.

The endpoints are same-origin, cookie-authenticated, PostgreSQL owner-scoped:

- `GET/POST /api/v1/operations` — list/create operations
- `GET /api/v1/operations/{id}` — retrieve a saved draft, round or report
- `POST /api/v1/operations/{id}/launch` — lock a draft into an active battle
- `POST /api/v1/operations/{id}/advance` — simulate exactly one server round
- `POST /api/v1/operations/{id}/abandon` — close without rewards

All mutations require Origin and JSON {} for commands without parameters.
Clients cannot submit winner, arbitrary dice, damage, rank or XP.
Concurrent attempts are serialized by PostgreSQL row locks. A completed
operation cannot be advanced or rewarded again. Damage deductions, repair,
contracts, travel, hiring, economy and full interactive server 3D commands
are future work.


## 10. Interactive server-controlled 3D battle

Headquarters -> ОПЕРАЦИИ now includes the ИНТЕРАКТИВНЫЙ 3D-БОЙ mode, separate from the original local БЫСТРЫЙ БОЙ training mode. Choose one or two hangar mechs, optionally assign pilots, create and launch an operation. The tactical cockpit opens the animated 3D arena at index.html?battle=1&operation=<operation-id>.

The client does not calculate authoritative dice, armor, damage, attacks or victories in this mode. Each move, rotation, fire declaration, physical attack, heat/phase transition, advanced command or hold is sent to the API with the operation version. The backend checks the authenticated commander, the phase, and the rules engine's legal moves. It also takes AI turns and commits the updated state, version and random seed to PostgreSQL. The browser then draws the confirmed state and plays movement and hit animations.

API endpoints:
- GET /api/v1/operations/{id}/snapshot: returns public state and current version, never the random generator state.
- POST /api/v1/operations/{id}/command: accepts validated command type, version, and typed parameters only.

Stale versions, enemy commands and illegal actions are rejected. Once the combat ends, the database transaction records the result, creates a report, and awards pilot XP only once. The after-action report button returns to the operation archive. Saved operations can be resumed on a later visit.

This release remains single-player versus AI. It includes contract rewards, hangar wear and a fixed-price NPC dealer, but not multiplayer or player-to-player trading.

## 11. Starter economy and contracts

The first economy release is available in the existing command hub:

- **ОПЕРАЦИИ**: choose one of three fixed server contracts before creating an operation. The opponent's Gunnery stat changes with difficulty.
- **РЫНОК И РЕМОНТ**: view a C-Bills wallet and ledger, purchase repair supplies, and restore hangar mechs.
- **АНГАР**: damaged mechs show a repair cost and cannot enter a new operation until fully repaired.

Balances are integer C-Bills stored server-side. A commander receives one **150,000 C-Bills** starting grant upon first accessing the economy. Current contract victory pay is **32,000 / 56,000 / 92,000 C-Bills** for patrol / intercept / assault; draws pay 50% and defeats 20%. Payout and accumulated wear are recorded once when a server operation finishes, in the same transaction as the pilot XP and battle report. Abandoning an operation never grants payout.

Repairs cost **125 C-Bills per missing armor point**, **650 per internal structure point**, plus **8,000** to restore a destroyed chassis. A purchased armor kit costs **900** and offsets up to **10 armor points** in the next full repair. A structure kit costs **2,500** and offsets up to **5 structure points**. Existing supply kits are automatically consumed first during full repair. Prices are fixed by the server and cannot be changed by the client.

Authenticated same-origin API:
- `GET /api/v1/economy` — balance, supplies, offered contracts, repair quotes, recent credit ledger
- `POST /api/v1/economy/purchase` — `{"sku":"armor_patch","quantity":1}`
- `POST /api/v1/economy/repair` — `{"mechId":"<owned UUID>"}`
- `POST /api/v1/operations` — includes optional `contractId` (`patrol`, `intercept`, or `assault`)

All purchases, payouts and repairs are committed inside PostgreSQL transactions. The client never supplies a price, balance, damage, result or payout. Wallets and inventory are account-scoped; operations with damaged mechs are rejected. The historical `market_listings` table is still only a future foundation: **player-to-player trades, live pricing, chassis construction costs, travel, ammunition expenses and marketplaces are not implemented**. This prototype still lets players construct new hangar designs without paying for production.

## 12. NPC BattleMech dealer, warehouse and MechLab

The authenticated market now offers curated, technically imported BattleMechs from the MegaMek Data MTF catalog and individual weapons using the engine's equipment catalog. All offers have static prices and unlimited NPC availability. An authenticated commander may purchase a licensed mech with `POST /api/v1/economy/mechs/purchase` and body `{"offerId":"mm-grf-1m"}`. The operation creates an owned, working hangar mech and writes a debit in the financial ledger atomically. Sending an unknown offer or caller-supplied price is rejected. The hangar limit is 50.

The existing `POST /api/v1/economy/purchase` also accepts weapon SKUs, for example `{"sku":"weapon:Medium Laser","quantity":1}`, and stores quantities in `commander_equipment`. The `GET /api/v1/economy` reply includes `mechOffers`, `equipmentStock` and weapon entries in `catalog`, alongside the previous wallet, supply kit, repair and contract fields.

In MechLab, **licensed** hangar mechs can be refitted using the current `PATCH /api/v1/hangar/{id}` endpoint: the server compares old and new weapon counts, removes newly installed weapons from owned inventory, returns stripped weapons to the warehouse, and rejects insufficient stock. Engine rating, chassis mass, armor and factory-installed jump jets/heat sinks/hatchets are locked for these mechs; ammunition placement is not yet charged. Refitting damaged or mission-assigned mechs is blocked. Creating a free design, including **Save as new**, still works for training mode, but saves it with `market_owned=false` and does **not** qualify it for credited operations. Mechs in the database before this migration retain `market_owned=true` for compatibility.

The NPC dealer is not a player auction, and the `market_listings` schema remains inactive. Prices are noncanonical prototype balancing figures; no selling, scarcity model, transit times, paid assembly, or ammunition accounting is implemented.

## 13. MegaMek Data unit import

The NPC dealer is now driven by MTF files under `data/megamek/meks/`; source commit and original paths are recorded in `data/megamek/manifest.json`. The data is provided by **The MegaMek Team** under **CC BY-NC-SA 4.0**, with license text, original notices and a modification summary in `data/megamek/`. This is an unofficial, noncommercial game and no MegaMek endorsement is implied.

`apps/api/src/mtf.mjs` parses standard Inner Sphere biped unit files with supported technology only. It maps mass, walk/jump MP, engine, standard armor/rear armor, single heat sinks, mounted weapon locations and critical slots, and ammunition into the shared battle construction engine. It checks that the resulting unit has no construction errors before offering it. Unsupported/advanced equipment, configurations, or tech are excluded rather than inaccurately converted; import rejections can be inspected in `rejectedMtf` from `apps/api/src/market.mjs`. The import is **offline** from the bundled files: no production dependency on MekBay or GitHub API availability.

MTF files do not provide final unit C-Bills purchase prices. Prices shown by IronHex are transparent game-balance approximations (mass and armament formula), **not canonical BattleTech values**. Full MekBay mechanics, unit BV, rare tech, live market movements and additional unit classes are future work.

### Full index and server search

`data/megamek/full-index.json` is a pinned file-path index of **4,305** MTF variants from MegaMek/mm-data. `GET /api/v1/economy/mechs?query=Atlas&page=1&available=0` is an authenticated, paginated (36 per page) read-only search. Results distinguish reference-only listings (`available=false`) from playable imported units (`available=true`). The default search includes both. Buying an unavailable unit is rejected because it has no valid offer ID. Do not describe all 4,305 source variants as playable yet. Standalone equipment and engine specification expansion is a separate future importer, sourced from MegaMek's GPL-licensed definitions where legally appropriate.

### Market technical dossier and advanced filters

`GET /api/v1/economy/mechs/detail?path=<URL-encoded source path>` requires authentication and accepts only exact paths in the pinned 4,305-entry index. It returns a full server-derived design dossier for imported variants, including walking/running/jumping MP, engine, tonnage, era, heat sinks, component weights, locations, front/rear armor, structure, critical slots, weapon damage/heat/range/ammo and the source attribution. Reference-only variants return explicitly marked incomplete details and a link to the official source MTF. Unknown or traversal paths return 404; the server never uses an input path as a filesystem path.

The paginated `GET /api/v1/economy/mechs` search additionally supports `weightClass=light|medium|heavy|assault`, `tonnageMin`, `tonnageMax`, `eraMin`, `eraMax`, `priceMax`, `role`, `weapon`, and `sort=name|tonnage|year|price`; `query`, `available=1` and `page` continue to work. Filters execute against the complete index before returning the page. Mechs with unknown numerical values are not assigned guessed values: mass, year, price, role and weapon filters exclude reference-only entries that have not yet been imported. Weight class can also be read from an explicit source folder name. The modal is keyboard-accessible and renders trusted text, without injecting source HTML.

## 14. Shared component registry and ammo persistence

`packages/engine/equipment.js` is the source of truth for all currently playable standard 3025 weapons. Market merchandise is derived from the same definitions used by construction and combat; individual ammo SKUs are exposed as `ammo:LRM 20`, `ammo:AC/5`, etc., with economy-specific, noncanonical C-Bills prices. Unsupported advanced technologies have no active purchase action.

New additive migration: `hangar_mechs.ammo_state JSONB NOT NULL DEFAULT '{}'::jsonb`. The keyed object (`{"RT:5":12}`, for example) records rounds remaining in each mounted magazine after the most recent completed mission. Missing keys default to factory-full bins only for older saves, preserving backwards compatibility; an explicit zero **never** refills automatically. Refit operations preserve surviving bins by location/slot/weapon and consume owned ammo packs for newly installed or moved bins.

`GET /api/v1/economy` now returns `magazines` with location, slot, weapon, remaining rounds, capacity and pack SKU in addition to weapon inventory and purchase options. `POST /api/v1/economy/purchase` supports the new ammo SKUs, storing packs in `commander_equipment`. `POST /api/v1/economy/reload` takes exactly `{"mechId":"<owned UUID>","location":"RT","slot":5}` and, in one transaction, removes one matching purchased pack and refills that incomplete magazine. It requires same-origin authentication, a licensed mech that has been repaired and is not assigned to an open operation. Full magazines, absent packs, wrong owners and malformed requests are rejected. Ammo and damage changes from operations are committed with the result and payout. Mission reports show ammo usage per physical bin. No per-round automatic ammo purchasing is implemented.

Implemented physical refits: `system:jump` (Jump Jet), `system:sink` (Single Heat Sink) and `system:hatchet` (Hatchet) are merchandise generated from the same supported component registry. Licenced hangar PATCH operations reconcile their counts against `commander_equipment` in the same transaction as weapons and ammo. The player may increase/decrease jump MP and heat sink count by adding/removing the corresponding critical-slot equipment, subject to `construct()` mass and placement constraints. Removing a system returns it to stock; installing without owning one is rejected. Their combat effects already exist in the rules engine. Engine rating, chassis mass, armor distribution and actuator configuration remain locked. Next steps: advanced technology, replacement of damaged individual components and alternate engines/armor.

## 15. Persistent critical damage and component replacement

The additive migration `hangar_mechs.critical_damage JSONB NOT NULL DEFAULT '{}'::jsonb` keeps each occupied damaged critical slot by BattleMech section using 0-based slot indexes. It complements `ammo_state`, `armor_damage` and `structure_damage`; it does not replace them. At mission creation, the server snapshots critical damage, rejects destroyed cockpits and 3-hit engines, and applies other prior failures to the actual combat unit. Completing the operation writes `critical_damage` and the physical ammo results atomically with mission settlement. Saved core damage drives heat, mobility, gun and ammo effects in future sorties.

`GET /api/v1/economy` includes a `components` list of damaged parts, grouped by physical item, showing IDs, section, first slot, affected critical slots, required inventory key or server service price, whether the user owns a spare and whether the mech is licensed. `GET /api/v1/hangar` also exposes `criticalDamage` and the `brokenComponents` list for the owner's mech only.

`POST /api/v1/economy/components/repair` accepts exactly `{"mechId":"<UUID>","partId":"<server-listed part ID>"}`. It verifies login and same origin, ownership, active mission status, validated mech design and currently damaged component. If the part is a weapon or installed system, one *matching item* from `commander_equipment` is consumed; damaged ammo bins consume one matching ammunition pack and refill that physical magazine. Engine, gyro, sensors, actuators, cockpit and life-support maintenance debit a fixed service price from the wallet using the credit ledger. The database transaction removes only the repaired critical flags. A repeated request cannot consume stock or credit twice. A plain hull repair does **not** clear critical flags.

A licensed MechLab refit is blocked until physical critical damage is repaired; this prevents reclaiming broken guns as healthy spares. The repair interface explicitly separates hull armor/structure from individual component replacement. Ownership and mission locks prevent cross-account modifications and in-mission resupply.

Standard Inner Sphere ER Small, ER Medium and ER Large Lasers and ER PPC are supported as direct-fire energy weapons, including real tabletop heat, damage, critical slots and range brackets. They are sold by the NPC for prototype balance prices and use the same `construct` and combat representation as the rest of the market. Additional Inner Sphere and Clan pulse and ER energy weapons are enabled when their direct-fire rules are implemented. A `pulse_energy` weapon's stored `toHit=-2` is used by the real combat probability calculation, not just displayed. Full Clan chassis, specialized ballistics, advanced electronic warfare, alternate engines, exotic armor and AMS remain unavailable.
