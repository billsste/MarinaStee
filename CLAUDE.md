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
| Backend (today) | Next.js API routes + Prisma 7 + Postgres | Frontend-only mock data in `lib/mock-data.ts` + a single `/api/agent` route that proxies Claude tool-use | Greenfield prototype — backend follows the global to the letter once we commit to persistence |
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

## When adding the real backend

Follow `~/Desktop/Claude/CLAUDE.md §1 Backend` strictly:

- **Next.js API routes (App Router)** as the primary surface — colocate with the `/app` tree
- **Prisma 7** with `@prisma/adapter-pg`; migrations via `prisma migrate`, not numbered SQL files
- **PostgreSQL** (local or Supabase / DigitalOcean managed)
- Every table: `created_at` + `updated_at` (`DEFAULT NOW()`), FK + indexes explicit, RLS where appropriate
- Auth: short-lived JWTs with refresh rotation; `HttpOnly` + `Secure` + `SameSite=Strict|Lax` cookies; MFA on admin
- Security: bcrypt 12+ rounds, helmet equivalents on responses, explicit CORS, parameterized queries via Prisma, ALE for PII fields (boater contact info, payment metadata)
- Audit log on every mutation: `timestamp / actor_id / ip / action_type / payload_delta`
- Response shape: `{ success, data | error }` with correct HTTP status codes (200 / 201 / 400 / 401 / 403 / 404 / 500)
- Rate limiting on `/api/agent`, `/api/support/*`, and any public POST
