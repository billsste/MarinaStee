# Marina Stee — Production Architecture (Convex + Clerk + Anthropic)

> Authoritative reference for the production backend. Supersedes the
> "Backend (today)" row in `AGENTS.md` and the §1 Backend section of
> `~/Desktop/Claude/CLAUDE.md` for the Marina Stee project only —
> Postgres + Prisma 7 are explicitly waived here.

## 0. Status

| Phase | Description | Status |
|---|---|---|
| 0 | Architecture spec (this document) | ✅ done |
| 1 | Foundation — install + schema + helpers + auth provider | ✅ done |
| 2 | Seed action — write current mock-data into Convex | ✅ done |
| 3 | Read-path migration — replace `useStore()` with `useQuery()` | 🟡 12 pages flipped through `useTenantQuery`: `/settings/pos-locations`, `/settings/customization?tab=docks`, `/settings/comm-templates`, `/settings/audit-log`, `/staff` Roster, `/settings/marina-profile`, `/insurance`, `/vendors` vendor list, `/settings/connections`, `/settings/customization?tab=picklists`, `/reports` (3 panels), `/staff` Roles & access. See `docs/migration-page-recipe.md` for the running progress table. Mock fallback remains live until Steven runs `npx convex dev`. |
| 4 | Mutation-path migration — replace store mutations with Convex mutations | 🟡 writes flipped on 10 of those 12 pages (POS/docks/comm-templates baseline + staff/marina/insurance/vendors batch + connections + roles). New Convex mutations added: `staff.create/remove`, `insurance.create/update/remove`, all of `vendors.*`, `providers.update`. Picklists writes + Reports (read-only) deferred. `staffMembers` schema extended (wage profile + clock pin) and `vendors` table added in earlier batch; Wave 3 deliberately packed Settings → Connections page-side fields into `providerConfigs.public_config` rather than extending the schema. |
| 5 | Agent route rebuild — `/api/agent` becomes auth-aware + PII-tokenized | 🟡 PII tokenization HARDENED (lib/pii-tokenizer.ts: per-request lazy tokenizer, `<<KIND_id>>` handle format, word-boundary + case-insensitive + possessive matching, tenant-scoped source-of-truth). 23 agent actions routed to Convex via `convex/agentActions.ts` + `ConvexAgentRouter` in lib/agent-actions.ts. **Wave 1 (kanban/reservations/comms):** update_work_order, create_work_order, create_reservation, update_reservation, send_message. **Wave 2 (customer/money/ops):** update_boater, create_boater, update_vessel, update_contract, charge_to_account, request_coi_renewal, close_boat_rental, create_meter_reading. **Wave 3 (lifecycle/money/quotes):** mark_signed (contracts + quotes), mark_invoice_paid, update_insurance, record_fuel_sale, create_quote, update_quote, void_contract, cancel_reservation, create_ledger_entry, draft_contract. **Notification dispatch layer landed:** `lib/notification-dispatch.ts` orchestrates Postmark (email) + Twilio (SMS) via REST `fetch` (no npm SDKs); `convex/communications.ts` now inserts comms as `status="queued"` and schedules `dispatchOne` via `ctx.scheduler.runAfter(0, ...)` to fire-and-forget the outbound send; new `markDelivered` / `markFailed` mutations stamp `delivered_at` + `provider_message_id` or `error_at` + `error_reason` on the row. Graceful degradation: no env vars = `error_reason: "no_provider_configured"`, no throw. Audit-log fires Convex-side only for routed actions (no double-write); mock path still calls logAuditLocal. `executeAgentActionAsync` is the entry point — lib/use-tenant-mutation.ts (Phase 4) will wire the React hooks into ConvexAgentRouter. Contract-status union is broader on the agent side (partially_signed/executed/renewed) than Convex; runConvexAction normalizes via mapping (executed→signed, partially_signed→sent, renewed→active) before dispatch. Webhook ingestion for delivery receipts / bounce events is deferred. |
| 6 | Audit log + rate limiting | 🟡 Local audit log shipped (lib/client-store.ts + /settings/audit-log); Convex audit table + rateLimits scaffolded but unused until Phase 5 |
| 7 | Retire `lib/mock-data.ts` + `lib/client-store.ts` | ⏳ pending |

