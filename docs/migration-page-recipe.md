# Phase 3 + 4 — Page Migration Recipe

Companion to [`architecture-convex.md`](./architecture-convex.md). That
document defines *what* Phase 3 and 4 do (additive read- and write-path
migration, page-by-page); this document defines *how* to flip one page.

Use this recipe verbatim for every page in the Phase 3 + 4 order list.

---

## 0. Prerequisites (one-time)

These are already done — listed for context.

- `convex/schema.ts` carries every table with `tenantId: v.id("marinas")`.
- `convex/_helpers.ts → requireTenant(ctx)` gates every query.
- `components/providers/convex-clerk-provider.tsx` is mounted in
  `app/layout.tsx` and publishes `useConvexEnabled()` to the tree.
  When `NEXT_PUBLIC_CONVEX_URL` is unset, the provider yields
  `enabled = false` and the rest of the migration is a no-op (mock
  data renders).
- `lib/use-tenant-query.ts` exports `useTenantQuery()` — the seam.

## 1. Pick the target page

Per `architecture-convex.md` § Phase 3 order:

1. `/settings/staff`
2. `/settings/marina-profile`
3. `/settings/docks` + `/settings/pos-locations`   ← **first migrated, ✅ done**
4. `/inbox`
5. `/notifications`
6. `/boaters` list + detail
7. `/slips/roster`
8. `/slips/contracts`
9. `/work-orders`
10. `/ledger`
11. Dashboard
12. `/dock` (PWA)

Take the next item. **One page per PR.** Each page is independently
shippable; while it's migrated, every other page still reads
`lib/mock-data.ts`.

## 2. Confirm Convex side is ready

For your page, open `convex/<entity>.ts` and verify there's a `list`
(and any other read used by the page). If not, add it — follow the
pattern in `convex/docks.ts` or `convex/pos.ts`:

```ts
export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("docks")
      .withIndex("by_tenant", q => q.eq("tenantId", tenantId))
      .collect();
    return activeOnly ? rows.filter(d => d.active) : rows;
  },
});
```

Every query MUST start with `await requireTenant(ctx)`. No exceptions.

## 3. Map the mock shape to the Convex shape

The mock types in `lib/types.ts` use `id` + `tenant_id`. Convex docs
use `_id` + `tenantId`. Some embedded fields might also differ
slightly (legacy denormalizations, optional fields, etc.).

In the page file, declare a `Convex<Entity>` interface that mirrors
the Convex doc shape, then a `convex<Entity>ToMock()` adapter:

```ts
interface ConvexPosLocation {
  _id: string;
  tenantId: string;
  key: PosLocation["key"];
  name: string;
  // …
}

function convexLocationToMock(rows: ConvexPosLocation[]): PosLocation[] {
  return rows.map(r => ({
    id: r._id,
    tenant_id: r.tenantId,
    // …
  }));
}
```

This adapter is the **only** place the call site cares about Convex
field names. The rest of the component continues consuming
`PosLocation` from `lib/types.ts`.

## 4. Wire `useTenantQuery`

Replace the `useStore`/mock subscription with the seam hook. Keep
the original mock subscription as the fallback source — the helper
hook *requires* it (so React's hook order is stable regardless of
which branch is active).

```ts
import { anyApi } from "convex/server";
import { useTenantQuery } from "@/lib/use-tenant-query";

const mockLocations = usePosLocations();              // unconditional
const locations = useTenantQuery<PosLocation[], ConvexPosLocation[]>({
  mock: mockLocations,
  convexRef: anyApi.pos.listLocations,                // string-typed today
  convexArgs: React.useMemo(() => ({}), []),          // stable identity
  convexAdapter: convexLocationToMock,
});
```

### `anyApi` vs `api`

Today: `anyApi.pos.listLocations` (from `convex/server`) — works
*without* `convex/_generated/` existing on disk. Phase 3 can ship
ahead of Steven running `npx convex dev`.

After `npx convex dev` runs once: swap to
`api.pos.listLocations` from `@/convex/_generated/api` for stronger
types (the args + return shape become inferred end-to-end). The hook
signature is the same.

### Memoize `convexArgs`

Convex `useQuery` dedupes subscriptions by reference identity on args.
Always wrap the args object in `React.useMemo(() => ({...}), [deps])`
unless the value is literally `{}` and you re-export a module-level
empty object.

## 5. Leave the mock mutations alone (for now)

