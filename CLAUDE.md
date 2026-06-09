@AGENTS.md
@../CLAUDE.md

# Marina Stee — Project-Level Overrides

This project inherits everything in `~/Desktop/Claude/CLAUDE.md`. Where Marina Stee deviates, the choices are deliberate and listed below.

The framework (Next.js 16 App Router), styling (Tailwind v4), language (TS strict), DB target (Postgres), and icon set (lucide-react) all match the global. They aren't deviations.

## Deliberate departures from global CLAUDE.md

| Area | Global default | Marina Stee | Why |
|---|---|---|---|
| Component library | `shadcn/ui` via CLI | Hand-rolled shadcn pattern (Radix + cva + cn in `/components/ui/*`) | Tailwind v4 + React 19 + Next 16 had shadcn CLI friction at scaffold time |
| Folder structure | `/src/components/`, `/src/app/` | `/components/`, `/app/` at root | App Router convention; mock-data-first build with no `src/` boundary needed yet |
| Forms | React Hook Form + Zod | Hand-rolled `useState`-driven sheets in `components/create-sheet.tsx` | All "+ New" surfaces are demo sheets writing to a client store; RHF + Zod overhead isn't justified until a real backend lands |
| Global / UI state | Zustand or React Context | `useSyncExternalStore` singleton in `lib/client-store.ts` | API surface is tiny; subscribing pages stay reactive without the Zustand dep |
| Server state | TanStack Query | Direct fetch + NDJSON streaming (`lib/agent-fetch.ts`) | Streamed agent responses don't fit the cache model; will add Query when a real REST API exists |
| Backend (target) | Next.js API routes + Prisma 7 + Postgres | **Convex + Clerk + Anthropic** (see `docs/architecture-convex.md`) | Convex's TS-native reactive functions + Clerk Organizations = multi-tenant SaaS with less ceremony than Postgres + RLS. PII tokenization sits between `/api/agent` and Anthropic so boater names never reach the LLM in raw form. |
| Backend (today, mid-migration) | — | `lib/mock-data.ts` + `lib/client-store.ts` in browser. Convex schema scaffolded in `convex/` and `ConvexClerkProvider` is gated on `NEXT_PUBLIC_CONVEX_URL` — when unset, the mock-data app keeps working. | Additive migration — Phase 3 of the spec flips pages one at a time to live Convex queries. |
| Design library pick | Airbnb / Revolut (per global Hospitality row) | Stripe + Apple HIG + Superhuman blend (synthesized in `app/globals.css`) | Marina Stee is admin-dense ops tool (Stripe) + hospitality-warm (Apple HIG) + agent-keyboard-fast (Superhuman). Single-library pick would have lost one of those |

## Marina Stee-specific conventions (additive)

- **Design tokens** live in `app/globals.css` as CSS variables on `:root` + `.dark`, then re-exported via `@theme inline` so Tailwind generates utilities (`bg-surface-1`, `text-fg-muted`, `border-hairline`, etc.). Always use these tokens — never raw hex or Tailwind gray scales.
- **Money + numbers** must use `.money-display` / `.money-display-lg` / `.tabular` from `globals.css` (weight 300, tabular-nums, tight tracking — Stripe-derived).
- **Status colors**: `--status-ok` / `--status-warn` / `--status-danger` / `--status-info` are operational signal, not decoration. Use for occupancy, payment status, anomalies, sync state.
- **Agentic UX is the primary surface**, point-and-click is fallback. **Every UI create action must have a matching agent tool.** When adding a "+ New X" button: add a `create_X` to `ACTION_TOOLS` in `app/api/agent/route.ts`, a resolver in `lib/agent-fetch.ts`, an intent matcher in `lib/simulated-agent.ts`, and an executor in `lib/agent-actions.ts`. Every list page has an agent search/create input; every detail page has an "Ask →" rail.
- **Cross-entity connections must be visible inline** — never hidden behind a click chain. A Work Order shows its boater, vessel, slip, ledger entries, and comms on the same page.
- **Inline `style={{}}` is allowed** only for runtime-computed continuous values (progress bar widths, gauge fills) that Tailwind can't express cleanly.
- **PWA + future iOS**: `/dock` is the install target. Manifest + icons code-generated via Next 16 `manifest.ts` / `ImageResponse`. Native shell will come via Capacitor — keep web-standard APIs (no Electron-only assumptions).

## Carve-out from global §5 (Support Module)

The global says every app integrates a support portal that feeds `admin.stee-suite.com`. **Marina Stee does not.**

