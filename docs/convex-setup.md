# Convex + Clerk — One-Time Setup Runbook

> **Audience:** Steven (or anyone provisioning a fresh Marina Stee dev
> environment). Everything around the interactive steps is pre-staged in
> the repo — this doc is the **only** sequence of human moves required to
> bring the production backend online.
>
> **Companion docs:**
> - [`architecture-convex.md`](./architecture-convex.md) — the *why* and
>   the full backend spec.
> - [`migration-page-recipe.md`](./migration-page-recipe.md) — what to do
>   *after* setup is done (page-by-page Convex flip).

---

## What's already wired

You don't need to write any code for this. Everything below is shipped:

- `convex/schema.ts` — 30 tables, all carry `tenantId`, fully indexed.
- `convex/_helpers.ts` — `requireTenant(ctx)`, `logAudit(ctx, ...)`,
  `assertOwnedByTenant(...)`.
- `convex/auth.config.ts` — reads `CLERK_JWT_ISSUER_DOMAIN` from the
  Convex env, verifies the JWT template named `convex`.
- `convex.json` — minimal project config (function dir = `convex/`).
- `components/providers/convex-clerk-provider.tsx` — mounted in
  `app/layout.tsx`. Feature-flagged on `NEXT_PUBLIC_CONVEX_URL`: when
  unset, renders children pass-through; when set, wires
  `ClerkProvider` + `ConvexProviderWithClerk` and publishes
  `useConvexEnabled() === true` to the tree.
- `.env.example` — the canonical list of env vars (this file maps each
  one back to where you copy/paste it from).
- `package.json` — `convex` and `@clerk/nextjs` already installed.

The mock-data app keeps working until you finish Step 7 — every step
below is additive.

---

## Step 1 — Provision the Convex deployment

Run in the project root. This is **interactive** on first run.

```bash
cd ~/Desktop/Claude/marina-stee
npx convex dev
```

What happens:
1. The CLI opens a browser tab to log into Convex (GitHub sign-in is
   fine).
2. It asks for a **project name** — use `marina-stee`.
3. It asks where to put the deployment URL — choose `.env.local`. It
   will write:
   ```
   NEXT_PUBLIC_CONVEX_URL=https://<some-words>.convex.cloud
   CONVEX_DEPLOYMENT=dev:<some-words>
   ```
4. It pushes every file in `convex/` and starts watching for changes.

**Leave this terminal running** — it's your live function-deploy
watcher. Open a second terminal for the rest of the steps.

---

## Step 2 — Create the Clerk application

In a browser:

1. Sign up / log in at <https://clerk.com>.
2. Create a new application, name it **Marina Stee Dev**.
3. **Enable Organizations** — left sidebar → Configure → Organizations
   Management → toggle on. (Without this, multi-tenant scoping won't
   work; `requireTenant()` reads `org_id` from the JWT.)
4. Pick auth methods you want for dev (email + password is fine; Google
   OAuth nice-to-have).

---

## Step 3 — Create the `convex` JWT template in Clerk

This is the bridge between Clerk's session JWTs and Convex's auth
verifier.

1. Clerk dashboard → Configure → **JWT Templates** → New template.
2. From the "Templates" dropdown choose **Convex** (Clerk ships a
   first-party preset). If you don't see it, choose Blank and use this
   shape:
   ```json
   {
     "aud": "convex",
     "org_id": "{{org.id}}",
     "org_role": "{{org.role}}",
     "org_slug": "{{org.slug}}"
   }
   ```
3. **Name it exactly `convex`** (lowercase). `convex/auth.config.ts`
   sets `applicationID: "convex"` and they must match.
4. Save the template. Note the **Issuer URL** shown at the top — looks
   like `https://moving-falcon-12.clerk.accounts.dev`. You'll need
   this in Step 5.

---

## Step 4 — Paste Clerk keys into `.env.local`

Clerk dashboard → Configure → **API Keys**. Copy the two keys into
`.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

(They live alongside the `NEXT_PUBLIC_CONVEX_URL` /
`CONVEX_DEPLOYMENT` lines that `npx convex dev` wrote in Step 1.)

---

## Step 5 — Wire the Clerk JWT issuer to Convex

The issuer domain has to be set in **two** places — Next.js (so the
provider knows where to fetch the JWT from) and Convex (so the
verifier in `auth.config.ts` knows whose signatures to trust).

In `.env.local`:

```
CLERK_JWT_ISSUER_DOMAIN=https://moving-falcon-12.clerk.accounts.dev
```

Then push it to the Convex deployment. `convex/auth.config.ts` reads
this via `process.env` at deploy time — Convex functions don't see
your Next.js env vars, so this command is **not optional**:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://moving-falcon-12.clerk.accounts.dev
```