Each phase is independently shippable. The existing app keeps working through Phase 4 — Convex stands up alongside.

**What's in the repo today:**
- `convex/schema.ts` — 30 tables, full indexes
- `convex/_helpers.ts` — `requireTenant`, `logAudit`, `assertOwnedByTenant`
- `convex/seed.ts` — bootstrap action ready to `npx convex run seed:loadFromMockData`
- Per-entity Convex files: boaters, vessels, docks, slips, contracts, reservations, workOrders, ledger, fees, staff, commTemplates, providers, pos, communications, marina, rates, picklists, roles, meters, fuel, boatRentals, insurance, waitlist, marinaEvents, quotes, audit, rateLimit, staffNotes
- `components/providers/convex-clerk-provider.tsx` — feature-flagged (renders children pass-through when `NEXT_PUBLIC_CONVEX_URL` is unset)
- `lib/pii-tokenizer.ts` + wiring in `app/api/agent/route.ts` — every Anthropic round-trip goes through tokenize → detokenize
- `lib/client-store.ts → logAuditLocal()` + `/settings/audit-log` — every approved agent action writes a row visible to the operator

## 1. Goals & non-goals

**Goals**
- Per-tenant data isolation enforced at the function boundary
- Realtime UI — operator approves an agent action → dockhand's PWA tile updates instantly
- TypeScript end-to-end with no schema drift
- Zero infrastructure to operate (managed services only)
- Boater PII never leaves Marina Stee infrastructure to reach the LLM in raw form
- Audit trail on every mutation

**Non-goals (explicit)**
- Stripe / payments integration — deferred (PCI scope handled separately)
- HIPAA — Marina Stee will not handle health-adjacent data (no liveaboard medical scope)
- Self-hosting — Vercel + Convex Cloud + Clerk Cloud only
- Postgres / SQL — Convex is the system of record

## 2. Stack

| Concern | Service | Cost at 1 marina | Cost at 100 marinas |
|---|---|---|---|
| Compute (web) | Vercel | $0 (Hobby) | ~$20/mo (Pro) |
| Data + functions + realtime + files | Convex Cloud | $0 (free tier) | ~$50–200/mo (Professional) |
| Auth + multi-tenancy | Clerk | $0 (free, ≤10k MAU) | ~$25–100/mo (Pro) |
| LLM | Anthropic API | usage-based | usage-based (rate-limited per tenant) |
| Email outbound | Postmark (later) | — | — |
| SMS outbound | Twilio (later) | — | — |

Total at 1 marina: ~$0. At 100 marinas: ~$100–300/mo + LLM usage.

## 3. System diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Marina Stee admin UI + /dock PWA + /portal)       │
└────────────────────────────┬────────────────────────────────┘
                             │ Clerk session JWT
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Vercel (Next.js 16 App Router)                             │
│  ├─ Page renders                                            │
│  ├─ /api/agent — auth-aware proxy w/ PII tokenization       │
│  └─ /api/draft-contract — same auth pattern                 │
└────────────┬─────────────────────────┬──────────────────────┘
             │                         │
             │ Convex client           │ Anthropic SDK
             │ (auto-subscribes)       │ (with tokenization)
             ▼                         ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│  Convex Cloud        │    │  Anthropic API               │
│  - Tables            │    │  - Receives tokenized prompts│
│  - Functions         │    │  - Returns tokenized replies │
│  - File storage      │    │  - Never sees raw PII        │
│  - Realtime push     │    └──────────────────────────────┘
└──────────────────────┘
             ▲
             │ verifies JWT from Clerk
             ▼