Phase 3 is **read-only**. The page's "+ New X" / "Save" / "Delete"
buttons should continue calling the mock-store mutations
(`upsertPosLocation`, etc.). Phase 4 swaps those for
`useMutation(api.x.create)` etc.

Keeping mutations on the mock side during Phase 3 means:

- Demos still work end-to-end with mock data
- The Convex deployment doesn't have to be writeable yet
- If the read flip causes a regression we can revert one component,
  not the whole entity

## 6. Verify

```bash
npx tsc --noEmit       # must be clean
npm run dev            # confirm the page still renders with NEXT_PUBLIC_CONVEX_URL unset
```

With `NEXT_PUBLIC_CONVEX_URL=` blank (the default during prototype),
the page should be visually identical to before the migration — same
seed data, same interactions, same edit flow.

To smoke-test the Convex path locally:

1. `npx convex dev` (interactive, one-time setup — see
   `architecture-convex.md` § 14).
2. `npx convex run seed:loadFromMockData` to populate the dev
   deployment from `lib/mock-data.ts`.
3. Add `NEXT_PUBLIC_CONVEX_URL=<dev url>` to `.env.local`.
4. Restart `npm run dev`. The page should now read from Convex —
   confirm via the Convex dashboard's "Logs" tab that
   `pos:listLocations` fires when the page loads.

## 7. What's still TODO after a Phase 3 flip

A flipped page is **read-live, write-mock**. Before the page is fully
on Convex it still needs:

- **Phase 4** — replace the mock mutation calls with
  `useMutation(api.x.create | update | archive)`. The Convex side is
  already wired (`createLocation`, `updateLocation`, `archiveLocation`
  in `convex/pos.ts` for this example).
- **Phase 5** — agent action executor (`lib/agent-actions.ts`) calls
  the Convex mutation directly with tenant context derived from Clerk.
- **Phase 6** — every mutation routes through the `withAudit` helper
  (already shipped in `_helpers.ts → logAudit`). The page-level audit
  log surface (`/settings/audit-log`) starts reading from
  `auditLog` via Convex too.
- **Clerk Organization context** — every Convex call assumes the user
  is signed into a Clerk Organization (the `org_id` JWT claim
  resolves to a `marinas._id`). The page itself doesn't have to do
  anything for this — `requireTenant(ctx)` handles it server-side —
  but the dev-time test plan must include signing into an org with a
  provisioned marina.
- **Phase 7** — when every page has migrated, retire the matching
  hooks in `lib/client-store.ts` and the seed data in
  `lib/mock-data.ts`.

## 8. Open the next ticket

After the page ships, move the next item in the order list to "in
progress" and repeat. The seam (`useTenantQuery`) does NOT have to
change. The recipe stays identical page-to-page.

---

## Reference: pages migrated so far