The `npx convex dev` terminal from Step 1 will re-push `auth.config.ts`
automatically when it sees the env change.

Verify:
```bash
npx convex env list
# should include CLERK_JWT_ISSUER_DOMAIN
```

---

## Step 6 — Restart Next.js and load the seed data

```bash
# Stop and restart the dev server so it picks up the new env vars.
# (next.config picks them up at process start; HMR does not refresh them.)
npm run dev
```

`ConvexClerkProvider` now sees `NEXT_PUBLIC_CONVEX_URL` and activates.
`useConvexEnabled()` returns `true` to any consumer.

In a third terminal, populate the dev deployment with the current
mock-data snapshot:

```bash
npx convex run seed:loadFromMockData
```

This is idempotent — re-running clears and re-inserts. It writes
everything in `lib/mock-data.ts` into Convex tables under a synthetic
Clerk org id (see `convex/seed.ts` for the org id it provisions
against — paste that into Clerk in Step 7 if needed).

---

## Step 7 — Sign in and verify a live Convex query

1. Open <http://localhost:3000> (or whichever port `next dev`
   chose).
2. Clerk will redirect you to sign-in if you're not already
   authenticated. Sign up with your email — this becomes your admin
   user.
3. After sign-in, Clerk will prompt you to create or join an
   **Organization**. Create one named after the seeded marina (check
   `convex/seed.ts` for the `clerkOrgId` it expects — you may need to
   either update the seed's org id to your real one, or update the
   `marinas.clerkOrgId` row in the Convex dashboard to match the new
   org).
4. Navigate to **`/settings/pos-locations`** — this is the first page
   migrated to Convex (per `docs/migration-page-recipe.md`). If
   everything is wired correctly:
   - The list renders from `api.pos.listLocations`, not mock data.
   - Opening Convex's dashboard (link in the `npx convex dev`
     terminal output) shows the query firing live as you navigate.
   - Editing a row → the change appears across browser tabs in
     real-time (Convex's reactive subscription doing its job).

---

## Step 8 — Smoke-test checklist

Walk through these in order. Any failure points back to one of the
steps above.

- [ ] `npx convex dev` is running, no errors in its log.
- [ ] `npm run dev` is running, no auth-related warnings in the Next
      console.
- [ ] Visiting `/` lands on a Clerk sign-in page (not a 500).
- [ ] After sign-in, an organization switcher appears in the topbar.
- [ ] `/settings/pos-locations` renders from Convex (verify via the
      Convex dashboard's "Function Logs" tab showing `pos:listLocations`
      calls).
- [ ] Creating a new POS location via the UI inserts a row in the
      Convex dashboard's Tables view in real-time.
- [ ] The audit log table (`auditLog` in the Convex dashboard) gains a
      row for that mutation.
- [ ] Open `/settings/pos-locations` in a second browser tab. Edit in
      one — the other updates within ~200ms with no refresh.
- [ ] Any page that hasn't been migrated yet (e.g. `/boaters`) still
      renders from `lib/mock-data.ts` — confirm by checking the
      `useConvexEnabled()` reads in `lib/use-tenant-query.ts`. (The
      pages should not have broken when Convex came online — additive
      migration means "until we flip you, you keep using mocks.")

If all eight check out — you're done. Phase 3 page-by-page migration
can now proceed per `docs/migration-page-recipe.md`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `requireTenant` throws "No organization on session" | Clerk JWT template missing `org_id` claim | Step 3 — re-check the template body |
| `requireTenant` throws "Marina not provisioned for Clerk org …" | The seeded marina's `clerkOrgId` doesn't match your actual Clerk org id | Either re-run the seed with the new id, or patch the row in the Convex dashboard |
| Convex dashboard says "no identity on request" | `CLERK_JWT_ISSUER_DOMAIN` only set in `.env.local`, not on Convex | Step 5 — `npx convex env set CLERK_JWT_ISSUER_DOMAIN ...` |
| Pages still read mock data after Convex is up | `useConvexEnabled()` returning false — env var not read by Next | Step 6 — fully restart `npm run dev`, HMR doesn't refresh env |
| `npx convex dev` asks you to log in again on every run | Cached creds expired or wrong machine | `npx convex login` once, then re-run |

---

## What you should NOT have to do

These are all pre-staged — if you find yourself doing them, something
upstream is broken and a code agent should fix it, not you:

- Hand-writing any file under `convex/` (the schema, helpers, and 28
  per-entity files are shipped).
- Editing `convex/auth.config.ts` (it reads from env — never hardcode
  the issuer URL).
- Wiring `ConvexClerkProvider` into `app/layout.tsx` (already mounted).
- Installing Convex or Clerk packages (already in `package.json`).
- Writing a JWT template manually (Clerk ships a Convex preset — use
  it in Step 3).