┌──────────────────────────────────────────────────────────┐
│  Clerk (auth + organizations = multi-tenant primitive)   │
└──────────────────────────────────────────────────────────┘
```

## 4. Tenant model

**One Clerk Organization = one Marina.** Membership in the org = staff access to that marina. A staff member who works at two marinas joins both orgs and switches via Clerk's `<OrganizationSwitcher />` widget.

Convex side:
- `marinas` table holds the `MarinaProfile` (branding, address, hours, tax defaults)
- `marinas.clerkOrgId` (string, indexed) is the mapping to Clerk
- Every other table carries `tenantId: v.id("marinas")`

Every Convex function starts with `const tenantId = await requireTenant(ctx)` which:
1. Reads `ctx.auth.getUserIdentity()` — fails if not authenticated
2. Pulls the `org_id` claim from the JWT
3. Looks up the matching `marinas._id` and returns it
4. Throws if no matching marina exists (i.e. Clerk org not provisioned in Marina Stee)

Queries filter on `tenantId` via indexed lookups. **There is no global query that crosses tenants** — even the Marina Stee internal admin would be a separate Convex deployment.

## 5. Convex schema (mapped from `lib/types.ts`)

Tables, grouped by domain. `tenantId` on every row, indexed. Embedded objects (Contact, Address, QuoteLineItem, etc.) live inside their parent document — they're not separate tables.

### Identity
- `marinas` — MarinaProfile + clerkOrgId, single row per tenant
- `staffMembers` — name, email, phone, role_id, status (`invited` | `active` | `suspended`), MFA flag. `clerkUserId` links to the Clerk user.
- `roles` — name, description, permissions[], is_system
- `providerConfigs` — Stripe / Postmark / Twilio / QuickBooks credentials (per tenant, encrypted)

### Customers
- `boaters` — display_name, billing_cadence, communication_prefs, primary_contact, additional_contacts[], address, cards_on_file[], notes, trust_score
- `vessels` — boater_id, name, year/make/model, dimensions, fuel_type, registration, hull_vin, photos[]
- `waitlistEntries` — boater_id (optional, anonymous OK), preferences, status, offered_slip_id
- `staffNotes` — boater_id, body, pinned, author_id, created_at
- `insuranceCertificates` — boater_id, carrier, policy_number, effective_start/end, document_url, status

### Physical inventory
- `docks` — name, short_name, prefix, sort_order, active
- `slips` — dock_id, dock (denormalized cache), number, class, dimensions, has_power/water, default_*_rate, current_occupancy_status
- `rentalGroups` — name, type (boat_rental / mooring_field / etc.)
- `rentalSpaces` — group_id, status, dimensions (legacy; merging into slips)

### Reservations + Contracts
- `reservations` — boater_id, vessel_id, slip_id, arrival_date, departure_date, type, status
- `contractTemplates` — name, type, body_markdown, attachments[]
- `contracts` — boater_id, template_id, vessel_id, slip_id, status, effective_start/end, annual_rate, signed_at, attachments[], onboarding_progress
- File storage: signed contract PDFs land in Convex file storage with `_storage` IDs

### Work + service
- `workOrders` — boater_id, vessel_id, slip_id, subject, activity_type, priority, assignee_user_id, status, quote_id, due_date
- `quotes` — work_order_id, line_items[] (embedded), total, status, signature_token

### Money
- `ledgerEntries` — boater_id, type, number, amount, open_balance, method, status, line_items[], qb_sync_status
- `posLocations` — key (enum), name, default_tax_rate, active
- `posCatalog` — sku, name, price, cost, location_keys[], taxable, active
- `posOrders` — location_id, customer_kind, line_items[], totals, payment_method, status, linked_ledger_entry_id

### Catalog
- `rates` — name, occupancy_type, cadence, amount, active
- `additionalFees` — name, amount, recurrence, applies_to[], accounting_line_item, linked_activity_type, linked_template_id, auto_attach

### Operations
- `meterReadings` — space_id, meter_number, current_reading, previous_reading, anomaly_flag
- `fuelInventory` — fuel_type, current_gallons, tank_capacity, reorder_threshold
- `fuelDeliveries` — fuel_type, gallons_delivered, supplier, cost
- `fuelSales` — fuel_type, gallons, total, payment_method, boater_id (optional)

### Boat rentals
- `rentalBoats` — name, type, status, hourly/half_day/full_day rates, photos[]
- `boatRentals` — boat_id, boater_id OR patron_name+contact, start_at, end_at, rate_kind, checkin_progress, status

### Communications
- `communications` — boater_id, type, direction, subject, body, sender_label, sent_at, status, related_entity
- `commTemplates` — kind, channel, subject, body_markdown, active, available_tokens[]
- `marinaEvents` — title, type, start/end, location, attendees

### Config + audit
- `picklists` — field_key, label, values[] (embedded)
- `auditLog` — actor_id, ip, action_type, target_entity, target_id, payload_delta (JSON), created_at, tenant_id (always)
- `rateLimits` — tenant_id + bucket_key + counter + window_started_at — for `/api/agent`

### Indexes (the ones that matter)
- `boaters.by_tenant_lastName` — for fuzzy search
- `boaters.by_tenant_active` — for list pages
- `ledgerEntries.by_tenant_boater_status` — for A/R aging
- `workOrders.by_tenant_status_priority` — for kanban
- `reservations.by_tenant_arrival` — for today's queue
- `slips.by_tenant_dock` — for roster grouping
- `auditLog.by_tenant_created_at` — for audit reports

## 6. Function layout

```
convex/
├── schema.ts           # All tables + indexes
├── auth.config.ts      # Clerk JWT verification config
├── _helpers.ts         # requireTenant, withAudit, etc.
├── boaters.ts          # list, get, create, update, archive
├── vessels.ts
├── slips.ts
├── docks.ts
├── contracts.ts
├── reservations.ts
├── workOrders.ts
├── ledger.ts
├── pos.ts
├── fees.ts
├── rates.ts
├── meters.ts
├── fuel.ts
├── boatRentals.ts
├── comms.ts
├── commTemplates.ts
├── insurance.ts
├── waitlist.ts
├── staff.ts
├── roles.ts
├── marina.ts           # MarinaProfile read/update (singleton per tenant)
├── picklists.ts
├── providers.ts        # Stripe/QB/Postmark/Twilio config
├── audit.ts            # auditLog queries + the helper
├── rateLimit.ts        # per-tenant counter + check
├── agent.ts            # actions called from /api/agent (server-only)
├── seed.ts             # one-time: write mock-data.ts into Convex
└── _generated/         # convex-generated — never edit
```

Each file follows the same pattern:

```ts
// convex/boaters.ts
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireTenant } from "./_helpers";