| Page | Convex queries used | Adapter | Notes |
|---|---|---|---|
| `/settings/pos-locations` | `pos.listLocations` | `convexLocationToMock` | First migration. Read-only — writes still use `upsertPosLocation` / `deletePosLocation` until Phase 4. Convex mutations `pos.createLocation`, `pos.updateLocation`, `pos.archiveLocation` are scaffolded and waiting. |
| `/settings/customization?tab=docks` (`components/settings/docks-view.tsx`) | `docks.list` | `convexDocksToMock` | Reads only. Writes (`upsertDock` / `updateDock` / `deleteDock`) stay on the mock store until Phase 4. Convex `docks.create` / `docks.update` / `docks.archive` are scaffolded. Note: `/settings/docks` is a redirect to `/settings/customization?tab=docks`; the live surface is `DocksView` rendered inside `customization-view.tsx`. |
| `/settings/comm-templates` (`components/settings/comm-templates-view.tsx`) | `commTemplates.list` | `convexCommTemplatesToMock` | Reads only. Writes (`updateCommTemplate`) stay on the mock store until Phase 4. Convex `commTemplates.update` is scaffolded. The mock `CommTemplate.kind` is a string-literal enum while the Convex schema stores `kind` as a free string — the adapter casts back to the enum type. |
| `/settings/audit-log` (`components/settings/audit-log-view.tsx`) | `audit.list` | `convexAuditToMock` | Read-only by design — the audit log is append-only and entries land via `logAudit()` from every Convex mutation. Today still reads from the local store; once Phase 4 lands the entries will start flowing from real mutations and this view will reflect them automatically. |
| `/staff` Roster (`app/staff/staff-client.tsx → RosterView`) | `staff.list` | `convexStaffToMock` | Reads + writes both flipped. Schema extended (`default_position`, `employment_type`, `hourly_rate`, `salary_annual`, `mobile_clock_pin`, `pto_hours_balance`) so wage profile + clock identity round-trip. Schedule / Timecards / Certifications sub-sections stay on the mock store — they read different entities (shifts/timeEntries/certifications) outside this migration's scope. |
| `/settings/marina-profile` (`components/settings/marina-profile-view.tsx`) | `marina.getCurrent` | `convexMarinaToMock` | Reads + writes both flipped via a context pair (`NotifySavedContext`, `SavePatchContext`) — see the "Marina-profile Saved flash" note below. Singleton read: the hook is generic over the mock's shape, returns one object. Logo + retention variants stay mock-only until file storage lands at the page level. |
| `/insurance` (`components/insurance/insurance-view.tsx`) | `insurance.list` | `convexCoiToMock` | Reads + writes flipped for the basic CRUD. The Insurance COI agent owns expiry detection + reminder + PDF ingest in `convex/insuranceCoi.ts` (separate file). Mock's `liability_limit` maps to Convex's `coverage_amount`; `vessel_id`/`hull_value`/`pdf_url`/`uploaded_at`/`uploaded_by` stay mock-only until the COI agent extends the schema. |
| `/vendors` Vendor list (`app/vendors/vendors-client.tsx → VendorListView`) | `vendors.list` | `convexVendorsToMock` | Reads + writes both flipped. New `convex/vendors.ts` + new `vendors` table in schema (mirrors `lib/types.ts → Vendor`). Bills sub-section stays on the mock store — Bill entity hasn't migrated yet. |
| `/settings/connections` (`components/settings/connections-view.tsx`) | `providers.list` | `convexProvidersToMock` | Reads + writes both flipped. Schema NOT extended (per Wave 3 directive) — page-side fields (`display_name`, `status`, `config` map, `connected_at`, `last_error`) are packed into the existing `public_config` JSON blob. `convex/providers.ts:update` merges incoming JSON patches on top of the stored blob server-side so callers can send incremental patches. `enabled` derives from `status === "connected"` server-side. |
| `/settings/customization?tab=picklists` (`components/settings/customization-view.tsx`) | `picklists.list` | `convexPicklistsToMock` | Reads only. Writes (add value / update label / archive / restore / move) stay on the mock store — each operation mutates a single picklist's `values[]` while Convex's `picklists.updateValues` replaces the whole array. The mock's `value`+`archived` field names map to Convex's `code`+`active`, so a focused Phase 4 pass is warranted to wrap each mock fn with its Convex-aware variant. |
| `/reports` (`components/reports/reports-view.tsx`) | `ledger.list`, `contracts.list`, `pos.listOrders` | `convexLedgerToMock`, `convexContractsToMock`, `convexPosOrdersToMock` | Reads only by design (the page itself never writes). Three highest-leverage data streams flipped: invoices/payments (Annual portfolio + Revenue trend + Top boaters + Daily ops KPIs), contracts (Renewal rate + ARR + Expiring + Lapsed), POS orders (Revenue by category). Deferred to a follow-up: occupancy-by-dock (still reads `RENTAL_GROUPS` + `RENTAL_SPACES` mock-static seeds), Rental Club analytics (subscriptions + bookings haven't migrated). Convex's wider `method` union and narrower `posOrders.status` union are coerced at the adapter boundary. |
| `/staff` Roles & access (`components/staff/roles-matrix.tsx → RolesAndPermissions`) | `roles.list` | `convexRolesToMock` | Reads + writes both flipped. `convex/roles.ts` already had `create` / `update` / `archive` from the Phase 1 scaffold. The matrix's "+ New role" hits `roles.create`; the per-cell permission toggle hits `roles.update` with the full new `permissions[]`. The `Role.permissions` mock enum is cast back at the adapter — Convex stores `permissions: v.array(v.string())`. |

---

## Notes from in-flight migrations

These are addenda the recipe author wants future migrators to see —
gotchas, deviations, conventions that the bare recipe above doesn't
fully spell out.

### `convexArgs` stable identity — two patterns are fine

The recipe shows `React.useMemo(() => ({}), [])` for the no-args case.
A module-level `const EMPTY_ARGS = {} as const` is equally stable and
slightly more readable — and the `docks` / `commTemplates` /
`audit-log` migrations use it. Both options keep referential identity
across renders, which is what Convex's `useQuery` dedupe wants. Pick
whichever reads better at the call site; reach for `useMemo` once you
actually have dependencies (`{ activeOnly }`, `{ status }`, etc.).

### Page lives inside a tabbed container (the `/settings/docks` case)

A "page" in the order list isn't always the file at
`app/<path>/page.tsx`. `/settings/docks` is a `redirect()` to
`/settings/customization?tab=docks`, and the actual data surface is
`components/settings/docks-view.tsx` rendered as one tab of
`customization-view.tsx`. Migrate the **view** component, not the
redirect — and verify with `grep` (`grep -rn "DocksView"`) that
nothing else renders the same view.

### When the Convex schema and the mock enum disagree

`convex/schema.ts` sometimes stores fields the mock types treat as a
string-literal enum as a free `v.string()` (e.g. `commTemplates.kind`).
That's a deliberate Convex pattern — the resolver doesn't care, and the
seed action is the only writer. The page-side adapter just casts back
to the mock enum type. Don't widen the mock type; cast at the adapter
boundary so the rest of the component stays strongly typed.

### Singletons read the same way as lists

The `marina.getCurrent` / `audit.list` shape is no different from any
multi-row read — the hook is generic over the mock's shape. For a
singleton, declare `useTenantQuery<MarinaProfile, ConvexMarinaProfile>`
and the adapter returns one object. No special-casing needed.

### `lib/use-tenant-query.ts` did not need to change

Three migrations in (`pos-locations` + `docks` + `commTemplates` +
`audit-log`) and the seam has held every shape it's been asked. No
extensions were needed for this batch. If a future page needs paging
cursors, fall-through to a loading sentinel, or anything that escapes
"return mock or return Convex," extend the hook then — not before.

---

## Phase 4 — Mutations

Phase 3 was read-only. Phase 4 flips the *writes* on each migrated
page from the mock-store mutations (`upsertPosLocation`, `deleteDock`,
`updateCommTemplate`, etc.) to the matching Convex mutations. Mock
mode (`NEXT_PUBLIC_CONVEX_URL` unset) continues to work — identical
behavior.

### The write-side seam: `lib/use-tenant-mutation.ts`

Mirrors `useTenantQuery`. Returns a function the caller invokes to
fire the mutation; the hook itself decides whether the underlying
implementation is `useMutation(convexRef)` or the mock store.

```ts
import { anyApi } from "convex/server";
import { useTenantMutation } from "@/lib/use-tenant-mutation";

const createLocation = useTenantMutation<PosLocation, void>({
  mock: (loc) => upsertPosLocation(loc),
  convexRef: anyApi.pos.createLocation,
  convexArgsAdapter: (loc) => ({
    key: loc.key,
    name: loc.name,
    default_tax_rate: loc.default_tax_rate,
    allows_charge_to_account: loc.allows_charge_to_account,
    active: loc.active,
    sort_order: loc.sort_order,
  }),
});

await createLocation(values);   // identical callsite either mode
```

Same conventions as `useTenantQuery`:

- The mock fn is always passed (called unconditionally → stable hook
  order across the lifetime of the component).
- `convexRef` is optional — omit while staging a page before the
  resolver lands.
- `anyApi.x.y` is the today shape; swap to typed
  `api.x.y` from `convex/_generated/api` once `npx convex dev` lands.

### Recipe steps for a Phase 4 page

1. **Audit the page's write surface.** Every "+ New", "Save",
   "Delete", inline-edit, and toggle is a callsite. List them.
2. **Audit `convex/<entity>.ts`** for matching mutations. The Phase 3
   seed scaffolded `create` / `update` / `archive` for most entities.
   Anything that hard-deletes from the mock store needs a `remove` /
   `deleteX` Convex mutation to match — `archive` and `delete` are
   different semantics, so add the missing one instead of overloading.
   **Every Convex mutation MUST gate on `requireTenant` + write
   `logAudit`** — no exceptions, including new ones added here.
3. **For each callsite, declare a `useTenantMutation`** at the top of
   the component (or the relevant child). Pick the right Convex
   mutation, write the args adapter that translates the caller's
   payload to the resolver's arg shape (commonly `{ id, patch }` for
   updates, identity for creates).
