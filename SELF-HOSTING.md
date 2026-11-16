# Self-hosting IRON HEX on the user's CentOS / Komodo server

IRON HEX is a static browser application. It has **no application database** and
does not require a Node.js server at runtime. The two large animated GLB models,
Three.js and the rules engine are included under `dist/`.

## 1. Deploy in Komodo

Create a new **Stack** named `ironhex` using the Git repository source:

| Setting | Value |
| --- | --- |
| Server | The CentOS host connected to Komodo |
| Source | Git repository |
| Repository | `terreOrg/ironhex` |
| Branch | `main` |
| Compose file | `compose.yaml` |
| Project name | `ironhex` |
| Run build / Build on deploy | **Enabled** |
| Environment (optional) | `IRONHEX_PORT=18088` |

Leave `Files on host` disabled when choosing the Git source. No custom Docker
network or shared volume is required. Deploy the Stack.

The compose file builds a non-root Nginx image and binds its sole port to
**127.0.0.1:18088**, not to the host's public/LAN interfaces.

If port 18088 is in use, change `IRONHEX_PORT` in Komodo before deploying.

Check from the host:

```bash
curl -fsS http://127.0.0.1:18088/health
curl -I http://127.0.0.1:18088/
docker ps --filter name=ironhex
```

The first command should print `OK` and the second return HTTP 200.

## 2. Publish only on the trusted LAN through host Caddy

Caddy remains a **systemd service on the host**, not a Docker container.
Add an independent site block to `/etc/caddy/Caddyfile`:

```caddyfile
http://ironhex.lan {
    reverse_proxy 127.0.0.1:18088
}
```

Then validate and reload:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

In Technitium DNS, add a local A record:

```
ironhex.lan -> 192.168.0.117
```

Open `http://ironhex.lan` from a device using that DNS (or a VPN client that
can reach the LAN and resolve `.lan`).

Do **not** add public DNS records or router forwarding for port 18088.
To add an HTTPS-only VPN/internal domain in the future, configure an explicit
Caddy site using the existing local-only wildcard certificate setup.

## 3. See changes in the running game

Commit changes to `main` on GitHub. Existing CI runs unit and browser tests.
In Komodo open the `ironhex` Stack and click **Deploy** (not just Restart).

Komodo updates the repository working copy and rebuilds the image from `dist/`.
The Compose service has `pull_policy: build`, so image contents are rebuilt.
Nginx requests are configured to revalidate cached HTML, JavaScript and GLB
assets, avoiding stale resources after a game update. Refresh the browser tab.

You can always redeploy an earlier Git commit by selecting it in the Komodo
stack Git configuration (then Deploy), or by reverting in GitHub.

**Important:** Do not enable Docker image auto-update expecting it to notice
changes to JavaScript in the Git repository. That feature checks remote image
digests, not the source tree.

## 4. Optional: auto-deploy

Komodo supports Stack Git webhooks. Enable Stack `webhook_force_deploy` and
`run_build` so that changes to `dist/**` also trigger an image rebuild (not
just edits to `compose.yaml`). The webhook endpoint is shown in Komodo under
the Stack's **Config -> Webhooks**.

The home Komodo dashboard is private. Do **not** expose it on the Internet
just to accept a GitHub push webhook. A safer follow-up is a post-CI GitHub
Actions job running on the existing local `jig`/`jog` runners that calls
the Komodo webhook **over the host's local network**, with a scoped secret.
Set up that action only after the first manual deployment succeeds.

## Security and limitations

- Nginx serves static files only; gameplay state and mech designs reside in
  each visitor's browser localStorage, not on this server.
- No multiplayer server is included. Hotseat and computer opponent still work.
- The service is loopback-only. Caddy determines who can reach it.
- Use this only with trusted commits: self-hosted runners on a publicly
  readable repository must not execute untrusted fork pull requests.