Stee-Suite is Steven's internal queue for his own bespoke client builds (Zayid Law, Iron Fortress, etc.). Marina Stee is a **true multi-tenant SaaS product** sold to independent marinas — its support tickets belong to *Marina Stee's own* operator backend, not Steven's personal roll-up. A boater or marina staff member filing a ticket in Marina Stee must never appear in Stee-Suite.

The support pattern itself (UX layout, ticket fields, conversation behavior, attachment proxy, cancel-not-delete) still applies — only the **destination** changes. When building:
- Same `/api/support/tickets/*` route shape as global §5
- Same client UI: `New Ticket` + `My Tickets` tabs, modal detail, status colors from Marina Stee tokens (not generic gray)
- Destination: Marina Stee's own support backend (TBD — likely a new table in the eventual Marina Stee Postgres + an operator dashboard at `admin.marinastee.com` or similar)
- Tenancy: tickets scoped to the boater's marina; one marina's support queue is invisible to another

## Open commitments (track these before "v1 done")

- **Backlog discipline**: Marina Stee is currently driven by the in-session `TaskCreate` list. When this becomes a real product, build its own backlog system (or use Stee-Suite for the *build-side* roadmap while keeping *product-side* customer tickets in the carve-out support backend above).
- **Support module**: not yet built. Per the carve-out above, when added it routes to Marina Stee's own backend, not `admin.stee-suite.com`.
- **Port assignment**: dev currently runs on whatever `next dev` picks (3000 / 3002 / etc.). When deploying, claim a free port in the App Registry — current taken: 3000 DockLog, 3001 HomeField Raise, 3200 HarborDesk, 3300 Zayid Law, 3400 FieldPass, 3500 support-server, 5433 / 5434 support+dashboard DBs.

## Backend architecture

**Marina Stee's production backend is Convex + Clerk + Anthropic.** Postgres + Prisma 7 are explicitly waived for this project. Full spec lives at `docs/architecture-convex.md` — that document is the authoritative reference.

Quick orientation:
- Convex tables defined in `convex/schema.ts`. Every table carries `tenantId: v.id("marinas")`.
- Tenant resolution in `convex/_helpers.ts` → `requireTenant(ctx)` — every query/mutation calls this first.
- Auth: Clerk Organizations = Marinas. Clerk JWT carries `org_id` claim. `ConvexProviderWithClerk` attaches it automatically.
- Audit log: `auditLog` table + `logAudit()` helper. Every mutation writes one row.
- PII tokenization: `/api/agent` swaps boater names/emails/phones for stable `<<KIND_id>>` handles before calling Anthropic, detokenizes on the way back. Anthropic never sees raw PII **on text inputs**.
- **PII boundary asymmetry — be honest about this:** the tokenization layer in `lib/pii-tokenizer.ts` applies to TEXT inputs only. **PDF + image inputs sent to `/api/pdf-extract`** (Claude vision for COI / vendor bills / contracts) carry the document's full contents verbatim — there's no general way to tokenize binary, and Claude's PDF mode needs the raw bytes to extract structure. Implications:
  - Holder-uploaded PDFs (e.g. `/portal/[token]/coi-upload`) MUST display a consent disclosure before the upload button. The disclosure names Anthropic as the processor and lists what gets extracted (carrier, policy number, vessel registration, owner name). Implemented in `components/portal/holder-coi-upload.tsx`.
  - Operator-uploaded PDFs (vendor bills, contracts) carry only operational data — names + invoice numbers — that the operator is already authorized to share with Anthropic via the agent path. No additional consent needed.
  - Long-term: route PDFs through an on-prem OCR pass (tesseract / pdfplumber) + tokenize identified PII before Claude. Tracked as Phase 8 work.
- Rate limiting: `rateLimits` table + per-tenant counter, checked before every `/api/agent` call AND every `/api/pdf-extract` call (added L3).
- File storage: Convex's built-in `_storage` for vessel photos, signed PDFs, logos.
- Payments: deferred (see spec § non-goals).

Migration phases 1–7 are tracked at the top of `docs/architecture-convex.md`. The existing mock-data app keeps working through Phase 4 — the new stack is additive until each page is flipped.

Inherited from global §1 Backend (still applicable):
- Audit log shape: `timestamp / actor_id / ip / action_type / payload_delta`
- Auth posture: short-lived JWTs, `HttpOnly` cookies (Clerk handles this)
- Rate limiting on `/api/agent` + any public POST
- Every mutation gates on auth + tenant scope before touching data
