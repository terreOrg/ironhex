# IRON HEX on CentOS Stream / Komodo

The repository contains a **three-service** Docker Compose stack:

- `ironhex-web`: non-root Nginx serving the existing BattleTech game
- `ironhex-api`: Node.js 24 API (read-only while authentication is unfinished)
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
wallet balances, campaigns and market transactions are not yet ready.

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

The API deliberately exposes **no mutating endpoints** until identity,
authorization, idempotency and server-authoritative transactions are built.
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