4. **Replace the direct mock-store call** at the callsite with
   `void hook(args)`. Fire-and-forget — the read hook
   (`useTenantQuery`) picks up the update on its next sync (mock
   store notifies synchronously; Convex pushes via subscription, so
   the UI updates within the same tick).
5. **Typecheck**: `./node_modules/.bin/tsc --noEmit` — must be exit 0.
   `npx tsc` is shadowed by a stub in this repo — use the local
   binary.
6. **Verify mock path unchanged** by running `npm run dev` with
   `NEXT_PUBLIC_CONVEX_URL` unset (the default during prototype).
   Every Add / Edit / Delete should behave identically to before.

### Per-page write-surface checklist

For each page in the Phase 4 order list, the audit collapses to a
small table. Use this as the source of truth when wiring:

| Page | Mock mutation(s) | Convex mutation(s) used |
|---|---|---|
| `pos-locations` | `upsertPosLocation` (create), `upsertPosLocation` (edit), `deletePosLocation` | `pos.createLocation`, `pos.updateLocation`, `pos.removeLocation` |
| `docks` | `upsertDock` (create), `updateDock` (edit), `deleteDock` | `docks.create`, `docks.update`, `docks.remove` |
| `comm-templates` | `updateCommTemplate` | `commTemplates.update` |
| `audit-log` | *(read-only)* | *(read-only — entries are written by other mutations)* |

