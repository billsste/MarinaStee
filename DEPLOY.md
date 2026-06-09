# Marina Stee — deployment guide

Pattern A from the workspace `CLAUDE.md` §7.5 — Docker image is the deploy artifact, shipped from GH Actions to a DigitalOcean droplet via `docker save | ssh docker load`. Cloudflare proxies the public hostname.

This guide assumes the workspace conventions are already familiar — see `~/Desktop/Claude/CLAUDE.md` for the global rules and `~/Desktop/Claude/homefield-raise/` for the canonical reference deploy.

## Target environment

- **Public hostname**: `marina.stee-suite.com` (subdomain of the stee-suite root). Eventual marketing domain `marinastee.com` will redirect here, then flip the canonical when Convex + Clerk land.
- **Droplet**: `138.197.80.16` (alias `stee-suite-droplet`) — shared with `admin.stee-suite.com` (port 3500) + support/dashboard DBs (5433/5434). Marina Stee binds port **3600**.
- **Cloudflare zone**: `stee-suite.com` (proxy enabled, orange cloud). SSL mode Full (Strict) with the same origin cert Nginx already terminates for `admin.stee-suite.com`.

## Port reservation

Marina Stee claims **port 3600** on the host (bound `127.0.0.1:3600` → container `:3000`). Workspace App Registry currently uses:

| Port | App |
|---|---|
| 3000 | DockLog |
| 3001 | HomeField Raise |
| 3200 | HarborDesk |
| 3300 | Zayid Law CRM |
| 3400 | FieldPass |
| 3500 | support-server (Stee-Suite) |
| **3600** | **Marina Stee** |
| 5433 / 5434 | support / dashboard databases |

Add the row to the App Registry table in `~/Desktop/Claude/CLAUDE.md` §8 when this lands.

## Deploy modes

Marina Stee can deploy in three escalating tiers depending on which env vars are set:

### Tier 1 — Pure demo (default, zero secrets)

Ships the mock-data app. `lib/mock-data.ts` is bundled into the image; every operator and boater surface works. No DB, no auth, no agent (fallback to `lib/simulated-agent.ts`).

Required `.env` on the droplet:

```
NEXT_PUBLIC_APP_URL=https://marina.stee-suite.com
```

That's it. Useful for prospects + screen-share demos.

### Tier 2 — Live agent

Tier 1 + the `/api/agent` endpoint streams real Claude responses with PII tokenization. Still no DB; agent actions land in the in-browser mock store.

Add:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key from <https://console.anthropic.com/settings/keys>. The rate-limit bucket is per-tenant; with no Clerk org wired yet, the demo uses a single fallback tenant id.

### Tier 3 — Live multi-tenant (Convex + Clerk)

Full production mode. Convex backs the data layer; Clerk Organizations map 1:1 to marinas; every mutation writes an audit-log row.

Add to `.env`:

```
NEXT_PUBLIC_CONVEX_URL=https://acoustic-otter-123.convex.cloud
CONVEX_DEPLOYMENT=prod:acoustic-otter-123

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_JWT_ISSUER_DOMAIN=https://app.marinastee.com

POSTMARK_API_KEY=...
POSTMARK_FROM_ADDRESS=no-reply@marinastee.com
POSTMARK_WEBHOOK_SECRET=...
POSTMARK_INBOUND_SECRET=...

TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
TWILIO_WEBHOOK_SECRET=...
```

See `docs/architecture-convex.md` for the multi-phase rollout plan and `docs/convex-setup.md` for the Convex deployment dance.

## One-time setup (Steven actions)

### 1. Create the GitHub repo + push

Marina Stee doesn't have a remote yet. Create a repo (private, under your account or a Stee Suite org), then:

```
cd ~/Desktop/Claude/marina-stee
git remote add origin git@github.com:<owner>/marina-stee.git
git push -u origin main
```

The repo name becomes the `ghcr.io/<owner>/marina-stee` image path the GHA workflow pushes to.

### 2. Droplet directory

```
ssh root@138.197.80.16
mkdir -p /opt/apps/marina-stee
chown root:root /opt/apps/marina-stee
chmod 700 /opt/apps/marina-stee
```