export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    const all = await ctx.db
      .query("boaters")
      .withIndex("by_tenant", q => q.eq("tenantId", tenantId))
      .collect();
    return activeOnly ? all.filter(b => b.active) : all;
  },
});

export const create = mutation({
  args: { /* shape matches Boater */ },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("boaters", { ...args, tenantId });
    await logAudit(ctx, { action: "boater.create", target: id, payload: args });
    return id;
  },
});
```

The agent's `executeAgentAction()` becomes a thin dispatcher that calls these mutations directly. There's no separate Postgres + ORM layer — the function IS the boundary.

## 7. PII tokenization at the LLM boundary

The agent route never sends raw boater names, emails, phones, or addresses to Anthropic. Tokenization wraps the SDK call.

### Algorithm
1. **Build context** — `buildContext()` queries Convex for the tenant's boaters/slips/etc. — same shape as today's static snapshot, but live and tenant-scoped.
2. **Tokenize** — walk the context + user prompt, replacing identifiable strings with stable handles:
   ```
   "David Emmons" → "{{boater_b_42}}"
   "david@example.com" → "{{email_b_42}}"
   "231-555-1234" → "{{phone_b_42}}"
   "Reel Time" → "{{vessel_v_17}}"
   "1234 Lake Dr" → "{{addr_b_42}}"
   ```
   The map (`{token → real}`) is held in a per-request `Map<string, string>` server-side. Never persisted.
3. **Send tokenized prompt to Anthropic.**
4. **Anthropic responds** — text deltas, tool_use blocks, tool args all contain only tokens (Claude operates on the tokenized representation).
5. **Detokenize on the way out** — before forwarding NDJSON to the browser, substitute tokens back. For tool_use blocks, detokenize the inputs (e.g. `boater_query: "{{boater_b_42}}"` → `boater_query: "b_42"`).
6. **Client receives detokenized text + structured action with real ids.**

### What Anthropic sees (worst case logged for 30 days)
- `"send a reminder to {{boater_b_42}}"` ← user prompt
- `"There are {{boater_b_42}} and 3 others with overdue balances..."` ← Claude reply
- Tool call: `send_message({ boater_query: "{{boater_b_42}}", body: "..." })`

Nothing identifiable. The mapping table never leaves our infrastructure.

### Implementation
`lib/pii-tokenizer.ts` (new):
```ts
export function tokenize(text: string, boaters: Boater[], vessels: Vessel[]): {
  tokenized: string;
  map: Map<string, string>; // token → real
}