### Splitting `upsert` into create + update

The mock store's `upsertPosLocation` / `upsertDock` does both create
and update via an id-presence check. Convex separates them
(`createLocation` vs `updateLocation`). At the callsite, branch on
the editor's `editing` state (or `values.id` presence) and route to
the right hook. The mock fn for both hooks can stay `upsertX` —
that's fine, the routing happens at the wrapper level.

### Hard delete vs archive

Most mock stores hard-delete (drop the row from the array). Convex
gives you `archive` (flip `active=false`) and now matching `remove` /
`removeLocation` mutations for hard delete. **Match the mock's
semantics**: if the page's trash icon really removes the row,
`remove`; if it just deactivates, `archive`. We added
`pos.removeLocation` and `docks.remove` in Phase 4 to make this 1:1.

### Mutation gotchas

- **Don't `await` in event handlers** unless you also disable the
  button. Fire-and-forget (`void hook(...)`) keeps the UX snappy and
  the read hook handles refresh.
- **`useMutation` outside a `ConvexProvider` throws.** The hook
  guards this by short-circuiting to the mock branch when
  `useConvexEnabled()` is false. Don't move the `useMutation` call
  out of the `useConvexBranch` inner function.
- **Child components that own their own dialog state** (e.g.
  `TemplateEditor` in `comm-templates-view.tsx`) declare their own
  `useTenantMutation` — the hook is per-component, not lifted into
  the parent. Keeps the editor self-contained.
- **The audit-log page is read-only by design.** Phase 4 doesn't add
  any mutations there — the entries are written *by* every other
  Phase 4 mutation via `logAudit()`. Once Phase 4 ships across all
  three pages with-writes, the audit-log view starts populating with
  real entries the moment a real Clerk org is provisioned.

### What's still TODO after a Phase 4 flip

- **Phase 5** — agent action executor (`lib/agent-actions.ts`) calls
  the same Convex mutations directly with tenant context derived
  from Clerk. The mutations themselves don't need to change.
- **Phase 6** — Surface the live `auditLog` table reads in
  `/settings/audit-log` once Convex is online (already done at the
  read-hook level — entries just need to start flowing, which Phase
  4 enables).
- **Phase 7** — retire the mock mutations from `lib/client-store.ts`.

---

## Phase 4 progress

