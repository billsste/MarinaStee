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

## List-page UX consistency (BLOCKING for every CRUD surface)

Every list/table page in Marina Stee must follow ONE structural template. Operators learn the vocabulary once and reuse it everywhere. Deviating fragments the product. The reference implementations live at **`/services/roster`** (Slips) and **`/services/waitlist`** — copy the shell from there, don't reinvent it.

### Required shape

```
<section className="space-y-4">
  {/* NO sub-heading. The Services / Members / Staff layout already
      provides the breadcrumb header for this page. Diving straight
      into the toolbar keeps every list surface visually identical and
      reclaims vertical space. */}

  {/* 1. Single-row toolbar — flex flex-wrap rounded-[12px] border border-hairline bg-surface-1 p-2 */}
  <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
    <Search input />                    {/* flex-1 min-w-[220px] */}
    <ListFilterSelect />                {/* one per facet — Dock, Cadence, Status, Class, … */}
    <ListFilterSelect />                {/* status filter ALWAYS shows live counts: "Active · 47" */}
    <Button>+ Add {entity}</Button>     {/* opens RecordEditDialog with editing=undefined */}
  </div>

  {/* 2. Flat row list — overflow-hidden rounded-[12px] border border-hairline bg-surface-1 */}
  <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
    <div className="grid ... bg-surface-2 px-3 py-2 text-[10px] uppercase tracking-wide text-fg-tertiary"
         style={{ gridTemplateColumns: COLS }}>
      <span>Col 1</span> <span>Col 2</span> ...
    </div>
    <ul className="divide-y divide-hairline">
      {filtered.map((row) => <Row key={...} onOpen={() => openEdit(row)} />)}
    </ul>
  </div>

  <div className="text-[11px] text-fg-tertiary">{filtered.length} of {total}</div>

  {/* 3. Edit dialog — RecordEditDialog with schema-driven fields */}
  <RecordEditDialog ... />
</section>
```

### Rules

1. **NEVER section the list by category** (no per-dock accordions, no per-class accordions). The Dock/Class/etc. column + the matching filter dropdown do that work. Two flat tables with the same structure beat one segmented surface every time.
2. **Click anywhere on a row → opens the RecordEditDialog** with that record loaded. No separate Edit / View buttons. Trash icons (if any) call `e.stopPropagation()`.
3. **Add button on the right of the toolbar** → opens the same RecordEditDialog with `record=undefined`. One dialog handles both create + edit.
4. **Filter facets live in `<ListFilterSelect>` dropdowns** with live counts on the Status filter (`{ value: "active", label: \`Active · ${counts.active}\` }`). Never per-row checkboxes for filtering — that's CLAUDE.md §6.3 territory.
5. **Pricing must reference `/services/rates`**. Do NOT redefine prices inline on a different entity. If a tier needs Annual / Monthly / Seasonal pricing, link `*_rate_id` fields to Rate rows — `lib/slip-type-helpers.ts → effectiveTypeRate / rateForSlipTypeCadence` is the resolver. Inline `default_*_rate` fields are fallback-only, used while the seed catches up. **`/services/rates` is the single pricing surface** — two tabs ("Slip pricing" for SlipType rows, "Other rates" for non-slip Rate rows), one nav entry. There is **no separate `/services/slip-types` page**; it was retired and consolidated here.
6. **Fees must reference `/services/fees`**. Same principle — `included_fee_ids: string[]` on the entity, not inline fee definitions.
7. **Every list page is mounted INSIDE `app/services/layout.tsx`'s right column**. Don't wrap the page in `<PageShell>` or import `<RentalsSubNav>` directly — the layout provides them. Same for `/members`, `/staff`, `/vendors`, `/settings/*` — the parent layout handles the breadcrumb + nav.
8. **No leftover sectioning helpers**. If you see a `*GroupedRoster` / `DockGrouped*` / `groupBy*` rendering component on a list surface, it's a smell — flatten it. Inventory views (Settings → Docks) are the exception because each group IS a manageable entity, not a filter axis.
9. **Every row is one line tall**. Padding `px-3 py-2.5` on the row button; cells use a single `<span>` per column with `truncate`. Sub-text (short labels, secondary IDs, helper context) goes into the row's `title` attribute as a tooltip — never a second line. Inconsistent row heights across list pages make the app feel patched together; the Slips page is the height anchor every other list matches.
10. **No `<h2>` + description paragraph above the toolbar**. The parent layout's breadcrumb is the only page identifier. Sub-pages that need extra context put it in an info panel or a `?` icon next to the relevant control, not a header block that pushes the toolbar down 60px every time.
11. **Single-row toolbar — no stacked chip rows above the filter bar.** Every list page uses ONE filter row: `Search · ListFilterSelect · ListFilterSelect · … · Add button` — that's it. NO custom segment-chip rows, NO secondary filter rows stacked above the dropdowns. If a facet is important enough to expose, it gets a `ListFilterSelect` dropdown in the same row as every other facet. Live counts go on the dropdown options (`Covered · 12`), never as a separate chip cluster. Operators learn ONE filter vocabulary that works identically on every list surface — Slip waitlist, Slip pricing, Other rates, Fees, Slips roster, Rental Boats, Meters. The custom "class chips above the filter bar" pattern in the prior waitlist (now removed) is the exact anti-pattern this rule forbids. Lifecycle tabs (Queue / Offers / Stale / Archive on the waitlist; Slip pricing / Other rates / Fees on rates) are fine because they expose distinct VIEWS — not filter axes stacked next to dropdowns.

### Field spec for the edit dialog

The dialog uses `FieldSpec<T>[]` (schema-driven). Compute it inside the view component when fields need live data (e.g. rate select options pulled from `useRates()`):

```ts
const FIELDS: FieldSpec<T>[] = React.useMemo(() => [
  { key: "name", label: "Name", kind: "text", required: true, col: 2 },
  { key: "annual_rate_id", label: "Annual rate", kind: "select",
    options: rates.filter(r => r.cadence === "annual")
                  .map(r => ({ value: r.id, label: `${r.name} · ${formatMoney(r.amount)}` })) },
  ...
], [rates]);
```

The dialog itself is canonical — don't write a bespoke modal per surface.

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