export function detokenize(text: string, map: Map<string, string>): string
```

The tokenizer uses longest-match-first replacement so "David Emmons" wins over "David". For free-text body fields, we tokenize before sending and the rest of the system never sees the raw value in the Anthropic round-trip.

## 8. Audit log

Every mutation writes one `auditLog` row via a `withAudit()` wrapper:

```ts
export const updateBoater = mutation({
  args: { boater_id: v.id("boaters"), patch: v.object({...}) },
  handler: withAudit("boater.update", async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(args.boater_id);
    if (before?.tenantId !== tenantId) throw new Error("Cross-tenant access");
    await ctx.db.patch(args.boater_id, args.patch);
    return { before, after: { ...before, ...args.patch } };
  }),
});
```

`withAudit` captures:
- `actor_id` (from Clerk user)
- `tenant_id`
- `action_type` (e.g. `"boater.update"`)
- `target_entity` + `target_id`
- `payload_delta` — diff of before/after
- `ip` (from request context)
- `created_at`

Audit logs are tenant-scoped and never deleted. A future "Settings → Audit Log" page surfaces them.

Agent-initiated actions append `via_agent: true` to the audit row + the original prompt that triggered them, for traceability.

## 9. Rate limiting

`rateLimits` table: `(tenant_id, bucket_key, counter, window_started_at)`.

Two buckets active out of the gate:
- `agent.requests` — 500/day per tenant — caps LLM cost
- `agent.tokens` — soft alarm at $50/day per tenant — telemetry, not a hard block

Buckets are checked in `/api/agent` before the Anthropic call. Exceeded → 429 with `Retry-After`. The agent input UI surfaces a friendly "agent is resting until tomorrow" message.

## 10. Auth flow

1. User hits any page → `<ClerkProvider>` checks for session
2. Not signed in → redirected to `/sign-in` (Clerk-hosted, or embedded `<SignIn />`)
3. Signed in → `<OrganizationSwitcher />` in the topbar. If user is in multiple orgs, they pick one. If only one, it auto-selects.
4. Clerk JWT carries `sub` (user id) + `org_id` (current Clerk Organization)
5. `ConvexProviderWithClerk` passes the JWT to every Convex call
6. Convex verifies the JWT against the public key fetched from Clerk
7. `ctx.auth.getUserIdentity()` returns `{ tokenIdentifier, ...claims }` inside functions

Clerk Organization → Marina mapping is provisioned by a Convex mutation `marinas.provision({ clerkOrgId, displayName, ... })` which runs once when a marina onboards.

For `/api/agent` (Next.js API route), we read the JWT from the `Authorization` header (passed from the browser by the Convex client wrapper) and call Convex's HTTP API with it. Same auth model as the browser → Convex direct calls.

## 11. Migration plan (Phases 2–7)

### Phase 2 — Seed action
Write `convex/seed.ts` that imports `lib/mock-data.ts` (server-side, one-time use) and inserts everything into Convex tables for a synthetic Clerk org. Idempotent — re-running clears and re-inserts.

### Phase 3 — Read-path migration
Page-by-page. Replace `const boaters = useBoaters()` with:
```ts
const boaters = useQuery(api.boaters.list, { activeOnly: true });
```

Order (smallest blast radius first):
1. `/settings/staff` — small, low-traffic
2. `/settings/marina-profile`
3. `/settings/docks` + `/settings/pos-locations`
4. `/inbox` — communications list
5. `/notifications`
6. `/boaters` list + detail
7. `/slips/roster`
8. `/slips/contracts`
9. `/work-orders`
10. `/ledger`
11. Dashboard
12. `/dock` (PWA)

Each page can be flipped independently. While a page is on Convex, the rest still read `lib/mock-data.ts`.

### Phase 4 — Mutation-path migration
Same order. Replace `addBoater(boater)` with `await createBoater(args)` (the `useMutation` hook). Action executor in `lib/agent-actions.ts` switches over.

### Phase 5 — `/api/agent` rebuild
- Read auth from request → derive tenant
- Build context from Convex (per-tenant)
- Pass through PII tokenization
- Call Anthropic
- Detokenize stream
- Tool executors call Convex mutations directly

### Phase 6 — Audit log + rate limiting
- Add `withAudit` wrapper to every mutation
- Add `rateLimits` checks to `/api/agent` + `/api/draft-contract`
- Surface audit log in Settings

### Phase 7 — Retire mocks
Delete `lib/mock-data.ts` and `lib/client-store.ts`. Keep a tiny `lib/types.ts` (entities still need types — they're shared with Convex). Replace any remaining seed-data references with Convex queries.

### Phase 8 — Deferred sweep findings (track here, ship when product priority surfaces)

These were flagged in a code-review sweep but require product / infra decisions, not just engineering. Listed for visibility; each can become its own wave when the trigger arrives.

**Lead-table refactor** — `applications` (prospective boater applying for a slip) and `waitlistEntries` (prospective boater waiting for one) duplicate the prospective-patron concept. They both carry `applicant_first_name | last_name | email | phone | vessel_name | vessel_loa_inches | preferred_slip_class`. On approval, an Application creates a Boater + Vessel; on accept, a Waitlist offer creates the same. The state machines overlap (`pending` exists in both; `declined` exists in both; `approved` in one maps to `converted` in the other).

The right depth: a `leads` table with the contact + vessel info as the source of truth. `applications` and `waitlistEntries` both reference `lead_id`. Deduping "is this person already on the waitlist?" becomes a `leads` lookup. Merging duplicate applicants is a single-row update. Operator UX gains: a Lead detail page that shows ALL the surfaces this prospect touches.

Trigger: when a marina onboards 50+ leads and operators complain about duplicate-applicant-detection, or when the Stripe-Connect pricing model needs a unified "leads ingested per month" metric. Not before — premature normalization here costs more than the current denormalization does.

**KMS / envelope encryption for provider secrets** — `marinas.postmark_api_key` and `marinas.twilio_auth_token` are persisted as `v.string()` plaintext. The L1 wave audit-redacts them out of `audit_log.payload_delta` and the H2 marina-profile UI masks the input, but the row itself stores plaintext.

Real fix needs an external KMS (AWS KMS, GCP KMS, or Convex's eventual encrypted column) and an envelope-encryption helper in `lib/secret-vault.ts` that takes/returns strings, decrypts only inside the dispatcher's server context, never on the wire to the browser.

Trigger: SOC2 / compliance review, or the first real customer's IT-Sec team asking "where do you store our Twilio token". Document the gap until then.

**PDF extraction as Convex action** — `/api/pdf-extract` is a Next.js route that calls Anthropic directly with the workspace `ANTHROPIC_API_KEY`. L3 wired per-tenant rate-limit + audit via `fetchMutation`, but the Anthropic call itself still lives outside the Convex trust boundary.

Right depth: a `convex/pdfExtract.ts` `action` that takes `pdfBytes: v.bytes()` + `kind` + auth context, calls Anthropic from inside Convex's runtime, writes the audit row + rate-limit increment atomically. The Next.js route becomes a thin forwarder that handles multipart + magic-byte + size cap (those don't belong in Convex).

Trigger: when Convex's `v.bytes()` arg limit is large enough for our PDF size cap (currently 8MB action arg limit vs our 20MB PDF ceiling), OR when we have a real Clerk-org-scoped reason to need server-side tenant audit on every call.

**Audit log payload PII** — `applicant_email` is now redacted out of `application.submit` audit rows (L1). Similar PII may live in other audit `payload_delta` blobs we haven't swept. A `scrubPayloadDelta(payload, entity)` helper that knows which fields are PII per entity, called from every `logAudit`, is the right shape. Today's per-callsite redaction works but is brittle.

Trigger: GDPR / right-to-be-forgotten implementation; or first customer audit-log export request.

## 12. Local dev workflow

```bash
# Two terminals:
npm run dev              # Next.js dev server (port 3000 or whatever)
npx convex dev           # Convex dev — watches convex/*.ts, syncs to dev deployment

