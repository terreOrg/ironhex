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
| Build on deploy | **Enabled** |

In **Stack environment variables**, set a long random password:

```
IRONHEX_DB_PASSWORD=<set-a-unique-strong-password-in-Komodo>
IRONHEX_PORT=18088
IRONHEX_API_PORT=18089
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

For now the browser still runs the same AI/hotseat game independently from
the backend. Online gameplay, users, wallet balance, campaigns and market
transactions are not ready yet.

## 4. Seeing updates

Commit updates to `main` and ensure Actions are green. In Komodo press
**Deploy**, not just Restart. This fetches changes and rebuilds both images
(using canonical web sources and shared engine). Refresh the browser. For
existing Sites publishing, run `node scripts/build-web.mjs` and commit
generated `dist` files as well.

A future automated deployment can be triggered locally by GitHub Actions
on `jig`/`jog` after tests succeed. Do not publicly expose Komodo just
to receive webhooks.

## 5. Persistence and security

The DB volume retains application schema across routine rebuilds. Back it up
before upgrades and never use `docker compose down -v` on this stack.

The API deliberately exposes **no mutating endpoints** until identity,
authorization, idempotency and server-authoritative transactions are built.
The current game has local browser state only. Keep Ironhex limited to LAN/VPN
unless you add authentication, rate limits, and more restrictive controls.