### 3. Hand-author `/opt/apps/marina-stee/.env`

Pick one of the three tiers above. Don't commit this file — `.env` lives only on the droplet.

### 4. Cloudflare DNS

In the `stee-suite.com` zone:

- Type: `A`
- Name: `marina`
- Content: `138.197.80.16`
- Proxy: **enabled** (orange cloud)
- TTL: Auto

SSL mode for the zone is already Full (Strict). The same origin cert Nginx uses for `admin.stee-suite.com` covers `marina.stee-suite.com` if it's a wildcard (`*.stee-suite.com`); otherwise issue a Cloudflare Origin Certificate for `marina.stee-suite.com` and drop it next to the existing one.

### 5. Nginx vhost (on the droplet)

```nginx
server {
  listen 443 ssl http2;
  server_name marina.stee-suite.com;

  # Use the wildcard if Nginx already terminates *.stee-suite.com;
  # otherwise swap to a marina-specific cert pair you issued in step 4.
  ssl_certificate     /etc/ssl/cloudflare/stee-suite.com.pem;
  ssl_certificate_key /etc/ssl/cloudflare/stee-suite.com.key;

  location / {
    proxy_pass         http://127.0.0.1:3600;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }
}
```

`nginx -t && systemctl reload nginx` after.

### 6. GitHub repo secrets

In the repo's Settings → Secrets and variables → Actions, add:

| Name | Value |
|---|---|
| `SSH_PRIVATE_KEY` | Deploy key authorized for `root@138.197.80.16` (private key, including the BEGIN/END markers). You can reuse the key already on the droplet for stee-suite deploys. |
| `SERVER_HOST` | `138.197.80.16` |

`GITHUB_TOKEN` is auto-provided — used for GHCR push, no action required.

## Deploying

Once one-time setup is done, every push to `main` ships:

```
git push origin main
```

GHA runs `.github/workflows/deploy.yml`, which:

1. Builds the image (cache-busted by commit SHA)
2. Pushes to `ghcr.io/<owner>/<repo>:latest` and `:<sha>`
3. SCPs `docker-compose.yml` to the droplet
4. `docker save | ssh docker load` ships the image inline
5. `docker compose up -d --force-recreate app` swaps containers
6. SCPs `scripts/smoke.sh` to the droplet and runs it FROM the droplet (Cloudflare blocks GHA runner IPs at the edge so smoke from CI fails)

Expected during deploy: 60–90s window where the public URL returns 502 / Cloudflare error while `--force-recreate` swaps. **Do not roll back during this window** — it's the normal swap dance.

## Verifying a deploy

The "did my push actually land" check:

```bash
# Get the image hash GHA pushed (from the GHCR package page or `gh run view`)
gh run view --log

# On the droplet
docker inspect $(docker compose -f /opt/apps/marina-stee/docker-compose.yml ps -q app) \
  --format '{{.Image}}'
```

The hash on the droplet must differ from the previous deploy's hash. Container uptime (`docker ps`) should match the deploy time within a couple seconds.

## Rollback

```bash
ssh root@138.197.80.16
cd /opt/apps/marina-stee
# Find a known-good prior tag
docker images --filter=reference="ghcr.io/*/marina-stee" --format "table {{.Repository}}:{{.Tag}}\t{{.CreatedSince}}"
# Roll back
APP_IMAGE=ghcr.io/<owner>/marina-stee:<good-sha> docker compose up -d --force-recreate app
```

Image pruning runs after every successful deploy, but the most recent 2–3 SHAs typically survive.

## Local production build (sanity check before pushing)

```bash
# Build the same image GHA will build
docker build --build-arg CACHEBUST=$(git rev-parse HEAD) -t marina-stee-local .

# Run it locally on 3600 to catch standalone-build regressions
APP_IMAGE=marina-stee-local docker compose up

# Then in another shell
curl http://localhost:3600/apply  # should return 200 with no-referrer header
```

If this works locally, the GHA pipeline will work — the only delta is the SSH ship step.