# Env vars (.env.local):
NEXT_PUBLIC_CONVEX_URL=https://...convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
ANTHROPIC_API_KEY=sk-ant-...
```

`npx convex dev` is interactive on first run — creates a Convex deployment, writes the URL to `.env.local`, then watches the `convex/` directory and pushes changes live.

## 13. Production deploy

- Vercel: standard Next.js deploy. Set env vars in Vercel dashboard.
- Convex: `npx convex deploy --prod` → deploys to production Convex deployment. Vercel build hook can run this automatically.
- Clerk: production keys are pasted into Vercel env vars.

No infrastructure to manage.

## 14. Steven's setup steps (one-time)

These can't be automated — Steven completes them in a browser:

1. **Create Convex account** → `https://convex.dev` → sign up with GitHub
2. **Create Clerk account** → `https://clerk.com` → sign up
3. **In Clerk dashboard:**
   - Create a new application "Marina Stee Dev"
   - Enable **Organizations** (Settings → Organizations → toggle on)
   - Copy the Publishable Key + Secret Key
4. **In the project:**
   ```bash
   cd ~/Desktop/Claude/marina-stee
   npm install   # picks up the new convex + @clerk/nextjs deps
   npx convex dev # interactive — pick a project name, paste Clerk auth config when prompted
   ```