| Page | Mock writes retired (at the callsite) | Convex mutations wired | Status |
|---|---|---|---|
| `/settings/pos-locations` (`components/settings/locations-view.tsx`) | `upsertPosLocation` (create + edit), `deletePosLocation` | `pos.createLocation`, `pos.updateLocation`, `pos.removeLocation` | ✅ wired through `useTenantMutation` — mock path preserved (mock fn still `upsertPosLocation` / `deletePosLocation`) |
| `/settings/customization?tab=docks` (`components/settings/docks-view.tsx`) | `upsertDock` (create), `updateDock` (edit), `deleteDock` | `docks.create`, `docks.update`, `docks.remove` | ✅ wired through `useTenantMutation` — Convex `docks.remove` added in this phase to match mock's hard-delete semantics |
| `/settings/comm-templates` (`components/settings/comm-templates-view.tsx`) | `updateCommTemplate` (in `TemplateEditor` child) | `commTemplates.update` | ✅ wired through `useTenantMutation` — single mutation per editor, savedFlash UX preserved (fire-and-forget keeps the 1500ms confirmation feeling instant) |
| `/settings/audit-log` (`components/settings/audit-log-view.tsx`) | *(read-only)* | *(read-only — entries land from other mutations' `logAudit` calls)* | ➖ no-op — by design |
| `/staff` Roster (`app/staff/staff-client.tsx → RosterView` + `StaffEditSheet`) | `upsertStaffMember` (create + edit) | `staff.create`, `staff.update` | ✅ reads + writes flipped in the same step. Mock fn still `upsertStaffMember` for both branches; Convex split into `create` vs `update` at the callsite (branch on `staff` prop). `staff.remove` is scaffolded for future use — the current sheet has no delete affordance. |
| `/settings/marina-profile` (`components/settings/marina-profile-view.tsx`) | `updateMarinaProfile` (every auto-save field commit) | `marina.updateCurrent` | ✅ reads + writes flipped via context. The `SavePatchContext` carries the tenant-aware mutation down to every field; `useAutoSave` calls it (instead of `updateMarinaProfile` directly) AND fires `NotifySavedContext.notifySaved()` only on a real commit. The Saved-flash UX is now decoupled from `[profile]` reference changes — see the in-flight note below. |
| `/insurance` (`components/insurance/insurance-view.tsx`) | `upsertInsuranceCertificate` (create + edit), `deleteInsuranceCertificate` | `insurance.create`, `insurance.update`, `insurance.remove` | ✅ reads + writes flipped. Field-level gap: mock has `vessel_id` / `hull_value` / `pdf_url` / `uploaded_at` / `uploaded_by`, Convex schema doesn't (the Insurance COI agent owns extending it in `convex/insuranceCoi.ts`). The adapter surfaces those as empty defaults so the page still renders. |
| `/vendors` Vendor list (`app/vendors/vendors-client.tsx → NewVendorSheet`) | `upsertVendor` (create + edit), `deleteVendor` | `vendors.create`, `vendors.update`, `vendors.remove` | ✅ reads + writes flipped. New `convex/vendors.ts` + `vendors` table added in schema. Bills sub-section (`BillsView`, `BillEditSheet`) still calls `upsertBill` / `deleteBill` — Bill entity hasn't migrated yet. |
| `/settings/connections` (`components/settings/connections-view.tsx → CredentialEditor`) | `updateProviderConfig` (every inline save + disconnect) | `providers.update` | ✅ wired through `useTenantMutation`. Convex schema is intentionally narrow — page-side fields are packed into the existing `public_config` JSON blob. Caller sends incremental patches; server merges on top of the stored blob. `enabled` derives from `status === "connected"` server-side. |
| `/settings/customization?tab=picklists` (`components/settings/customization-view.tsx`) | `addPicklistValue`, `updatePicklistValue`, `archivePicklistValue`, `restorePicklistValue`, `movePicklistValue` | *(read-only this wave)* | ➖ Phase 3 only — writes deferred. The per-mutation surface fans across 5 mock fns that each mutate one value inside a picklist, while Convex's `picklists.updateValues` replaces the entire `values[]` array. Wrapping these requires per-call merging at the call site (re-derive the next array, send it whole). Field-name divergence (`value`/`archived` ↔ `code`/`active`) adds adapter work. Slated for its own focused pass once the broader picklist-as-source-of-truth pattern is finalized. |
| `/reports` (`components/reports/reports-view.tsx`) | *(read-only)* | *(read-only — page never writes)* | ➖ no-op — by design. Reads flipped via `useTenantQuery` against `ledger.list`, `contracts.list`, `pos.listOrders`. |
| `/staff` Roles & access (`components/staff/roles-matrix.tsx → RolesAndPermissions` + `RolePermissionMatrix`) | `upsertRole` (new role), `updateRole` (toggle permission) | `roles.create`, `roles.update` | ✅ reads + writes both flipped. `roles.create` takes the args the matrix builds (`{ name, description, permissions }`); `roles.update` takes `{ id, patch }` and the matrix sends a permissions-array patch per toggle. `roles.archive` is scaffolded — current UI has no delete affordance. |

New Convex mutations added in Phase 4:
- `convex/pos.ts → removeLocation` — hard delete (matches mock's
  `deletePosLocation`). `archiveLocation` already existed for soft
  delete.
- `convex/docks.ts → remove` — hard delete with slip-reference guard
  (matches mock's `deleteDock`). `archive` already existed.
- `convex/staff.ts → create` + `remove` — outright staff insert (no
  Clerk invite token; for the Roster sheet's "New staff" path) and
  hard-delete to match `deleteStaffMember`. `update` now accepts the
  full extended field set (wage profile + clock identity).
- `convex/insurance.ts → create` + `update` + `remove` — basic CRUD
  for the Insurance page. Expiry detection / reminders / PDF ingest
  remain in the Insurance COI agent's separate file.
- `convex/vendors.ts` (new file) → `list` + `get` + `create` +
  `update` + `archive` + `remove`. Mirrors the `convex/docks.ts`
  shape (the `pos` pattern that exposes both soft + hard delete).

Schema extensions in this batch:
- `staffMembers` gains `default_position`, `employment_type`,
  `hourly_rate`, `salary_annual`, `mobile_clock_pin`,
  `pto_hours_balance` (all `v.optional`).
- New `vendors` table — full field set from `lib/types.ts → Vendor`,
  indexed on `by_tenant` + `by_tenant_active`.

All eight pages were already on the Phase 3 read seam
(`useTenantQuery`) before — except the four added in this batch,
which got reads + writes in the same step. Mock mode remains the
default until `NEXT_PUBLIC_CONVEX_URL` is set.

---

## Notes from in-flight migrations (Phase 4 batch 2)

### Marina-profile "Saved" flash — context-coordinated instead of `useEffect([profile])`

The original `MarinaProfileView` flashed "Saved · Just now" inside a
`useEffect` keyed on `[profile]` — whenever the canonical profile
reference changed, the bottom-right pill flashed green. That worked
in mock mode because the only thing that ever changed the reference
was an operator commit (`updateMarinaProfile()` notifies the store →
new ref).

When Convex comes online for the first time, the page does this:

1. Mount with `mock` value from the local store (a seed marina).
2. `useTenantQuery` fires `useQuery(api.marina.getCurrent)`.
3. First Convex sync lands — `live` becomes non-`undefined`.
4. The hook returns the Convex value (different reference).
5. The `useEffect([profile])` fires → flashes "Saved · Just now".

The operator sees a save confirmation for a save that never happened.

**Fix**: introduce a pair of contexts — `NotifySavedContext` (the
beacon the save bar listens on) and `SavePatchContext` (the
Convex-or-mock routed mutation that every field actually fires).
Every `useAutoSave` field calls `savePatch(patch)` AND then
`notifySaved()` — only on a real commit. The save bar's `[profile]`
useEffect is gone. Result: the flash stays in lockstep with
operator-initiated commits; the first Convex sync (or any other
external reference change, e.g. an agent edit) doesn't trigger it.

Other approaches considered:
- "Skip the flash when `useDataSource() === 'convex'` AND it's the
  first sync" — brittle (would also skip on agent-initiated edits
  that the operator legitimately should see confirmation of).
- "Track `lastSavedRef.current` only after the first commit fires" —
  works but leaks the gating logic into the parent's `useEffect` and
  still couples the flash to reference changes.
- Context pair is cleaner — every field's commit is the source of
  truth, the save bar is a passive consumer, and the parent doesn't
  have to know which fields exist.

### `useTenantQuery` for a singleton

`marina.getCurrent` returns one row, not a list. The hook is generic
over the mock's shape — declare `useTenantQuery<MarinaProfile,
ConvexMarinaProfile | null>` and the adapter folds the Convex
`null`-while-unprovisioned case into a sentinel default that still
renders the form. No special-casing in the seam.

### Insurance / vendor schema asymmetry

The mock `InsuranceCertificate` carries `vessel_id` + `hull_value` +
PDF metadata that the Convex schema doesn't yet (the Insurance COI
agent owns the schema extension). For Phase 4 reads on the Convex
path, the adapter surfaces those as empty defaults — the page
gracefully renders `—` for unknown vessels via the existing
`vessels.find()` fallback. Writes only pass the Convex-supported
fields through. Hull value / vessel link continue to round-trip
through the mock store.

The `vendors` table is new (didn't exist before this batch). Bills
stay on the mock store because the `Bill` entity hasn't migrated yet
— flipping the Bills view independently keeps the blast radius
small.

### Staff sub-sections — Schedule / Timecards / Certs stay on the mock

Only `RosterView` (the staff list) is migrated. The other sub-sections
read different entities (`shifts`, `timeEntries`, `certifications`)
that aren't in this batch's scope. They continue calling
`useStaff()` directly — when Convex is on, the Roster shows live
staff while Schedule renders from the mock seed. That's accepted:
mock mode is the default in this prototype, and once `shifts` /
`timeEntries` / `certifications` migrate, those views flip in the
same shape as Roster did here.

---

## Notes from in-flight migrations (Phase 4 batch 3 / Wave 3)

### Pack page-side fields into a JSON blob when the schema can't grow

The Wave 3 directive said "ONLY add NEW tables for pages you migrate.
Don't touch existing tables." But `/settings/connections` needs to
round-trip a richer surface (`display_name`, `status`, full config
map, `connected_at`, `last_error`) than `convex/providerConfigs`
exposes. Solution: pack the full page-side state into the existing
`public_config` JSON blob, with a server-side merge so the caller
can send incremental patches.

```ts
// convex/providers.ts → update
//   accepts: { id, public_config_patch: string, has_secret? }
//   merges incoming JSON on top of the stored blob, then patches
//   `enabled` from `incoming.status === "connected"`.
```

This is a useful pattern for any future page where the Convex schema
is narrower than the mock surface and extending the table isn't
allowed. Trade-off: you lose Convex query-indexability on the packed
fields. For singletons / small-cardinality config rows that's fine —
the page reads the whole row anyway.

### Read-only pages (like `/reports`) flip cleanly with `useTenantQuery` alone

No mutation seam is needed. The recipe's existing read pattern is
sufficient. Just pick the heaviest data streams and adapt — partial
migrations are accepted; mock-only data streams (e.g. Rental Club
subscriptions, static `RENTAL_SPACES` seeds) continue to read from
their existing sources until the corresponding tables migrate.

### Coerce wider Convex unions at the adapter boundary

Several migrated entities have a wider Convex union than the mock —
`ledgerEntries.method` includes `charge_to_account` (mock doesn't);
`posOrders.status` is `v.string()` rather than the mock's narrow
enum. The adapter maps these to the mock-shaped value (or a sensible
default) so downstream consumers stay strongly-typed. Don't widen
the mock type — cast at the boundary.

### When the write surface fans across N small mock fns, defer Phase 4

The `/settings/customization` picklists tab has 5 mock-store
mutations (`addPicklistValue`, `updatePicklistValue`,
`archivePicklistValue`, `restorePicklistValue`, `movePicklistValue`),
each mutating one value inside one picklist. Convex exposes a single
`picklists.updateValues(id, values[])` that replaces the whole array.
Wrapping the 5 mock fns with their Convex-aware variants requires
per-call merging at the call site (re-derive the new array, send it
whole) AND field-name translation (`value`/`archived` ↔ `code`/`active`).

That's enough nuance to warrant a dedicated Phase 4 pass rather than
shoehorning it into a multi-page wave. Phase 3 reads were flipped in
this wave; Phase 4 writes deferred.

### `/reports` — what stays on the mock

Three Convex-backed data streams flipped: `ledger.list` (invoices +
payments), `contracts.list`, `pos.listOrders`. Still on the mock and
deferred:
- **Occupancy by dock** — reads `RENTAL_GROUPS` + `RENTAL_SPACES`
  module-level constants from `lib/mock-data.ts`. The Convex schema
  has both `rentalGroups` and `rentalSpaces` tables but no query
  modules yet. Flipping this requires a `rentalGroups.list` +
  `rentalSpaces.list` resolver pair and a rewrite of the
  `totalOccupancy()` helper to take a slice argument.
- **Rental Club analytics** — `clubSubscriptions` and `clubBookings`
  aren't in the Convex schema at all. The whole `RentalClubAnalytics`
  panel stays mock-only until that domain migrates.

Operationally these are fine — `/reports` is operator-facing and the
deferred panels degrade gracefully (occupancy shows the seed values;
Rental Club hides itself when there are no subs). When the prototype
runs against a real Convex deployment, the flipped panels show live
data while the deferred ones continue rendering mock seeds.

