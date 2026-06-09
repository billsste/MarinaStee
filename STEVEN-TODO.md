# Marina Stee — Steven action checklist

The two routes from "mock-data app in localhost" to "live production marina":

1. **Deploy the demo** — `DEPLOY.md` Tier 1. Ship the mock-data app to Cloudflare-fronted droplet. Zero secrets. Useful for prospect demos. ~30 min of work.
2. **Wire a real tenant** — Tier 3. Convex + Clerk + Anthropic + Postmark + Twilio. Real marina, real data, multi-tenant. ~2 hours.

The two routes are independent — you can do (1) without ever doing (2), or jump straight to (2) and skip the demo droplet entirely.

---

## Route 1 — Deploy the demo (Tier 1)

Follow `DEPLOY.md`. The order:

- [ ] **Claim port 3600** — add the row to `~/Desktop/Claude/CLAUDE.md` §8 App Registry (next to HomeField Raise 3001, FieldPass 3400, etc.)
- [ ] **Pick a droplet** — fresh or reuse an existing one (the existing 138.197.80.16 droplet that hosts support-server can absolutely host marina-stee on a different port)
- [ ] **SSH the droplet** — `mkdir -p /opt/apps/marina-stee` + chmod 700
- [ ] **Hand-author `/opt/apps/marina-stee/.env`** — at minimum: `NEXT_PUBLIC_APP_URL=https://demo.marinastee.com`
- [ ] **Cloudflare DNS** — A record → droplet IP, proxy enabled, SSL Full (Strict)
- [ ] **Nginx vhost on droplet** — `proxy_pass http://127.0.0.1:3600` (config block in DEPLOY.md)
- [ ] **GH repo secrets** — `SSH_PRIVATE_KEY` + `SERVER_HOST` (`GITHUB_TOKEN` is auto)
- [ ] **Push to main** — GHA does the rest

Verify with the image-hash check (DEPLOY.md "Verifying a deploy"). Expect 60–90s of 502s during `--force-recreate` — that's normal.

---

## Route 2 — Wire a real tenant (Tier 3)

This is a sequence: Convex first, then Clerk, then Anthropic, then comm providers. The mock-data app keeps working through every step — you flip pages one at a time.

### Step 2.1 — Convex deployment

Follow `docs/convex-setup.md` (already in repo). The fast version:

- [ ] `cd ~/Desktop/Claude/marina-stee && npx convex dev`
- [ ] Approve the interactive prompts — project name `marina-stee`, write env to `.env.local`
- [ ] Convex writes `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT` automatically
- [ ] Run the seed: `npx convex run seed:loadFromMockData`
- [ ] Verify in the Convex dashboard — should see ~30 tables populated

### Step 2.2 — Clerk org

- [ ] Create a Clerk app at <https://dashboard.clerk.com>
- [ ] **Enable Organizations** — Settings → Organizations (free tier supports it)
- [ ] **Create JWT template** — Configure → JWT Templates → New template named `convex` (lowercase) — template payload `{ "aud": "convex" }`
- [ ] Copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local`
- [ ] Copy the **Frontend API URL** (e.g. `https://moving-falcon-12.clerk.accounts.dev`) into `CLERK_JWT_ISSUER_DOMAIN` in `.env.local` **AND** the Convex deployment env:
  ```bash
  npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
  ```
- [ ] Create the first Clerk Organization — its `org_id` becomes the marina's `tenantId`
- [ ] Sign in via your app; create the corresponding marina row in Convex (the seed action handles the first one)

### Step 2.3 — Anthropic agent

- [ ] Get a key from <https://console.anthropic.com/settings/keys>
- [ ] Add `ANTHROPIC_API_KEY=sk-ant-...` to `.env.local` (local) AND to `/opt/apps/marina-stee/.env` on the droplet (prod)
- [ ] On the droplet: `docker compose up -d` to pick up the new env
- [ ] Test: ask a question on the dashboard's agent bar — should stream a real Claude response, audit-log row should show `via_agent: true`

### Step 2.4 — Postmark + Twilio (optional, can defer)

- [ ] Postmark — sign up, create a server, get API key. Add `POSTMARK_API_KEY` + `POSTMARK_FROM_ADDRESS` to env
- [ ] Postmark inbound — register `bills+<tenantId>@marinastee.app` style address → POST to `/api/inbound/postmark/[tenantId]`. Add `POSTMARK_INBOUND_SECRET`
- [ ] Postmark outbound webhook — POST to `/api/webhooks/postmark/[tenantId]` for delivery + bounce events. Add `POSTMARK_WEBHOOK_SECRET`
- [ ] Twilio — sign up, get a phone number, copy SID + auth token + number to env
- [ ] Twilio webhook — POST status callbacks to `/api/webhooks/twilio` (verified via the auth token). Set `TWILIO_STATUS_CALLBACK_URL` to the public hostname

Without these, every outbound comm shows `error_reason: "no_provider_configured"` on the timeline — the demo flow still works, just no real send.

---

## Reference docs already in the repo

| File | What it covers |
|---|---|
| `DEPLOY.md` | Droplet + CI side. Pattern A (GHCR → docker load via SSH). |
| `docs/convex-setup.md` | Convex + Clerk setup runbook, step-by-step interactive. |
| `docs/architecture-convex.md` | The *why* — full backend spec, phase-by-phase migration plan. |
| `docs/migration-page-recipe.md` | Page-by-page Convex flip recipe (read-paths + write-paths). |
| `docs/reference.md` | Surface map — every operator + boater route and what backs it. |
| `.env.example` | Annotated env-var template (copy → `.env.local`). |
| `AGENTS.md` | "This is NOT the Next.js you know" — Next 16 deprecation warnings. |

---

## Backend phase status (from `docs/architecture-convex.md`)

| Phase | Status |
|---|---|
| 0–2 (spec, scaffold, seed) | ✅ done |
| 3 (read-path migration) | 🟡 12 pages flipped via `useTenantQuery` |
| 4 (mutation-path migration) | 🟡 10 pages flipped |
| 5 (`/api/agent` rebuild + PII tokenization) | 🟡 23 agent actions routed; notification dispatch layer landed |
| 6 (audit log + rate limiting) | 🟡 local audit log shipped, Convex tables scaffolded |
| 7 (retire mock-data + client-store) | ⏳ pending until phase 3–6 finish per-page |

Each phase is independently shippable. **The mock-data app keeps working through every step** — you flip pages one at a time.

---

## When in doubt

1. Mock-data version works → `lib/mock-data.ts` is canonical.
2. Live Convex version works → `convex/*.ts` is canonical, the mock store is a fallback for surfaces not yet flipped.
3. Both diverge → check `docs/migration-page-recipe.md` for which side is authoritative for the route in question.