5. **Add to `.env.local`:**
   ```
   NEXT_PUBLIC_CONVEX_URL=<from npx convex dev>
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<from Clerk dashboard>
   CLERK_SECRET_KEY=<from Clerk dashboard>
   ```
6. **Configure Clerk → Convex bridge** in Clerk dashboard:
   - JWT Templates → New Template → "convex"
   - Use the template Convex provides in their docs
   - The issuer URL goes into `convex/auth.config.ts`

After these steps, run the seed action once:
```bash
npx convex run seed:loadFromMockData
```

That populates the dev Convex instance with the current `lib/mock-data.ts` for a demo Clerk org. The existing pages keep reading from `lib/mock-data.ts` until Phase 3 starts.

## 15. Open questions

- **Clerk pricing trip points** — free tier covers ≤10k MAU + Organizations. We monitor.
- **Realtime budget** — Convex bills per function call; "subscribe to every boater" patterns need targeted queries. Pages should pass tight filters (`status: "active"` etc).
- **Search** — Convex has full-text search for indexed fields. Fuzzy "find by partial name" patterns we currently do in `lib/agent-fetch.ts` move to Convex full-text indexes.
- **File storage limits** — Convex free tier = 1 GB. For vessel photos at scale we'd move to a CDN (Cloudflare R2) for hot files, Convex storage for signed PDFs only.
- **Backup strategy** — Convex has point-in-time recovery on Pro. For free tier we can run a nightly export action that writes to S3-compatible storage.

---

Last updated: 2026-05-27. Owner: Steven. Reviewers: Marina Stee build team.
