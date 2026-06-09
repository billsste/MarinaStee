# Marina Stee — Reference


## 1. Executive Summary

### Product Vision

- Multi-tenant marina-management SaaS built for the era where the operator talks to the software, not the other way around
- Agent surface is the **primary UI** — every list page has a search/create bar wired to a Claude-backed agent, every detail page carries an "Ask" rail
- Every point-and-click action has a matching agent tool — a dockmaster runs the marina by typing intent ("charge a hoist fee to David Emmons") instead of hunting through menus
- Point-and-click remains as a complete fallback, but the fastest path through any workflow is the agent
- Boater-facing side mirrors the same philosophy: self-service portal at `/portal`, public application intake at `/apply`, magic-link signing at `/sign/[token]`, and tokenized waitlist offers at `/apply/waitlist/[token]` — slip-holders and prospective boaters never need an account just to apply, approve, or pay
- PWA install target at `/dock` puts a dockhand-first surface on the literal dock — phone in hand, check-ins, meter logs, fuel sales
- Installable from Safari today, ready for a Capacitor-wrapped native iOS shell next

**Thesis:** incumbents (Dockwa, Molo, Marina Office) have mapped the **problem space** — slips, boaters, contracts, fuel, work orders — but their solutions are point-and-click CRMs from 2014 with payment processing bolted on. Marina Stee maps the **same problem space** with deeper cross-entity connections and an LLM agent that actually executes the work, not just describes it.

### Target Users

**Operator side** — marina staff, role-scoped:
- **Manager / Owner** — bulk billing runs, renewal sweeps, comms broadcasts, QuickBooks sync, A/R aging, applications triage
- **Dockmaster** — slip assignments, arrivals/departures, work-order kanban, contract lifecycle, waitlist fan-out
- **Dockhand** — `/dock` PWA: check-in/out, meter readings, quick fuel sale, photo capture
- **Accounting** — ledger, POS orders, QuickBooks sync queue, COI/insurance compliance, vendor bill PDF intake

**Boater side** — slip-holders, transient guests, rental customers, club members, prospective applicants:
- `/apply` — public self-onboarding wizard for prospective boaters; lands in operator queue
- `/apply/[token]` — applicant status check + welcome surface
- `/apply/waitlist/[token]` — fired-offer landing for waitlisted boaters
- `/portal` — self-service: balance, vessels, contracts, comms history, payment methods
- `/sign/[token]` — public tokenized signing surface for quotes, contracts, COI uploads
- SMS / email receipts and reminders, sent automatically by the closeout chain

### Differentiation vs Dockwa, Molo, Marina Office, Marinaware

| Capability | Incumbents | Marina Stee |
|---|---|---|
| **Agent-native UX** | None — all UIs are forms + tables | Every UI create action has a matching agent tool in `ACTION_TOOLS`. Type intent → agent drafts → approve → all side effects fire atomically |
| **Cross-entity inline** | Click chains: WO → boater (new page) → vessel (new page) → slip (new page) | A Work Order shows boater + vessel + slip + ledger entries + comms on **one page**, all editable inline |
| **PII safety with LLMs** | N/A (no LLM) | PII tokenization layer between `/api/agent` and Anthropic for TEXT inputs. PDF/image inputs (`/api/pdf-extract`) carry raw content; holder-consent disclosure required on upload paths |
| **Self-onboarding pipeline** | Phone + paper application + Excel waitlist | Public `/apply` wizard → operator queue → approve/decline/route-to-waitlist; fired waitlist offers expire on a 48h token clock |
| **Recurring fleet cleaning** | Manual calendar scheduling per boat | Cron-based recurring chain — define a program once (weekly/biweekly/monthly with Feb-28 clamp), fleet schedules itself |
| **Work-order closeout chain** | Manual: done → invoice → email → QuickBooks | Completing a WO auto-fires Quote → Invoice → Ledger entry → Comm → Vessel service stamp, all linked, all audited |
| **Bulk operations** | One-at-a-time, or CSV export → external tool | 4-step wizards for billing run, renewal sweep, comm broadcast — preview, scope, confirm, execute — with full audit trail |
| **Multi-tenancy** | Per-marina installs or weak partitioning | Clerk Organizations = Marinas from day 1. Every Convex table carries `tenantId`. `requireTenant(ctx)` gate on every query/mutation. Per-tenant webhook URLs + provider config |
| **Boater portal** | Often an afterthought or read-only | Full self-service: contracts, payments, comms history, vessel docs, COI upload — magic-link auth, no password |
| **Visual dock map** | Spreadsheets and tabular slip lists | First-class visual dock map with rental groups + spaces; drag-assign boaters to slips |
| **Insurance / COI workflow** | Manual file folder + email reminders | Tokenized COI upload link, Claude vision PDF extraction, expiry tracking, auto-reminders before lapse |
| **Webhook-driven comm health** | None — fire-and-forget email | Postmark + Twilio webhooks stamp `opened_at`, `clicked_at`, `bounced_at`, `bounce_reason` per row; per-tenant URLs close the forged-event vector |

### Tech Stack At a Glance

- **Frontend**: Next.js 16 (App Router, Turbopack), React 19, Tailwind v4 (CSS-based `@theme`), TypeScript 5 strict, Radix UI primitives, `lucide-react`
- **Backend**: Convex (TS-native reactive functions, `_storage` for files) + Clerk (auth + Organizations = Marinas) + Anthropic Claude (PII-tokenized for text, vision for PDFs) + Postmark (email + webhook receivers) + Twilio (SMS + status callbacks)
- **PWA**: `app/manifest.ts` + `app/icon.tsx` + `public/sw.js`. Install target `/dock`. Capacitor-wrapped iOS native is the next milestone — web-standard APIs only

### Status

Feature-complete prototype: ~14 pages flipped to live Convex queries with real notification dispatch, bulk-ops wizards, recurring cleaning chains, work-order closeout automation, insurance/COI workflows, public application intake, waitlist offer fan-out, per-tenant webhook delivery telemetry, and PDF vision extraction — ready to run `docs/convex-setup.md` and onboard the first real marina.


## 2. Modules

### `/apply` — Public boater self-onboarding (H4)

- **Purpose**: Prospective boater enters a 4-step wizard (applicant → vessel → preferences → review) and lands in the operator queue as `pending`. No Clerk session required — submit is a public mutation with per-field caps, CRLF rejection, email format check, and a per-tenant per-email rate limit
- **Surfaces**:
  - `/apply` — marketing-hero landing + `ApplyWizard`
  - `/apply/[token]` — applicant status check (renders applicant-safe projection only — `internal_review_notes` + `reviewed_by` + `tenantId` redacted)
  - `/apply/success` — post-submit confirmation with the applicant token
  - `/apply/waitlist/[token]` — fired-offer landing for waitlisted boaters (Accept / Decline)
- **Primary entities**: writes `Application`, reads `Marina` (validates tenantId), reads `WaitlistEntry` (offer landing)
- **Operator workflows**: surfaces in `/members?tab=applications` — Approve mints Boater + Vessel; Decline stamps notes; Route to Waitlist mints a `WaitlistEntry` row
- **Boater workflows**: submit application; check status via emailed token link; accept/decline a fired waitlist offer
- **Agent surface**: `submit_application`, `approve_application`, `decline_application`, `route_application_to_waitlist`

### `/members` — Boaters + Rental Club + Applications

- **Purpose**: Directory of everyone connected to the marina — slip holders (annual/seasonal/monthly/transient), Rental Club subscription members, and pending boater applications. Single source of truth for identity, contacts, vessels, billing cadence, and intake pipeline
- **Surfaces**:
  - `/members` (Slip Holders default) — `BoaterList` directory with filters, status chips, balances
  - `/members?tab=club` — `RentalClubView` (plan roster + subscription health)
  - `/members?tab=applications` — `ApplicationsSection` (queue of `pending` / `under_review` / `approved` / `declined` / `waitlisted` applications with Approve / Decline / Route-to-Waitlist actions)
  - `/members/[id]` — 5-tab boater detail (Overview, Vessels, Contracts, Ledger, Comms) with connection rail
  - `/members/bulk-renewals` — multi-select annual renewal launcher
- **Primary entities**: reads/writes `Boater`, `Vessel`, `Contact`, `Address`, `CardOnFile`, `ClubSubscription`, `WaitlistEntry`, `Application`, `StaffNote`; reads `Contract`, `LedgerEntry`, `InsuranceCertificate`
- **Operator workflows**:
  - Triage Applications tab → approve → boater + vessel auto-minted with `from-apply` tag
  - New boater intake → create boater → add vessel → assign slip → kick contract draft
  - Past-due triage → filter by balance > 0 → open boater → send comm or charge card on file
  - Bulk annual renewal → `/members/bulk-renewals` → pick segment → generate + send contracts in one pass
  - Club plan change → open subscription → bump tier (basic → plus → premium) → prorate
  - Lapsed-member reactivation → run club reactivation campaign from Rental Club view
- **Agent surface**: `create_boater`, `update_boater`, `update_contact`, `create_vessel`, `update_vessel`, `create_club_subscription`, `update_club_subscription`, `run_club_reactivation`, `send_comms`, `submit_application`, `approve_application`, `decline_application`, `route_application_to_waitlist`

### `/bookings` — Slip Reservations + Fleet Bookings + Pending Requests + Calendar

- **Purpose**: One unified booking queue across slip reservations, paid boat rentals (transient), and Rental Club member-day bookings. Operator's daily ops kanban
- **Surfaces**:
  - `/bookings?tab=bookings` — `UnifiedKanban` (14-day strip + per-day arrivals/departures/on-site), Kanban / List / Waitlist sub-tabs
  - `/bookings?tab=pending` — master-detail pending request triage (slip/rental/club) with type-aware Confirm/Decline
  - `/bookings?tab=calendar` — monthly Club booking calendar (forward planning)
  - `NewBookingWizard` modal (type picker → slip / rental / club)
  - `/reservations/[id]`, `/boat-rentals/[id]`, `/boat-rentals/book` (public flow)
- **Primary entities**: reads/writes `Reservation`, `BoatRental`, `ClubBooking`; reads `Slip`, `RentalBoat`, `Boater`, `WaitlistEntry`; cross-refs `WorkOrder` (cleaning)
- **Operator workflows**:
  - Walk-in transient slip → wizard → pick slip → arrival/departure → confirm → reservation flips occupied
  - Approve pending club request → pending tab → detail panel → Confirm → flows into kanban + calendar
  - Walk-in boat rental → wizard → pick boat + duration → take deposit hold → send pickup link
  - Triage pending queue → filter by type → bulk-confirm short waits, decline past-due members
  - Day-of arrival ops → select date on strip → call arrivals panel → check in via dock PWA
- **Boater workflows**: book a rental from public link (`/boat-rentals/book`); confirm pickup via signed pickup link (`/pickup/[token]`)
- **Agent surface**: `create_reservation`, `update_reservation`, `cancel_reservation`, `create_boat_rental`, `close_boat_rental`, `create_club_booking`, `cancel_club_booking`, `send_pickup_link`

### `/services` — Roster + Contracts + Rates + Fees + Gas + Meters + Rental Club + Waitlist

- **Purpose**: Catalog of everything the marina sells — slips, rental fleet, rate cards, additional fees, fuel, metered utilities, contract templates, waitlist queue. Configures what shows up on `/ledger` and `/bookings`
- **Surfaces**: `/services` (overview KPIs + `DockMap`), `/services/roster` (with `WaitlistSection` — fire-offer modal + active-offer panel grouped by `offer_batch_id`), `/services/contracts` (Pipeline + All), `/services/contracts/[id]`, `/services/rates`, `/services/fees`, `/services/gas`, `/services/meters`, `/services/rental-club`, `/services/[id]` (slip detail), `/services/[id]/assign`
- **Primary entities**: reads/writes `Slip`, `Dock`, `RentalGroup`, `RentalSpace`, `RentalBoat`, `Rate`, `AdditionalFee`, `MeterReading`, `FuelInventory`, `FuelDelivery`, `FuelSale`, `Contract`, `ClubPlan`, `WaitlistEntry`
- **Operator workflows**:
  - New annual contract → contracts → pipeline → draft from template → send for e-sign → execute on countersign
  - Add a fee to the rate book → fees → "+ New" → pick recurrence + applies-to → live for next billing run
  - Log a fuel delivery → gas → "+ Delivery" → update on-hand → reconcile against tank reading
  - Take a meter read → meters → pick slip → enter reading → anomaly chip fires if delta > threshold
  - Assign a vacant slip → `/services/[id]/assign` → pick boater + dates → spawn reservation
  - Fire waitlist offers → roster → `WaitlistFireOfferModal` → pick top-N candidates → cohort gets 48h tokens stamped with shared `offer_batch_id`
- **Agent surface**: `create_slip`, `update_rate`, `create_fee`, `update_fee`, `create_contract`, `update_contract`, `create_contract_template`, `create_meter_reading`, `create_dock`, `update_dock`, `create_rental_boat`, `fire_waitlist_offer`, `accept_waitlist_offer`, `decline_waitlist_offer`

### `/work-orders` — Service jobs + Cleaning + Recurring

- **Purpose**: Every dock-side service job — winterization, haul-out, cleaning between rentals, repair, recurring PM. Drag-status kanban for techs
- **Surfaces**: `/work-orders` (`WoKanban`), `/work-orders/[id]` (detail with `CleaningSourcePanel`, advance button, recurring preview, wizard)
- **Primary entities**: reads/writes `WorkOrder`; reads `Boater`, `Vessel`, `Slip`, `RentalBoat`, `BoatRental`, `ClubBooking`, `Reservation` (cleaning sources)
- **Operator workflows**:
  - Open a service WO → wizard → pick vessel + service type → assign tech → drag through kanban
  - Recurring PM chain → schedule generates "+N days ahead" WOs against marina assets
  - Cleaning after a rental → auto-spawned from completed `BoatRental` / `Reservation` with back-reference chip
  - Reassign overdue WOs → filter overdue → bulk-assign to next-available tech
  - Close out → mark completed → bills line items into ledger if billable
- **Agent surface**: `create_work_order`, `update_work_order`, `create_wo_days_ahead`, `schedule_pump_out`, `create_pm_schedule`, `run_pm_check`

### `/ledger` + `/billing` — POS, A/R, Catalog, QuickBooks, Bulk billing

- **Purpose**: Unified financial surface. Every retail sale, slip fee, refund and bill flows through one ledger. POS for walk-ins; charge-to-account links walk-ups back to the boater
- **Surfaces**: `/ledger` (sub-rail: Billing runs / POS Terminal / Orders / A/R / Catalog / QuickBooks Sync), `/billing/bulk-run` (step wizard)
- **Primary entities**: reads/writes `LedgerEntry`, `PosOrder`, `PosCatalogItem`, `PosLocation`, `Invoice`, `Bill`, `BillPayment`; reads `Boater`, `CardOnFile`, `Vendor`
- **Operator workflows**:
  - Walk-in fuel sale → POS Terminal → ring up gallons → card or charge-to-account → ledger entry
  - Bulk billing run → `/billing/bulk-run` → pick period + rule → preview candidates → confirm → N invoices + 1 comm per boater
  - Charge a fee to a boater → POS → charge-to-account → flows to boater's ledger
  - A/R chase → A/R tab → past-due aging buckets → trigger reminder campaign
  - Reconcile to QuickBooks → QB Sync tab → review delta → push
- **Boater workflows**: pay invoice from `/portal` (settles ledger entry)
- **Agent surface**: `create_ledger_entry`, `charge_to_account`, `create_pos_item`, `update_pos_item`, `update_pos_location`, `run_billing_run`, `run_club_billing`, `run_qb_sync`

### `/inbox` — Communications

- **Purpose**: Every message in/out, every channel (SMS/email/voice), every boater — one triage queue. Now shows delivery telemetry (delivered / opened / clicked / bounced) stamped by webhook receivers
- **Surfaces**: `/inbox` (`InboxView`), `/comms/bulk-send` (broadcast composer)
- **Primary entities**: reads/writes `Communication`, `CommTemplate`; reads `Boater`
- **Operator workflows**:
  - Reply to a thread → open conversation → agent-suggested draft → send
  - Broadcast outage notice → `/comms/bulk-send` → pick segment + template → send
  - Reactivation campaign → filter lapsed members → bulk send
  - Identify unanswered → filter "no reply in 7d" → escalate
  - Prune bounced recipients → filter `status=bounced` → mark inactive on the boater row
- **Agent surface**: `send_comms`, `send_message`, `update_comm_template`

### `/insurance` — Certificates of Insurance

- **Purpose**: Track COIs per vessel/holder. Lapsed coverage is liability — chase renewals before expiry. PDF extract preview lets operators review Claude-vision output before commit
- **Surfaces**: `/insurance` (`InsuranceView` with `CoiExtractPreview` for uploaded PDFs), `/coi-upload/[token]` (tokenized boater upload), `/portal/[token]/coi-upload` (`HolderCoiUpload` with consent disclosure + PDF preview)
- **Primary entities**: reads/writes `InsuranceCertificate`; reads `Vessel`, `Boater`
- **Operator workflows**:
  - Renewal sweep → filter expiring-in-30 → bulk send upload link
  - Log new COI from PDF → upload → `/api/pdf-extract?kind=coi` → review `CoiExtractPreview` panel → confirm carrier + expiry
  - Flag vessels with no COI → filter → send first-time request
- **Boater workflows**: upload renewed COI from portal link; consent disclosure names Anthropic as the document processor before the file picker becomes active
- **Agent surface**: `create_insurance_certificate`, `update_insurance`, `send_comms` (renewal blast)

### `/reports` — Revenue, occupancy, customer mix

- **Purpose**: Read-only analytics over ledger + bookings + subscriptions. Same data that drives notifications + QB sync
- **Surfaces**: `/reports` (`ReportsView` — KPI tiles, revenue series, retention, lifetime-spend leaderboard)
- **Primary entities**: reads `LedgerEntry`, `Reservation`, `ClubSubscription`, `BoatRental`, `Boater`
- **Operator workflows**: MRR check / YoY comparison / plan-tier retention / top-spender export
- **Agent surface**: read-only queries (`open_balance`, occupancy queries, contract expiry queries)

### `/vendors` — Vendor master + bills + PDF intake (H3)

- **Purpose**: AP side of the ledger — vendors, bills received, payments out. New bills can be drafted by dropping a PDF on the new-bill wizard (Claude vision extracts line items)
- **Surfaces**: `/vendors` (`VendorsClient` — directory + bills tabs), `/vendors/[id]` (vendor detail), new-bill wizard with `NewBillFromPdfDropzone` (uploads → `/api/pdf-extract?kind=bill` → prefills lines + total)
- **Primary entities**: reads/writes `Vendor`, `Bill`, `BillLineItem`, `BillPayment`; idempotency key on `Bill` prevents duplicate inserts on PDF re-upload
- **Operator workflows**:
  - Add a new vendor + terms → directory → "+ New"
  - Enter a fuel-supplier bill from PDF → drop file → review extraction → split lines → mark paid
  - Cut a check / ACH run → bills → select unpaid → pay
- **Agent surface**: `create_vendor`, `create_bill`, `create_vendor_bill_from_pdf`, `extract_contract_terms`

### `/staff` — Roster, time, payroll, certifications, PTO

- **Purpose**: Marina staff management — schedules, time clock, payroll, certs (CPR / fuel-handler), PTO
- **Surfaces**: `/staff` (`StaffClient` — Roster / Schedule / Time / Payroll / Certs / PTO sub-nav), `/staff/[id]` (staff detail)
- **Primary entities**: reads/writes `StaffMember`, `Shift`, `TimeEntry`, `PayrollRun`, `Paystub`, `Certification`, `PtoRequest`, `Role`
- **Operator workflows**:
  - Onboard new tech → "+ Staff" → pick role → set wage → invite
  - Approve timecards → time tab → batch-approve → push to payroll
  - Run payroll → payroll → draft → approve → post
  - Renew expiring certs → certs filter → send renewal nudge
  - Approve/deny PTO request → PTO tab → action
- **Boater workflows**: none; staff clock in via `/dock` PIN entry
- **Agent surface**: `create_staff`, `update_staff`, `update_staff_wage`, `create_shift`, `approve_time_entry`, `run_payroll`, `create_role`, `update_role`, `create_certification`

### `/assets` — Marina assets + PM schedules

- **Purpose**: Hoists, pump-outs, golf carts, lifts, generators — equipment the marina owns. Tied to recurring work-orders
- **Surfaces**: `/assets` (`AssetsClient`), `/assets/[id]` (asset detail with PM schedule + history)
- **Primary entities**: reads/writes `MarinaAsset`, `PmSchedule`; reads `WorkOrder`
- **Operator workflows**:
  - Register a new asset → "+ Asset" → assign PM cadence
  - Schedule a PM cycle → asset detail → add PM schedule → auto-spawn WOs N days ahead
  - Retire an asset → flip status → archive
- **Agent surface**: `create_asset`, `create_pm_schedule`, `run_pm_check`

### `/inventory` — Ship-store + parts stock

- **Purpose**: Stock movements for ship-store retail + service parts. Feeds POS catalog
- **Surfaces**: `/inventory` (`InventoryClient` — stock list + movements)
- **Primary entities**: reads/writes `StockMovement`, `PosCatalogItem` (qty fields)
- **Operator workflows**:
  - Receive shipment → log inbound movement → qty bumps
  - Log shrinkage / loss → outbound movement → reason code
  - Reorder triggers → low-stock filter → generate vendor bill draft
- **Agent surface**: `log_stock_loss`

### `/settings/*` — Profile, Picklists, Connections, Docks, POS, Templates, Audit, Staff, Import, Notification Providers

- **Purpose**: Tenant configuration. Marina identity, dock layout, picklist values, integrations, comm templates, audit trail, per-tenant notification provider credentials
- **Surfaces**: `/settings/marina-profile` (now includes a **Notification Providers** card for per-tenant Postmark API key / message stream + Twilio SID / auth token / from-number — H2), `/settings/customization`, `/settings/docks`, `/settings/pos-locations`, `/settings/comm-templates`, `/settings/connections`, `/settings/staff`, `/settings/audit-log`, `/settings/import` (CSV)
- **Primary entities**: reads/writes `MarinaProfile`, `Picklist`, `PicklistValue`, `Dock`, `PosLocation`, `CommTemplate`, `Role`, `TenantAiSettings`, `AuditLogEntry`, `AppProviderConfig`
- **Operator workflows**:
  - First-time setup → marina profile → upload logo + hours + tax info
  - Build dock layout → docks → add docks + slip ranges → drives `DockMap`
  - Wire Postmark + Twilio per-tenant → marina profile → Notification Providers card → paste credentials → confirms per-marina routing
  - Wire QuickBooks/Stripe → connections → OAuth → enable sync
  - Edit comm template → templates → tweak copy → preview → save
  - CSV import → import → map columns → preview → commit
  - Audit a change → audit log → filter by actor/entity
- **Agent surface**: `update_marina_profile`, `update_comm_template`, `create_dock`, `update_dock`, `update_pos_location`

### `/dock` — PWA install target (on-the-dock surface)

- **Purpose**: Touch-first PWA for staff on the dock — arrivals/departures check-in, meter reads, fuel sales, rental returns, time clock. Installs from Safari; manifest shortcuts deep-link tiles
- **Surfaces**: `/dock` (tile home), Views: `arrivals`, `departures`, `meter`, `fuel`, `returns`, `clock`, `done`
- **Primary entities**: writes `MeterReading`, `FuelSale`, `LedgerEntry`, `PosOrder`, `Communication`, `TimeEntry`; updates `Reservation`, `BoatRental` (check-in/out, close)
- **Operator workflows**:
  - Check in arrival → arrivals tile → pick reservation → confirm slip → flips occupied
  - Sell fuel at the dock → fuel tile → pick pump + gallons → charge card / charge-to-account
  - Take meter reads on rounds → meter tile → pick slip → enter delta → anomaly flag
  - Return a rental → returns tile → close BoatRental → release deposit
  - Staff clock in → clock tile → PIN entry → time entry
- **Agent surface**: `check_in_reservation`, `close_boat_rental`, `create_meter_reading`, `create_ledger_entry`, `charge_to_account`, voice agent on dock

### `/portal` — Boater web holder portal

- **Purpose**: Magic-link, multi-tab self-service for slip holders + club members. Pay invoices, see reservations, upload COIs (with consent disclosure + PDF preview), file support tickets
- **Surfaces**: `/portal` (demo landing — member picker), `/portal/[token]` (`HolderShell` — Overview/Vessels/Reservations/Ledger/Comms tabs), `/portal/[token]/coi-upload` (`HolderCoiUpload` — consent disclosure + Claude-vision PDF preview before submit), `/portal/[token]/support`
- **Primary entities**: reads `Boater`, `Vessel`, `Reservation`, `ClubBooking`, `LedgerEntry`, `Communication`, `Contract`, `InsuranceCertificate`; writes `LedgerEntry` (payments), `InsuranceCertificate`, `SupportTicket`
- **Operator workflows**: send magic-link → boater self-serves → activity surfaces back in operator inbox
- **Boater workflows**:
  - Pay open invoice → ledger tab → tap pay → settles entry
  - View upcoming reservations / club days
  - Upload renewed COI → portal/coi-upload → read consent (names Anthropic as processor; lists extracted fields) → photo or PDF → submit
  - File / track support ticket → portal/support
  - Reply to a message thread
- **Agent surface**: scoped helper for "what do I owe?" / "when's my next booking?"

### `/support` — Marina Stee carve-out (boater tickets → Marina Stee backend, NOT Stee-Suite)

- **Purpose**: Operator-facing queue of boater support tickets, scoped per-tenant. Multi-tenant SaaS — tickets stay in Marina Stee's own Convex backend; one marina's queue invisible to another. Explicitly NOT proxied to `admin.stee-suite.com`
- **Surfaces**: `/support` (operator `SupportQueueTable`), `/portal/[token]/support` (boater `BoaterSupportView` — New ticket + My tickets tabs)
- **Primary entities**: reads/writes `SupportTicket`, `SupportTicketMessage`, `SupportTicketAttachment` (all `tenantId`-scoped)
- **Operator workflows**:
  - Triage incoming → queue → open ticket → reply / change status / mark resolved
  - Escalate urgent (priority=urgent) → reassign or status change
  - Close-out resolved → flip to closed (preserves history; never delete)
- **Boater workflows**: file new ticket (subject, description, type, priority, attachments); view My Tickets; reply in conversation; cancel (not delete) ticket
- **Agent surface**: minimal v1 — operator-side reply drafting via inbox-style agent prompt is the natural next step; no `create_support_ticket` tool yet

### `/api/webhooks/postmark/[tenantId]` and `/api/webhooks/twilio/[tenantId]` — Per-tenant webhook receivers (H2)

- **Purpose**: Inbound delivery telemetry from Postmark (Delivery / Bounce / Open / Click / SpamComplaint / SubscriptionChange) and Twilio (MessageStatus callbacks). Per-tenant URL pattern closes the cross-tenant forged-event vector
- **Surfaces**: route handlers only — no UI. Operator sees the effect on `/inbox` rows (delivered / opened / clicked / bounced badges) and on the audit log (`comm.webhook.*`)
- **Primary entities**: writes `Communication` (`opened_at`, `clicked_at`, `bounced_at`, `bounce_reason`, `last_webhook_event`, `last_webhook_at`), `AuditEntry`
- **Auth model**: provider signature check (Postmark token via `X-Postmark-Webhook-Token`; Twilio HMAC-SHA1 via `X-Twilio-Signature`) in `lib/webhook-verify.ts`. All paths return 200 on misconfigured/unverifiable input to avoid provider retry storms; a hard `console.error` fires when the secret is unset so production deploys notice
- **Legacy shared URLs**: `/api/webhooks/postmark` and `/api/webhooks/twilio` (no `[tenantId]`) still exist for the dev/demo single-tenant path; production marinas configure the per-tenant variant

### `/api/pdf-extract` — Claude vision wrapper (H3 / L3)

- **Purpose**: Accept a multipart PDF + `kind` (one of `coi` / `bill` / `contract`) and return a typed structured extraction. Backed by Anthropic's `document` content block (vision-equivalent for multi-page PDFs)
- **Auth model**: `MARINA_STEE_DEV_TOKEN` (Bearer) during prototype; Clerk org membership in Phase 5+
- **Rate limit (L3)**: per-tenant `pdf_extract.requests` bucket, 100/day default. Enforced via `convex/rateLimit.ts → checkAndIncrementForTenant`. Audit row written on every call so abuse is visible
- **PII boundary**: PDFs carry raw bytes — no tokenization. Holder-uploaded PDFs gate behind a consent disclosure (`components/portal/holder-coi-upload.tsx`); operator-uploaded PDFs (vendor bills, contracts) need no extra consent (operator already authorized Anthropic via the agent path)
- **Graceful degradation**: when `ANTHROPIC_API_KEY` is unset OR the call throws, returns `stub: true` sentinel — caller renders "fill manually" banner instead of breaking


## 3. Data Model

### Entity Catalog — Customer-side

| Entity | One-liner | Key fields |
|---|---|---|
| **Marina** (`marinas`) | Tenant root; one Clerk Org = one row. Per-tenant notification provider config lives here (H2) | `clerkOrgId`, `display_name`, `timezone`, `default_tax_rate`, `accounting_close`, address, `postmark_api_key`, `postmark_message_stream`, `twilio_account_sid`, `twilio_auth_token`, `twilio_from_number`, `twilio_from_email_label` |
| **Boater** | Marina's customer (slip holder, member, or one-off) | `tenantId`, `display_name`, `first/last_name`, `billing_cadence`, `primary_contact`, `address`, `cards_on_file`, `trust_score`, `tags` (incl. `from-apply`) |
| **Vessel** | A boat owned by a Boater (with co-owners) | `tenantId`, `boater_id`, `co_owner_ids`, `name`, `loa_inches`, `vessel_type`, `fuel_type`, `last_service_at`, `last_service_wo_id` |
| **Slip** | Physical dock slip — the SKU for annual lease | `tenantId`, `dock_id`, `number`, `slip_class`, `default_annual_rate`, `max_loa_inches`, `current_holder_boater_id`, `current_contract_id`, `occupancy_status` |
| **Dock** | Logical grouping of slips (Damsite A, PWC float) | `tenantId`, `name`, `short_name`, `prefix`, `sort_order` |
| **Contract** | Holder agreement binding Boater + Slip + Vessel | `tenantId`, `number`, `boater_id`, `template_id`, `slip_id`, `vessel_id`, `status`, `signature_token`, `onboarding_progress`, `attachments` |
| **Reservation** | Transient/seasonal slip booking | `tenantId`, `number`, `boater_id`, `vessel_id`, `slip_id`, `arrival/departure_date`, `type`, `status`, `attached_fee_ids` |
| **BoatRental** | Marina fleet rental (pontoon/jet ski/kayak) | `tenantId`, `boat_id`, `boater_id?`, `patron_*`, `start/end_at`, `rate_kind`, `deposit_hold`, `pickup_token`, `checkin` |
| **ClubSubscription** | Rental Club monthly membership (Rate-backed) | `tenantId`, `boater_id`, `plan_rate_id`, `status`, days/month allotment |
| **ClubBooking** | A member's day-of-fleet booking against allotment | `tenantId`, `subscription_id`, `boat_id`, `date`, `status` |
| **InsuranceCertificate** | COI on a Vessel — drives renewal/expiry alerts | `tenantId`, `boater_id`, `vessel_id`, `carrier`, `effective_start/end`, `upload_token`, `upload_token_expires_at`, `renewed_by_coi_id` |
| **WaitlistEntry** | Prospective boater waiting for a slip; fired-offer state machine (H1) | `tenantId`, `boater_id?`, `patron_name`, `patron_email`, `patron_phone`, `preferences`, `status`, `offered_slip_id`, `offered_at`, `offer_token`, `offer_expires_at`, `offer_status`, `offer_responded_at`, `offer_batch_id` |
| **Application** | Public boater self-onboarding row (H4) | `tenantId`, `number` (APP-####), `status`, `applicant_first/last_name`, `applicant_email`, `applicant_phone`, `applicant_address`, `vessel_*`, `preferred_slip_class`, `preferred_dock`, `desired_start_date`, `source`, `application_token`, `result_boater_id`, `result_waitlist_entry_id`, `reviewed_at`, `reviewed_by`, `internal_review_notes` |

### Entity Catalog — Operations

| Entity | One-liner | Key fields |
|---|---|---|
| **WorkOrder** | Service or cleaning job | `tenantId`, `number`, `boater_id`, `vessel_id?`, `slip_id?`, `subject`, `status`, `priority`, `work_class`, `activity_type`, `quote_id`, `closed_out_at`, `cleaning_source_kind/_id` |
| **Quote** | Itemized pricing inside a Work Order | `tenantId`, `number`, `work_order_id`, `line_items[]`, `subtotal`, `tax`, `total`, `status`, `signature_token`, `signed_at` |
| **LedgerEntry** | Invoice / payment / refund / credit / adjustment | `tenantId`, `boater_id`, `type`, `number`, `amount`, `open_balance`, `method`, `status`, `linked_work_order_id`, `linked_contract_id`, `linked_pos_order_id`, `qb_sync_status`, `qb_ref` |
| **VendorBill** | AP invoice (J3 — idempotency key prevents double-insert on PDF re-upload) | `tenantId`, `vendor_id`, `number` (BIL-####), `idempotency_key`, `line_items[]`, `total`, `status` |
| **BillingRun** | Annual / monthly invoice batch (drives many LedgerEntries) | `tenantId`, period, cadence, totals, status |
| **MeterReading** | Power/water utility read on a slip | `tenantId`, `space_id`, `meter_number`, `current_reading`, `prev_reading`, `unit`, `rate_per_unit`, `flagged_anomaly` |
| **FuelSale** | Single fuel-dock sale | `tenantId`, `fuel_type`, `gallons`, `total`, `payment_method`, `boater_id?`, `pos_order_id?` |
| **Communication** | Inbound/outbound message (email/sms/voice). H2 webhook telemetry stamps engagement | `tenantId`, `boater_id?`, `type`, `direction`, `status`, `delivered_at`, `error_at`, `error_reason`, `provider_message_id`, `opened_at`, `clicked_at`, `bounced_at`, `bounce_reason`, `last_webhook_event`, `last_webhook_at`, `related_entity` |
| **SupportTicket** | Per-tenant support thread (carve-out) | `tenantId`, `boater_id`, `reference`, `subject`, `description`, `type`, `priority`, `messages[]`, `attachments[]`, `status`, `context` |

### Entity Catalog — Configuration

| Entity | One-liner | Key fields |
|---|---|---|
| **Counter** (`counters`) | Per-tenant atomic sequence number (K1) | `tenantId`, `kind` ("APP", "WO", "INV", "Q", "K", "PMT", "BIL", "R"), `value` |
| **Rate** | Pricing row (incl. Rental Club monthly plans) | `tenantId`, `name`, `occupancy_type`, `cadence`, `amount`, `plan_tier?`, `days_per_month?` |
| **AdditionalFee** | Canonical fee SKU (refs from WO/contract/POS/rental) | `tenantId`, `name`, `amount`, `recurrence`, `applies_to[]`, `linked_activity_type?`, `linked_template_id?`, `auto_attach`, `is_deposit?` |
| **CommTemplate** | Editable copy + tokens for system comms | `tenantId`, `kind`, `channel`, `subject`, `body_markdown`, `available_tokens[]`, `active` |
| **PicklistValue** (in `picklists`) | Tenant-scoped dropdown values per field_key | `tenantId`, `field_key`, `label`, `values[]` |
| **ProviderConfig** | Stripe / Postmark / Twilio / QB stubs | `tenantId`, `kind`, `provider`, `enabled`, `public_config`, `has_secret` |
| **Role** | Tenant-defined permission bundle | `tenantId`, `name`, `permissions[]`, `is_system`, `sort_order` |
| **StaffMember** | Operator login + wage/clock profile | `tenantId`, `clerkUserId?`, `role_id`, `status`, `hourly_rate?`, `mobile_clock_pin?` |
| **Vendor** | AP counterpart to Boater | `tenantId`, `name`, `payment_terms`, `default_gl_account`, `issue_1099`, `tax_id_last4` |
| **PosLocation** | Fuel dock / ship store / restaurant / harbormaster terminal | `tenantId`, `key`, `name`, `allows_charge_to_account`, `default_tax_rate` |
| **PosCatalogItem** | POS SKU surfaced per location | `tenantId`, `sku`, `name`, `price`, `location_keys[]`, `taxable`, `active` |
| **RateLimit** (`rateLimits`) | Per-tenant per-bucket day-windowed counter (L3) | `tenantId`, `bucket_key`, `counter`, `window_started_at` |

### Entity Catalog — Auditing

| Entity | One-liner | Key fields |
|---|---|---|
| **AuditEntry** (`auditLog`) | Immutable per-mutation row; webhook callers use `actor_label: "webhook"` | `tenantId`, `actor_user_id`, `actor_label`, `ip`, `action_type`, `target_entity`, `target_id`, `payload_delta`, `via_agent`, `agent_prompt`, `created_at` |

### Entity Relationship Table (load-bearing)

| From → To | Cardinality | Field | Purpose |
|---|---|---|---|
| Boater → Marina | N : 1 | `tenantId` | Every Boater scoped to one tenant |
| Vessel → Boater | N : 1 (+ N:N via `co_owner_ids`) | `boater_id`, `co_owner_ids[]` | Primary owner + joint owners |
| Vessel → WorkOrder | 1 : 1 (last) | `last_service_wo_id` | "Last serviced" back-link, stamped by closeout chain |
| Contract → Boater | N : 1 | `boater_id` | Holder of the contract |
| Contract → Slip | N : 1 | `slip_id` | Slip the contract leases |
| Contract → Vessel | N : 1 | `vessel_id` | Vessel covered by the contract |
| Contract → ContractTemplate | N : 1 | `template_id` + `template_version` | Versioned source of the doc |
| Slip → Contract | 1 : 1 (current) | `current_contract_id` | Active holder back-pointer |
| Slip → Boater | 1 : 1 (current) | `current_holder_boater_id` | Current holder back-pointer |
| Slip → Dock | N : 1 | `dock_id` | Physical grouping |
| Reservation → Boater | N : 1 | `boater_id` | Who booked |
| Reservation → Slip | N : 1 | `slip_id` | Which slip |
| Reservation → Vessel | N : 1 | `vessel_id` | Which boat is arriving |
| Reservation → AdditionalFee | N : N | `attached_fee_ids[]` | Service fees attached at booking |
| WorkOrder → Boater | N : 1 | `boater_id` | Whose work order |
| WorkOrder → Vessel | N : 1 (opt) | `vessel_id` | Boat being serviced |
| WorkOrder → Slip | N : 1 (opt) | `slip_id` | Where the work happens |
| WorkOrder → Quote | 1 : 1 | `quote_id` | Priced estimate |
| WorkOrder → ClubBooking / BoatRental | 1 : 1 (source) | `cleaning_source_kind` + `cleaning_source_id` | Cleaning WO back-ref to the booking that spawned it |
| WorkOrder → LedgerEntry | 1 : N | `linked_ledger_entry_ids[]` | Invoices/payments produced by closeout |
| Quote → WorkOrder | N : 1 | `work_order_id` | Parent WO |
| LedgerEntry → Boater | N : 1 | `boater_id` | Whose ledger |
| LedgerEntry → WorkOrder | N : 1 (opt) | `linked_work_order_id` | Source WO |
| LedgerEntry → Contract | N : 1 (opt) | `linked_contract_id` | Source contract (annual billing) |
| LedgerEntry → Reservation | N : 1 (opt) | `linked_reservation_id` | Source reservation |
| LedgerEntry → POS Order | N : 1 (opt) | `linked_pos_order_id` | Source POS sale |
| LedgerEntry → BoatRental | N : 1 (opt) | `linked_boat_rental_id` | Source rental |
| LedgerEntry → ClubSubscription | N : 1 (opt) | `linked_club_subscription_id` | Membership monthly invoice |
| LedgerEntry → LedgerEntry | N : N | `applied_to_invoice_ids[]`, `applied_payment_id` | Payment/refund application |
| Communication → Boater | N : 1 (opt) | `boater_id` | Whose thread |
| Communication → \<related\> | N : 1 (opt) | `related_entity.{type,id}` | Open-from-comm drilldown |
| InsuranceCertificate → Boater | N : 1 | `boater_id` (denorm) | Fast lookup for holder COI list |
| InsuranceCertificate → Vessel | N : 1 | `vessel_id` | Which boat is covered |
| InsuranceCertificate → InsuranceCertificate | 1 : 1 | `renewed_by_coi_id` | Renewal chain |
| SupportTicket → Boater | N : 1 | `boater_id` | Submitter |
| SupportTicket → Marina | N : 1 | `tenantId` | Tenant queue (carve-out) |
| ClubSubscription → Rate | N : 1 | `plan_rate_id` | Rate row IS the plan |
| BoatRental → RentalBoat | N : 1 | `boat_id` | Which boat |
| BoatRental → Boater / Patron | N : 1 (XOR) | `boater_id` vs `patron_*` | Holder vs walk-in |
| Application → Marina | N : 1 | `tenantId` | Tenant whose intake queue receives it |
| Application → Boater | 1 : 1 (opt) | `result_boater_id` | Minted on approve |
| Application → WaitlistEntry | 1 : 1 (opt) | `result_waitlist_entry_id` | Minted on route-to-waitlist |
| WaitlistEntry → Slip | N : 1 (opt) | `offered_slip_id` | Which slip the fired offer covers |
| Counter → Marina | N : 1 | `tenantId` | Per-tenant sequence number generator |
| RateLimit → Marina | N : 1 | `tenantId` | Per-tenant per-bucket counter |

### Multi-Tenancy

- **Every table carries `tenantId: v.id("marinas")`** — including walk-up entities (FuelSale, BoatRental, WaitlistEntry, Application) that may have no Boater join to inherit from
- **One Clerk Organization = one row in `marinas`** (key: `clerkOrgId`, unique index `by_clerk_org`)
- **Enforcement gate**: every Convex query/mutation calls `requireTenant(ctx)` (in `convex/_helpers.ts`) first — pulls `org_id` from the Clerk JWT, resolves to a `marinas` row, refuses if absent
- **Public-mutation exception**: `applications.submit`, `waitlist.acceptOffer`, `waitlist.declineOffer` skip `requireTenant` by design (no Clerk session). They validate `tenantId` exists, cap field lengths, reject CRLF, and enforce per-email rate limits to defend the public surface (J2)
- **Every index is tenant-prefixed**: `by_tenant`, `by_tenant_status`, `by_tenant_boater`, `by_tenant_kind` (counters), `by_tenant_bucket` (rateLimits)
- **PII tokenization at the LLM boundary (TEXT only)**: `/api/agent` swaps boater names/emails for stable handles before sending to Anthropic. PDF/image inputs to `/api/pdf-extract` carry raw content — boundary asymmetry documented in §4
- **Per-tenant rate limiting**: `rateLimits` table keyed by `(tenantId, bucket_key)` checked before every `/api/agent` call (agent.requests / agent.tokens) AND every `/api/pdf-extract` call (pdf_extract.requests)
- **Per-tenant webhook URLs**: `/api/webhooks/{postmark,twilio}/[tenantId]` is the production pattern; the action enforces `expectedTenantId` against the comm row's `tenantId` before patching (H2 / K3)
- **Audit log**: every mutation writes one `auditLog` row stamped with `tenantId` + actor + delta
- **Mock-data fallback**: legacy types mark `tenant_id?` optional; the in-browser store treats `undefined` as the primary tenant so seed rows that pre-date the field continue to type-check

### Notable Shape Decisions

- **Unified booking model via discriminated PendingRequest** — slip reservations, boat rentals, and club bookings flow through one inbox shape rather than three parallel queues. The receiving entity (`Reservation` / `BoatRental` / `ClubBooking`) is chosen by the discriminator at conversion time
- **Application is its own table (not a Boater stub)** — keeps the operator queue free of placeholder Boater rows. Approve mints a real `Boater` + `Vessel` and stamps `result_boater_id`; decline never creates a Boater; route-to-waitlist inserts a `WaitlistEntry` and stamps `result_waitlist_entry_id`. A future Lead-table refactor (Phase 8) would dedupe Application + WaitlistEntry through a shared `leads` row
- **WaitlistEntry.offer_status separate from status** — `offer_status` tracks the fired-offer state machine (`pending` / `accepted` / `declined` / `expired`); the entry's overall `status` can drop back to `pending` on a per-offer decline so the boater stays on the queue. `offer_batch_id` groups a fan-out so the operator UI + audit log can show "fired 3 offers on slip A14" as one event (H1)
- **WorkOrder.work_class above activity_type** — coarse `"service" | "cleaning"` bucket drives wizard UX (cleaning gets a checklist editor + recurrence block) without losing the fine-grained `activity_type` enum below it
- **Cleaning chain back-ref (`cleaning_source_kind` + `cleaning_source_id`)** — replaces legacy `"Source: <label> <id>"` prefix on `internal_notes`. Lets every booking surface render a "Cleaning · open/scheduled/done" chip via filter rather than string-parsing
- **WorkOrder.closed_out_at idempotency stamp** — set the first time status flips to `completed`. Closeout chain short-circuits when non-null, so re-completing a WO can't double-invoice the linked quote or double-dispatch the completion comm
- **InsuranceCertificate.upload_token + upload_token_expires_at (F1 + L4)** — public `/coi-upload/[token]` URL minted by the renewal-reminder dispatch. Expiry mandatory; token lookups MUST reject expired tokens. Default TTL: 7 days
- **Communication webhook engagement fields (H2)** — `opened_at` / `clicked_at` stamped by Postmark Open/Click events (first event wins so analytics signal stays stable); `bounced_at` + `bounce_reason` flip status to `bounced`; `last_webhook_event` + `last_webhook_at` capture the most recent provider state for the audit trail
- **Marina notification provider fields (H2)** — `postmark_api_key`, `twilio_*` live on the `marinas` row; the dispatch action loads them via `getTenantNotificationConfig` and folds them into `lib/notification-dispatch.ts` resolvers. Workspace-level env-var fallback still works for the dev/demo path
- **Counters table (K1)** — race-free `APP-####`, `WO-####`, `INV-####`, etc. via `_helpers.ts → nextSequenceNumber`. Replaces every `existing.length + 1` mint site. Convex serializes mutations on the same document, so parallel inserts retry deterministically
- **AdditionalFee as canonical SKU table** — Work Orders, Contract Templates, Boat Rentals, POS, and Annual Billing Runs all reference fees by id and ride current values
- **Slip IS the SKU for annual lease** — `default_annual_rate` lives on the Slip itself (no separate rate-card join), with `slip_class` driving the tier. Contracts can override per-deal
- **Rate row IS the Rental Club plan** — `ClubSubscription.plan_rate_id` points at a `Rate` with `occupancy_type === "Rental Club"`, `cadence === "monthly"`. Setup fees moved to their own `Rate` rows
- **VendorBill idempotency_key (J3)** — guards against duplicate inserts when the PDF dropzone re-fires (network blip → user re-drops same file). Same key → same row
- **Audit log carries `via_agent` + `agent_prompt`** — every mutation through `/api/agent` writes the natural-language prompt that produced it. Webhook callers use `actor_label: "webhook"` and `via_agent` stays false


## 4. Architecture

### Stack Diagram

**Frontend**
- Framework: **Next.js 16 App Router** (note: breaking changes vs. training data — consult `node_modules/next/dist/docs/` before code edits)
- UI: **React 19**, **Tailwind CSS v4**, **TypeScript strict**
- Component layer: hand-rolled `shadcn` pattern (Radix + `cva` + `cn` in `/components/ui/*`) — CLI skipped due to Tailwind v4 + React 19 + Next 16 friction
- Icons: `lucide-react`
- Forms: hand-rolled `useState`-driven sheets in `components/create-sheet.tsx` (no RHF/Zod yet)
- Server state: direct `fetch` + NDJSON streaming via `lib/agent-fetch.ts` (no TanStack Query)
- Global/UI state: `useSyncExternalStore` singleton in `lib/client-store.ts` (no Zustand)

**Backend**
- **Convex Cloud** — system of record (32 tables in `convex/schema.ts`; adds `counters` + `applications` since the previous reference)
- Per-entity Convex function files (boaters, vessels, contracts, ledger, comms, applications, waitlist, vendorBills, rateLimit, …)
- Convex actions for non-deterministic ops (`agentActions.ts`, scheduled dispatch, webhook ingest)
- Postgres/Prisma 7 from the global stack are **explicitly waived** for this project

**Auth + Multi-tenancy**
- **Clerk** with Organizations enabled; one Clerk Org = one Marina
- `ConvexProviderWithClerk` attaches JWT to every Convex call
- JWT template literally named `convex` (lowercase) — must match `convex/auth.config.ts → applicationID`

**LLM**
- **Anthropic Claude Sonnet 4.5** via `@anthropic-ai/sdk` behind `/api/agent` (text, PII-tokenized), `/api/draft-contract`, and `/api/pdf-extract` (PDF vision, raw content)
- Text round-trips routed through `lib/pii-tokenizer.ts` before request, detokenized on response. PDF round-trips deliberately NOT tokenized — see §4 PII boundary asymmetry

**Notifications**
- **Postmark** (email) — `lib/adapters/postmark.ts` + webhook receivers at `/api/webhooks/postmark[/[tenantId]]`
- **Twilio** (SMS) — `lib/adapters/twilio.ts` + status callback receivers at `/api/webhooks/twilio[/[tenantId]]`
- Both via raw `fetch` (no SDKs — bundle weight)
- Dispatched from `lib/notification-dispatch.ts`, configured per-tenant via `marinas.postmark_*` / `marinas.twilio_*` with workspace env-var fallback

**PWA**
- Next 16 `manifest.ts` + `ImageResponse` for code-generated icons
- `sw.js` service worker
- `/dock` is the install target (HomeField Raise reference pattern)
- Capacitor planned for iOS-native shell (PWA paths kept native-clean)

**Deployment (deferred)**
- Vercel for web compute, Convex Cloud, Clerk Cloud
- Cloudflare DNS/WAF + GitHub Actions CI/CD per global standard (not wired yet)

### Multi-Tenancy Model

- **Clerk Organization ⇔ Marina** is the 1:1 primitive. Staff at two marinas join both orgs and switch via `<OrganizationSwitcher />`
- Mapping table: `marinas.clerkOrgId` (string, indexed `by_clerk_org`)
- **Every Convex table carries `tenantId: v.id("marinas")`.** No exceptions, no global tables
- Every query/mutation begins with `const tenantId = await requireTenant(ctx)` (`convex/_helpers.ts`):
  1. Reads `ctx.auth.getUserIdentity()` → throws if no Clerk session
  2. Pulls `org_id` claim from the JWT → throws if user is in personal mode
  3. Looks up `marinas` by `by_clerk_org` index → throws if Clerk org not provisioned as a Marina
  4. Returns the `marinas._id`
- `requireTenantAndUser(ctx)` is the variant that also returns `{ userId, userLabel }` for audit-log writes
- **`assertOwnedByTenant(record, tenantId)`** — defensive guard called after `ctx.db.get(id)` on sensitive entities. Throws `"Cross-tenant access denied"` on URL-tampering / token-replay
- **Public-mutation gate (J2)** — `applications.submit`, `waitlist.acceptOffer`, `waitlist.declineOffer` are public (no Clerk session). They validate: `ctx.db.get(tenantId)` returns a real marina; token length ≤ 128 (refuses adversarial index scans); per-field length caps; CRLF rejection (defeats SMTP header injection); per-email rate limit
- **No global cross-tenant query exists** — even Marina Stee's own internal admin would be a separate Convex deployment

### Per-Tenant Webhook URLs (H2 / K3)

**Why per-tenant URLs are the production pattern:**

Postmark / Twilio webhooks identify the originating message via metadata: Postmark threads `Metadata.marina_message_id` (= Convex `communications._id`); Twilio appends `?mid=<commId>` to the StatusCallback URL. If a single shared workspace URL serves all tenants, an attacker who controls tenant A's Postmark account can fire a forged event carrying tenant B's `commId` and rewrite that row's delivery status. The receiver verifies the workspace signature (which A possesses for their own webhook) and patches B's row.

**The fix:** per-tenant URLs. Each marina configures its Postmark + Twilio webhooks to point at `/api/webhooks/{provider}/[tenantId]`. The route handler:
1. Verifies the provider signature (`lib/webhook-verify.ts`)
2. Calls `convex/communications.ingestWebhookEvent` with `expectedTenantId` set from the URL path
3. The action loads the comm row, asserts `row.tenantId === expectedTenantId`, refuses + logs warning otherwise

Legacy `/api/webhooks/{provider}` (no `[tenantId]`) routes still exist for single-tenant dev. Production marinas use the per-tenant variant.

**All paths return 200** on signature failure / malformed payload / row-not-found — providers retry-storm on non-2xx, so misconfiguration must degrade silently. A hard `console.error` fires when secrets are unset so production deploys notice.

### PII Boundary Asymmetry

**TEXT inputs** to Anthropic are tokenized. **PDF / image inputs are not.** This asymmetry is deliberate and load-bearing.

**Why text gets tokenized:**

Anthropic logs requests for 30 days for safety review. Boater PII must never enter that pipeline in cleartext. `lib/pii-tokenizer.ts` swaps names/emails/phones/vessels for `<<KIND_id>>` handles before the `/api/agent` and `/api/draft-contract` round-trips, and detokenizes on the way back (see "PII Tokenization Boundary" below for the detailed F5-hardened mechanics).

**Why PDFs don't get tokenized:**

- Claude's PDF vision mode requires the raw bytes — there's no general way to swap PII out of an arbitrary multi-page document while preserving the structure the extractor reads
- COI / vendor bill / contract PDFs contain the boater's or vendor's actual names + addresses + amounts as the **operational content the operator wants extracted**. Tokenization would defeat the extraction goal
- Anthropic's 30-day log retention is accepted for documents the same way it is for the existing `/api/extract` endpoint

**Required mitigations on the PDF path:**

- **Holder-uploaded PDFs** (`/portal/[token]/coi-upload`) MUST display a consent disclosure before the upload button activates. The disclosure names Anthropic as the document processor and lists the extracted fields (carrier, policy number, vessel registration, owner name). Implemented in `components/portal/holder-coi-upload.tsx` (L4)
- **Operator-uploaded PDFs** (vendor bills, contracts via the agent rail) carry only operational data the operator already shares with Anthropic via the agent path — no additional consent disclosure required
- **Per-tenant rate limit** on `/api/pdf-extract` (L3) — 100/day per tenant on the `pdf_extract.requests` bucket; abuse leaves an audit trail and a finite blast radius
- **Long-term:** Phase 8 tracks routing PDFs through on-prem OCR (tesseract / pdfplumber) + tokenizing identified PII before Claude

### PII Tokenization Boundary (text path)

**Where:** `/api/agent` route; library at `lib/pii-tokenizer.ts`.

**Handle format:** `<<KIND_id>>` — double angle brackets, uppercase kind.
- `KIND ∈ { BOATER, LASTNAME, EMAIL, PHONE, ADDR, VESSEL, VIN, REG }`
- `id` is the underlying entity id (`b_42`, `v_17`) so identity-slot detokenization can strip the wrapper and feed the raw id to existing fuzzy resolvers
- Chose `<<…>>` deliberately: `[…]` got silently dropped by Claude in observation, and `{{…}}` collides with Mustache/Handlebars merge tokens already used in comm templates

**Flow:**
1. `buildContext()` → tenant-scoped snapshot of boaters + vessels + slips
2. `createTokenizer({ boaters, vessels })` mints a per-request `Map<string,string>` (forward + reverse). Never persisted
3. Tokenize: walk system prompt context block + user prompt, replacing real strings with handles. Longest-match-first; word-boundary + case-insensitive + possessive (`'s`) for name-shaped tokens
4. Tokenized payload → Anthropic. Anthropic sees only handles
5. Stream replies (text deltas + tool_use blocks) → detokenize on the way out
6. Tool args walked via `detokenizeToolInput` with **field-path discrimination** (F5)

**F5 hardening:**
- Field-path discrimination: identity slots (`_id`, `_query`, `_ids`, `_uuid`, `_handle`, `boater_id`, `vessel_id`, `slip_id`) → emit raw id. Content slots (`body`, `subject`, `description`, `notes`, `message`, `summary`, `internal_notes`) → emit real display name/email/phone
- Streaming chunk buffer: handle tokens that straddle two SSE chunks are joined before detokenization
- Legacy `{{kind_id}}` form still tolerated by the matcher for in-flight rollouts

### Atomic Per-Tenant Counters (K1)

**Problem the counters table solves:** every numbered entity (APP-####, WO-####, INV-####, Q-####, K-####, PMT-####, BIL-####, R-####) used to mint by counting rows — `(await query(...).collect()).length + 1`. Two concurrent inserts both read the same count and mint the same number. Race-condition number collisions were observed in stress tests.

**Solution:** `convex/_helpers.ts → nextSequenceNumber(ctx, tenantId, kind, start)`. One row per `(tenantId, kind)` in the `counters` table. Read-and-patch happens inside the same mutation transaction. Convex serializes mutations on the same document, so two parallel calls retry deterministically and mint distinct numbers.

**Usage:**

```ts
const seq = await nextSequenceNumber(ctx, tenantId, "APP", 1001);
const number = `APP-${seq}`;
```

**Coverage so far:** `applications.submit` (APP-####) is wired. Remaining numbered entities migrate as their mutations are touched.

### Rate-Limit Buckets

The `rateLimits` table keys `(tenantId, bucket_key)` with day-windowed counters. Caps live in `convex/rateLimit.ts → DEFAULT_CAPS`.

| Bucket | Cap (per tenant per day) | Where enforced | Behavior |
|---|---|---|---|
| `agent.requests` | 500 | Before every `/api/agent` call | Hard block when exceeded |
| `agent.tokens` | 50,000 (soft) | Tallied per agent response | Telemetry only — does not block |
| `pdf_extract.requests` | 100 | Before every `/api/pdf-extract` call (L3) | Hard block — Claude vision burns 10–100k tokens per multi-page PDF |
| `support.tickets` | 50 | Reserved for support module | Hard block |

`checkAndIncrement` is the authenticated path (callers in Convex context). `checkAndIncrementForTenant` is the explicit-tenant variant used by Next.js routes that authenticate via `MARINA_STEE_DEV_TOKEN` (no Clerk JWT) — `/api/pdf-extract` is the current consumer.

### Migration Mode (Phases 3 + 4 + 5)

**Additive philosophy.** Every page can be flipped read+write independently. Mock-data app keeps working until **Phase 7** burns the boats.

| Phase | What flips | State |
|---|---|---|
| 3 | Reads via `useTenantQuery` | 🟡 14 pages flipped |
| 4 | Writes via `useTenantMutation` | 🟡 12 of those 14 pages writing to Convex |
| 5 | `/api/agent` PII-tokenized + agent actions → Convex | 🟡 32+ agent actions routed via `ConvexAgentRouter`; tokenizer hardened |
| 6 | Audit log + rate limiting | 🟡 local audit shipped; Convex audit table + `rateLimits` (4 buckets) live |
| 7 | Retire `lib/mock-data.ts` + `lib/client-store.ts` | ⏳ pending |
| 8 | Deferred sweep findings | ⏳ tracked in `architecture-convex.md` §11 |

**Feature flag.** `components/providers/convex-clerk-provider.tsx`:
- Module-level `const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;`
- Publishes `ConvexEnabledContext` (boolean, constant for the session)
- When **unset**: provider renders children pass-through, `useConvexEnabled() === false`, entire app reads `lib/client-store.ts`
- When **set**: mounts `<ClerkProvider>` + `<ConvexProviderWithClerk>`, `useConvexEnabled() === true`, migrated pages start using Convex

**The seam — `useTenantQuery`:**
- `mock` arg is always passed and called unconditionally → hook-order safe
- While Convex result is `undefined` (initial sync) it falls back to mock → no empty flash
- Inner Convex branch is split into its own component so `useQuery` is only reached when provider is mounted

**Write seam — `useTenantMutation`:**
- Identical philosophy. Wraps both paths in try/catch so `void mutate(args)` callsites never silently lose Convex schema-validation / auth / tenant-mismatch / rate-limit errors (F6)
- Emits `window` `CustomEvent("marina-stee:mutation-error", { detail })` so a single global toast listener handles failures app-wide

**Agent path:**
- `ConvexAgentRouter` in `lib/agent-actions.ts` dispatches 32+ agent actions to `convex/agentActions.ts`; falls through to mock-store executors otherwise
- `executeAgentActionAsync` is the entry point; React hooks join via `lib/use-tenant-mutation.ts`
- Contract-status union is broader on the agent side (`partially_signed` / `executed` / `renewed`) than on Convex; `runConvexAction` normalizes before dispatch
- Audit-log fires Convex-side only for routed actions (no double-write); mock path still calls `logAuditLocal`

### Notification Dispatch

**Lifecycle.**
1. Caller (Convex mutation, agent action, `/api/comms/send`) inserts a `communications` row with `status="queued"`
2. `convex/communications.ts` calls `ctx.scheduler.runAfter(0, dispatchOne)` — fire-and-forget
3. `dispatchOne` action loads the row, picks adapter, invokes `lib/notification-dispatch.ts → dispatchCommunication`
4. **Per-tenant config lookup (H2)**: `getTenantNotificationConfig(tenantId)` pulls `postmark_api_key` / `twilio_*` off the `marinas` row. Adapter resolvers fold tenant config with workspace env-var fallback so a partially-configured marina (only Postmark, no Twilio) still falls through for the un-configured channel
5. **Adapter selection** by `comm.type`:
   - `"email"` → `sendViaPostmark` (POST `https://api.postmarkapp.com/email`, `X-Postmark-Server-Token` header, `Metadata.marina_message_id = comm.id` for idempotency)
   - `"sms"` → `sendViaTwilio` (POST `/Accounts/<sid>/Messages.json`, Basic auth, `StatusCallback` URL appended with `?mid=<comm.id>`)
   - `"voice"` → not yet wired; returns `error: "unsupported_channel"`
6. Callbacks `markDelivered` / `markFailed` stamp the row
7. **Inbound webhooks** (H2) call `ingestWebhookEvent` → `markOpened` / `markClicked` / `markBounced` / `recordWebhookEvent`. Each is `internalMutation` so it stays off the public api.* surface; the public route handler authenticates the **provider** via signature

**Graceful degradation:**
- Missing env vars AND missing `tenantConfig` → adapter returns `error: "no_provider_configured"`, row stamped, no throw
- Missing recipient (`"—"` or empty) → `error: "missing_recipient"`
- Voice channel → `error: "unsupported_channel"`
- Provider non-2xx → `error: "postmark_<status>: …"` or `"twilio_<status>: …"` (200-char body slice)
- Bookkeeping callback throws → logged, row stays in prior state

**Idempotency:**
- Postmark: `Metadata.marina_message_id` (5-minute dedupe window)
- Twilio: `comm.id` appended to `StatusCallback` URL; webhook receiver correlates on `mid` query param
- Webhook engagement fields: first event wins (`opened_at`/`clicked_at` don't shift on replay)

**Hardenings:**
- **F2** — `markDelivered` / `markFailed` are `internalMutation` (cross-tenant write surface closed)
- **K3** — webhook ingest enforces `expectedTenantId` against the comm row's `tenantId` when the URL is per-tenant
- **L1** — `marinas.postmark_api_key` / `twilio_auth_token` audit-redacted out of `payload_delta` on `marina.update` rows

### Audit Log Architecture

**Helper:** `convex/_helpers.ts → logAudit(ctx, args)` — every Convex mutation calls it. Inserts one row into the `auditLog` table.

**Row shape:**
- `tenantId`, `actor_user_id`, `actor_label`
- `action_type` (taxonomy below)
- `target_entity`, `target_id`
- `payload_delta` (JSON-stringified diff; PII fields scrub-redacted at callsite — see L1)
- `via_agent`, `via_bulk`, `via_closeout` flags
- `agent_prompt` (original natural-language prompt)
- `created_at`

**`action_type` taxonomy** — `<entity>.<verb>` with reserved prefixes:

| Pattern | Meaning | Examples |
|---|---|---|
| `<entity>.<verb>` | Direct human/UI action | `boater.update`, `contract.create`, `application.approve`, `application.decline`, `application.route_to_waitlist`, `waitlist.fire_offer`, `waitlist.accept_offer`, `waitlist.decline_offer`, `waitlist.expire_stale_offers` |
| `agent_<verb>` or `<entity>.<verb>` + `via_agent: true` | Agent-driven mutation | `agent_send_message`, `boater.update` + `via_agent: true` + `agent_prompt: "..."` |
| `bulk_<verb>.<step>` with `via_bulk: true` | Bulk operation | `bulk_billing_run.start`, `bulk_comm_send.*`, `bulk_renewals.*` |
| `work_order.closeout.<step>` with `via_closeout: true` | WO closeout chain | `work_order.closeout.complete`, `work_order.closeout.charge`, `work_order.closeout.sign` |
| `comm.webhook.<kind>` with `actor_label: "webhook"` | Webhook-driven mutation | `comm.webhook.delivered`, `comm.webhook.bounced`, `comm.webhook.opened`, `comm.webhook.clicked`, `comm.webhook.other` |

**Indexes:** `auditLog.by_tenant_created_at` powers the Settings → Audit Log report panel.

**Tenant scope + immutability:** rows are tenant-scoped, append-only, never deleted. Surfaced at `/settings/audit-log`.

**Traceability invariant:** any state-mutating path writes exactly one audit row — no double-write, even when an action passes through `ConvexAgentRouter`. The only exception is `applications.submit` (public, no actor identity — operator approve/decline writes the audit row at review time).


## 5. Integrations

| Integration | Status | Where wired | Env vars |
|---|---|---|---|
| **Convex** (data + functions + realtime) | Active, partial rollout (Phases 3–6 in flight) | `convex/*`, `components/providers/convex-clerk-provider.tsx`, `lib/use-tenant-{query,mutation}.ts` | `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT` |
| **Clerk** (auth + Organizations = multi-tenant primitive) | Active when Convex is on; provider gated on `NEXT_PUBLIC_CONVEX_URL` | `ConvexClerkProvider`, `convex/auth.config.ts`, `convex/_helpers.ts → requireTenant`. JWT template literally named `convex` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN` (set in BOTH `.env.local` AND `npx convex env set`) |
| **Anthropic Claude Sonnet 4.5** | Active. **Text** → PII-tokenized via `/api/agent` + `/api/draft-contract`. **PDF vision** → raw bytes via `/api/pdf-extract` (kind: `coi` / `bill` / `contract`); per-tenant rate-limited (L3); holder consent disclosure on portal upload (L4). Unset key → deterministic fallback (`lib/simulated-agent.ts`) for text; `stub: true` sentinel for PDF | `app/api/agent/route.ts`, `app/api/draft-contract/route.ts`, `app/api/pdf-extract/route.ts`, `lib/pii-tokenizer.ts`, `lib/pdf-extract.ts` | `ANTHROPIC_API_KEY`, `MARINA_STEE_DEV_TOKEN` (PDF route bearer) |
| **Postmark** (email + webhook receivers) | Adapter shipped + webhook ingest live. Sends real when configured (per-tenant key wins over workspace env-var fallback). Receives Delivery / Bounce / Open / Click / SpamComplaint events at `/api/webhooks/postmark[/[tenantId]]`. Per-tenant URL pattern is the production default | `lib/adapters/postmark.ts` + `convex/communications.ts → dispatchOne`. Webhooks: `app/api/webhooks/postmark/route.ts`, `app/api/webhooks/postmark/[tenantId]/route.ts`, `lib/webhook-verify.ts` | `POSTMARK_API_KEY` (workspace fallback) or `marinas.postmark_api_key` (per-tenant), `POSTMARK_FROM_ADDRESS`, `POSTMARK_MESSAGE_STREAM`, `POSTMARK_WEBHOOK_SECRET` |
| **Twilio** (SMS + status callbacks) | Adapter shipped + webhook ingest live. All three of (sid, token, from) required — partial config treated as no provider. Status callbacks at `/api/webhooks/twilio[/[tenantId]]` (HMAC-SHA1 signature verified) | `lib/adapters/twilio.ts` + `convex/communications.ts`. Webhooks: `app/api/webhooks/twilio/route.ts`, `app/api/webhooks/twilio/[tenantId]/route.ts` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (workspace fallback) or `marinas.twilio_*` (per-tenant), `TWILIO_STATUS_CALLBACK_URL` |
| **Stripe** (payments) | **Deferred** — explicit non-goal in `architecture-convex.md` §1 (PCI scope handled separately) | Not wired | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (commented in `.env.example`) |
| **Cloudflare** (DNS + WAF + CDN) | **Deferred** — applies at production deploy time | Not wired in repo | — (Vercel deployment proxied through Cloudflare per global standard) |
| **GitHub Actions** (CI/CD) | **Deferred** — production deploy uses `npx convex deploy --prod` + Vercel build hook | Not wired in repo | Per global Pattern A: `SSH_PRIVATE_KEY`, `SERVER_HOST`, `GITHUB_TOKEN` |
| **Convex file storage** (`_storage`) | Scaffolded; vessel photos + signed PDFs + uploaded COI/bill PDFs land here | `convex/schema.ts` (storage id refs on contracts/insurance/vessel photos) | None — Convex-internal |
| **Stee-Suite support** | **Carved out** — Marina Stee uses its own support backend, NOT `admin.stee-suite.com` | See `CLAUDE.md` §"Carve-out from global §5" | None |


## 6. Agent Surface

### Action Catalog

| Action kind | What it does | RBAC gate | Mock | Convex | Wave |
|---|---|---|---|---|---|
| **Work Orders** | | | | | |
| `create_work_order` | Drafts a new WO (boater + subject + activity + optional recurrence/cleaning source + checklist seed) | `work_order.create` | ✓ | ✓ | W1 |
| `update_work_order` | Patches status/priority/assignee/due_date; fires closeout chain when status flips to `completed` | `work_order.edit` | ✓ | ✓ | W1 |
| **Reservations + Bookings** | | | | | |
| `create_reservation` | Creates scheduled reservation in a slip (annual/seasonal/monthly/transient/recurring) | `reservation.create` | ✓ | ✓ | W1 |
| `update_reservation` | Patches arrival/departure/slip/notes | `reservation.edit` | ✓ | ✓ | W1 |
| `cancel_reservation` | Flips to `cancelled`, appends reason into notes | `reservation.edit` | ✓ | ✓ | W3 |
| **Boaters + Vessels** | | | | | |
| `create_boater` | New boater profile (name + channel + cadence + optional code/notes) | `boater.create` | ✓ | ✓ | W2 |
| `update_boater` | Patches contact email/phone, preferred_channel, cadence, notes, active | `boater.edit` | ✓ | ✓ | W2 |
| `update_vessel` | Patches vessel name/year/make/model/registration/hull_vin/active | `vessel.edit` | ✓ | ✓ | W2 |
| **Contracts** | | | | | |
| `draft_contract` | Explicit "fresh draft" intent — same shape as create_contract, distinct audit verb | `contract.create` | ✓ | ✓ | W3 |
| `update_contract` | Patches status/annual_rate/effective_start/effective_end | `contract.edit` | ✓ | ✓ | W2 |
| `mark_signed` | Stamps a contract OR quote as signed (shared dispatcher, branches on `target_kind`) | `contract.edit` | ✓ | ✓ | W3 |
| `void_contract` | Voids a never-executed draft (sets `status=terminated` + `[Voided]` marker) | `contract.edit` | ✓ | ✓ | W3 |
| `extract_contract_terms` | Drops a contract PDF on `/api/pdf-extract?kind=contract`; returns structured term draft for operator review | `contract.create` | ✓ | ✓ | H3 |
| **Quotes + Billing** | | | | | |
| `create_quote` | Draft a quote against a WO; computes subtotal/tax/total from `line_items` and back-links WO via `quote_id` | `work_order.edit` | ✓ | ✓ | W3 |
| `update_quote` | Patches lines/tax_rate/valid_until on a draft quote only (sent/signed are immutable) | `work_order.edit` | ✓ | ✓ | W3 |
| `mark_invoice_paid` | Posts a payment ledger row, applies against an invoice, clamps overpayment, flips invoice status paid/partial | `ledger.create` | ✓ | ✓ | W3 |
| `charge_to_account` | POS sale → open invoice ledger entry + boater receipt comm | `ledger.create` | ✓ | ✓ | W2 |
| `create_ledger_entry` | Manual invoice/credit/adjustment (one-off prorate, courtesy credit) | `ledger.create` | ✓ | ✓ | W3 |
| `create_vendor_bill_from_pdf` | Drops a vendor PDF on `/api/pdf-extract?kind=bill`; prefills line items + total; J3 idempotency key prevents dupes | `ledger.create` | ✓ | ✓ | H3 |
| **Insurance** | | | | | |
| `update_insurance` | Patches COI carrier/policy/dates/limit/status (maps `liability_limit` → Convex `coverage_amount`) | `boater.edit` | ✓ | ✓ | W3 |
| `request_coi_renewal` | Mints upload token + flags COI row | `broadcast.create` | ✓ | ✓ | W2 |
| `ingest_coi_pdf` | Writes parsed PDF metadata back onto an existing COI row | `boater.edit` | ✓ | ✗ | — |
| **Operations** | | | | | |
| `close_boat_rental` | Finalizes rental checkin (fuel_in/hours_in/damage), flips status=closed | `ledger.create` | ✓ | ✓ | W2 |
| `create_meter_reading` | Records utility reading; auto-fills `prev_reading`/`prev_ts` from last reading on same slip | `boater.create` | ✓ | ✓ | W2 |
| `record_fuel_sale` | Appends fuelSales row, computes total, draws down `fuelInventory` (requires `boater_id` when `payment_method=charge_to_account`) | `ledger.create` | ✓ | ✓ | W3 |
| **Communications** | | | | | |
| `send_message` | One-to-one outbound email/sms; Convex path inserts as `queued` then schedules `dispatchOne` | `broadcast.create` | ✓ | ✓ | W1 |
| **Applications (H4)** | | | | | |
| `submit_application` | Inserts a row into the public `applications` queue (operator/agent-initiated; public `/apply` form bypasses the agent path) | `boater.create` | ✓ | ✓ | H4 |
| `approve_application` | Mints Boater + Vessel; stamps `result_boater_id`; race-safe ordering (patches status before insert) | `boater.create` | ✓ | ✓ | H4 |
| `decline_application` | Stamps `reviewed_at` + `internal_review_notes` | `boater.edit` | ✓ | ✓ | H4 |
| `route_application_to_waitlist` | Inserts a `WaitlistEntry`; back-refs from `result_waitlist_entry_id` | `boater.edit` | ✓ | ✓ | H4 |
| **Waitlist (H1)** | | | | | |
| `fire_waitlist_offer` | Fans out 48h tokens to top-N candidates on a freed slip; shared `offer_batch_id` | `broadcast.create` | ✓ | ✓ | H1 |
| `accept_waitlist_offer` | Public — validates token + expiry; flips `status=converted` + `offer_status=accepted` | `broadcast.create` | ✓ | ✓ | H1 |
| `decline_waitlist_offer` | Public — flips `offer_status=declined`; entry stays on queue (`status=pending`) | `broadcast.create` | ✓ | ✓ | H1 |
| **Bulk ops** | | | | | |
| `bulk_charge` | Filter-driven billing run; Convex dispatcher unwraps into `bulkBilling.executeRun` | `ledger.create` | ✓ | ✓ | W3 |
| `bulk_renew_contracts` | Sweeps contracts expiring within `days_out`, optional `rate_adjustment_pct`; calls `bulkRenewals.executeSweep` | `contract.create` | ✓ | ✓ | W3 |
| `bulk_send_comms` | Template + filter union; calls `bulkComms.executeBatch` | `broadcast.create` | ✓ | ✓ | W3 |

**Total: 36 actions** in scope (was 27 — H1 + H3 + H4 added 9 new kinds). Every kind in `CONVEX_ROUTED_ACTIONS` has a matching dispatcher in `convex/agentActions.ts` and a matching callback on `ConvexAgentRouter`.

### Permission Gates

Every distinct `entity.action` pair used:

- `work_order.create` — `create_work_order`
- `work_order.edit` — `update_work_order`, `create_quote`, `update_quote`
- `reservation.create` — `create_reservation`
- `reservation.edit` — `update_reservation`, `cancel_reservation`
- `boater.create` — `create_boater`, `create_meter_reading`, `submit_application`, `approve_application`
- `boater.edit` — `update_boater`, `update_insurance`, `ingest_coi_pdf`, `decline_application`, `route_application_to_waitlist`
- `vessel.edit` — `update_vessel`
- `contract.create` — `draft_contract`, `bulk_renew_contracts`, `extract_contract_terms`
- `contract.edit` — `update_contract`, `mark_signed`, `void_contract`
- `ledger.create` — `charge_to_account`, `mark_invoice_paid`, `create_ledger_entry`, `close_boat_rental`, `record_fuel_sale`, `bulk_charge`, `create_vendor_bill_from_pdf`
- `broadcast.create` — `send_message`, `request_coi_renewal`, `bulk_send_comms`, `fire_waitlist_offer`, `accept_waitlist_offer`, `decline_waitlist_offer`

**Notes:** `create_meter_reading`, `update_insurance`, `ingest_coi_pdf`, and the application actions piggy-back on `boater.*` as a stand-in until dedicated `application` / `meter` / `insurance` capabilities are carved out. `close_boat_rental` gates on `ledger.create` because its end-state is the billable artifact. `create_vendor_bill_from_pdf` gates on `ledger.create` like the rest of AP. `extract_contract_terms` is read-only against the PDF but gates on `contract.create` because the agent's next step is a draft. `bulk_*` and the waitlist offer actions gate on the most-restrictive matching single-recipient entity.

### Audit Provenance

Single source of truth: every approved action stamps `via_agent: true` and stashes the operator's prompt label in `agent_prompt` on exactly one audit row.

- **Origin field**: `AgentAction.label` (the human-readable string the agent generated for the action card, e.g. `"Charge $14.50 to Smith, David"`)
- **Mock path** (`executeAgentAction` in `lib/agent-actions.ts`): after `runAction` returns, the executor calls `logAuditLocal({ ..., via_agent: true, agent_prompt: action.label })` once. `actionPayloadSummary` builds a sanitized `payload_delta` JSON (string fields under 80 chars kept verbatim; longer strings truncated to 60+`…`; arrays reduced to `[length]`; raw email/phone never copied)
- **Convex path** (`executeAgentActionAsync` → `runConvexAction`): executor passes `agent_prompt: action.label` into each `ConvexAgentRouter.*` callback. Matching dispatcher receives it as `args.provenance.agent_prompt` (or, for `bulk_*`, as flat `agent_prompt`) and calls `logAudit(ctx, { ..., via_agent: true, agent_prompt })` after the entity write
- **Exactly-once semantics**: mock branch only writes when `!isConvexRouted(...)`; Convex branch only writes server-side. Bulk dispatchers write one envelope row (`action_type: "agent_bulk_dispatch.bulk_*"`) PLUS per-entity rows their underlying execute modules already write
- **Pre-flight**: `preflightAction` runs RBAC (`can(role, perm.action, perm.entity)`) AND a cross-tenant guard (`resolveActionTenantId` vs `getCurrentTenantId`) before any mutation OR audit row is written; a denial yields `ok: false` with no audit footprint


## 7. Roadmap

### Done

**Operator UX — every major module polished to consistency standard**
- Members (boaters, vessels, waitlist, staff notes, **applications tab** — H4)
- Bookings (reservations, contracts)
- Services (rates, additional fees, picklists, customization, **waitlist fire-offer panel** — H1)
- Work Orders (kanban + quote attach + closeout chain)
- Vendors (directory + bills + **PDF dropzone** — H3)
- Insurance (COI workflow + **PDF extract preview** — H3)
- Dock PWA (`/dock` install target, dockhand surface)
- Holder Portal (boater-facing, **consent-gated COI upload with PDF preview** — L4)
- Public boater self-onboarding (`/apply` wizard + applicant status surface + **waitlist offer landing** — H1 / H4)
- Settings → Marina Profile → **Notification Providers card** — H2
- Support module (carve-out — routes to Marina Stee's own backend, not stee-suite.com)

**Convex backend — schema scaffolded + functions per table**
- `convex/schema.ts` — **32 tables**, fully indexed, every row carries `tenantId: v.id("marinas")` (added `counters`, `applications` since prior reference)
- `convex/_helpers.ts` — `requireTenant`, `requireTenantAndUser`, `logAudit`, `assertOwnedByTenant`, **`nextSequenceNumber`** (K1)
- `convex/seed.ts` — bootstrap action ready (`npx convex run seed:loadFromMockData`)
- Per-entity files: boaters, vessels, docks, slips, contracts, reservations, workOrders, ledger, fees, staff, commTemplates, providers, pos, communications, marina, rates, picklists, roles, meters, fuel, boatRentals, insurance, waitlist, marinaEvents, quotes, audit, rateLimit, staffNotes, vendors, vendorBills, insuranceCoi, **applications**

**Pages flipped to Convex (14 of 14 in scope) — read+write status**
- `/settings/pos-locations` — read + write
- `/settings/customization?tab=docks` — read + write
- `/settings/comm-templates` — read + write
- `/settings/audit-log` — read-only by design
- `/staff` Roster — read + write
- `/settings/marina-profile` — read + write (now incl. notification providers)
- `/insurance` — read + write
- `/vendors` Vendor list + bills — read + write
- `/settings/connections` — read + write
- `/settings/customization?tab=picklists` — read-only (writes deferred)
- `/reports` — read-only by design
- `/staff` Roles & access — read + write
- `/members?tab=applications` — read + write (H4)
- `/services/roster` waitlist section — read + write (H1)

**Agent actions migrated — 32+ routed across waves W1–W3 + H1/H3/H4**
- **W1**: `update_work_order`, `create_work_order`, `create_reservation`, `update_reservation`, `send_message`
- **W2**: `update_boater`, `create_boater`, `update_vessel`, `update_contract`, `charge_to_account`, `request_coi_renewal`, `close_boat_rental`, `create_meter_reading`
- **W3**: `mark_signed`, `mark_invoice_paid`, `update_insurance`, `record_fuel_sale`, `create_quote`, `update_quote`, `void_contract`, `cancel_reservation`, `create_ledger_entry`, `draft_contract`
- **H1**: `fire_waitlist_offer`, `accept_waitlist_offer`, `decline_waitlist_offer`
- **H3**: `create_vendor_bill_from_pdf`, `extract_contract_terms`
- **H4**: `submit_application`, `approve_application`, `decline_application`, `route_application_to_waitlist`

**PWA**
- Install target: `/dock`
- Manifest + shortcuts code-generated via Next 16 `manifest.ts` / `ImageResponse`
- Service worker registered, offline fallback
- iOS safe-area padding, touch target sizing

**Notifications**
- **Postmark adapter** (email) — REST `fetch`, per-tenant key fallback to env-var
- **Twilio adapter** (SMS) — REST `fetch`, per-tenant SID/token/from fallback to env-var
- `lib/notification-dispatch.ts` — orchestrator with per-tenant config resolver (H2)
- Async dispatch via `ctx.scheduler.runAfter(0, ...)` — fire-and-forget
- Audit-stamped: `markDelivered` / `markFailed` stamp delivery state
- Graceful degradation: no env vars + no tenant config → `error_reason: "no_provider_configured"`, no throw

**Webhook ingestion (H2)**
- `/api/webhooks/postmark[/[tenantId]]` — Delivery / Bounce / Open / Click / SpamComplaint / SubscriptionChange
- `/api/webhooks/twilio[/[tenantId]]` — MessageStatus callbacks
- `lib/webhook-verify.ts` — Postmark token compare + Twilio HMAC-SHA1
- Per-tenant URL pattern (K3) — `expectedTenantId` enforced against comm row's `tenantId`
- All paths return 200 on signature/payload failure; hard `console.error` on missing secret

**PDF extraction (H3)**
- `/api/pdf-extract` — Claude vision for COI / vendor bill / contract PDFs
- `lib/pdf-extract.ts` — typed extraction shapes + per-field confidence
- Per-tenant rate limit (L3) — `pdf_extract.requests` bucket, 100/day
- Holder consent disclosure (L4) — `components/portal/holder-coi-upload.tsx`
- Operator preview panel — `components/insurance/coi-extract-preview.tsx`, `components/vendors/new-bill-from-pdf-dropzone.tsx`
- Graceful degradation: `stub: true` sentinel on missing key / API failure

**Recurring chain**
- Walker (cron-driven monthly/weekly sweep)
- Month-end clamp (Feb 28/29, 30/31 handling)
- Source back-ref on every spawned row
- e2e coverage in Playwright

**Work Order closeout chain — 5-step, idempotent**
1. Quote → Invoice
2. Ledger entry created
3. Comm dispatched
4. Vessel stamp updated
5. Recurring spawn (if applicable)

**Insurance COI workflow**
- 90/60/30 day expiry classifier
- Draft reminder via Comms templates
- Holder portal upload surface with PDF preview
- Owned by `convex/insuranceCoi.ts`

**Bulk operations**
- Billing run (`bulkCharge`)
- Renewal sweep (`bulkRenewContracts`)
- Comm send (`bulkSendComms`)

**PII tokenization (HARDENED — text only)**
- `lib/pii-tokenizer.ts` — per-request lazy tokenizer
- Handle format: `<<KIND_id>>`
- Word-boundary + case-insensitive + possessive matching
- Tenant-scoped source-of-truth
- Field-path discrimination (F5)
- Streaming chunk buffer (F5)

**Atomic counters (K1)**
- `counters` table — one row per `(tenantId, kind)`
- `_helpers.ts → nextSequenceNumber` — race-free APP-####, WO-####, INV-####, etc.

**Test coverage** — 60+ Playwright e2e tests spanning kanban, reservations, recurring spawn, closeout chain, COI flow, agent actions, application intake, waitlist offer fan-out

### Recently Fixed

See **Appendix B** for the full table. Recent waves:

- **F1–F6** (prior reference) — COI tokens, internal mutations, bulk dispatchers, draft-contract tenant scope, PII detokenizer, mutation error surface
- **F#1–F#15 (J wave)** — CSPRNG token entropy on application + waitlist offers, public-mutation validation (length caps, CRLF rejection, rate limiting), race-safe ordering on `applications.approve`, vendor bill idempotency, audit log redactions, public-endpoint sanity
- **K1 / K2 / K3** — atomic per-tenant counters, per-tenant webhook URL pattern, `expectedTenantId` enforcement
- **L1 / L2 / L3 / L4** — provider-secret audit redaction, `internalMutation` guard on webhook callbacks, per-tenant PDF extract rate limit, holder consent disclosure on PDF upload paths

### Deferred

**Blocked on manual setup**
- `npx convex dev` (interactive — creates deployment, writes `.env.local`)
- Clerk signup + Application "Marina Stee Dev" + Organizations toggle
- Clerk → Convex JWT template wiring (`convex/auth.config.ts`)
- `npx convex run seed:loadFromMockData`
- Full checklist: `docs/convex-setup.md`

**Phase 6 — Production deploy**
- CI/CD pipeline (**Pattern A** from CLAUDE.md §7.5 — GHCR image + SSH `docker load`)
- DNS (Cloudflare proxy, SSL Full Strict)
- Uptime monitoring on critical endpoints
- Sentry (error reporting)

**Phase 7 — Retire mock store**
- When ALL pages flipped (currently 14/14 in scope but more pages exist outside the order list)
- Drop `lib/client-store.ts` + `lib/mock-data.ts`
- Keep `lib/types.ts` (entity types shared with Convex)

**Phase 8 — Deferred sweep findings** (from `docs/architecture-convex.md` §11)

- **Lead-table refactor** — `applications` and `waitlistEntries` duplicate the prospective-patron concept. Right depth: a `leads` table as source-of-truth with both downstream rows referencing `lead_id`. Trigger: 50+ leads + dedupe complaints, or unified leads-ingested metric for SaaS pricing
- **KMS / envelope encryption for provider secrets** — `marinas.postmark_api_key` + `twilio_auth_token` are stored as plaintext `v.string()`. L1 redacts audit; H2 masks UI input; the row itself stays plaintext until a `lib/secret-vault.ts` layer with external KMS lands. Trigger: SOC2 review or first customer IT-Sec ask
- **PDF extraction as Convex action** — today `/api/pdf-extract` is a Next.js route calling Anthropic outside Convex's trust boundary. Right depth: a `convex/pdfExtract.ts` action with atomic audit + rate-limit + Anthropic call. Trigger: Convex `v.bytes()` arg limit grows past PDF size cap (currently 8MB vs 20MB)
- **Audit log payload PII helper** — today per-callsite redaction (L1 on `application.submit`, more to find). Right depth: `scrubPayloadDelta(payload, entity)` helper invoked from every `logAudit`. Trigger: GDPR / right-to-be-forgotten implementation, or first customer audit-log export

**Real-time enhancements**
- Postmark SubscriptionChange → mark boater opted-out + suppress future sends
- Twilio inbound SMS replies → inbox thread surfacing

**Stripe Connect for SaaS billing** — who pays Marina Stee (operator-pays-vendor flow); distinct from in-marina payments (PCI-deferred per spec §1 non-goals)

**iOS native via Capacitor** — PWA-first today; native shell next. Keep web-standard APIs in `/dock` (no Electron-only assumptions)

**More agent actions (~15-20 more kinds)**
- Refund / void payment
- Certification verify
- Slip move / swap
- Vessel transfer between boaters

**Workflow features**
- Reports analytics depth (occupancy by dock, Rental Club analytics)
- Maintenance scheduling (recurring WO chain extension)
- Marketing site (marinastee.com landing + signup)

**Code review skip-list** — ~30 medium/low findings from recent `/code-review` sweeps deferred to future cleanup waves


## Appendix A — Documentation Index

- `/CLAUDE.md` — project-level overrides
- `/docs/architecture-convex.md` — authoritative backend spec (Phase 8 deferred items in §11)
- `/docs/convex-setup.md` — Steven's runbook
- `/docs/migration-page-recipe.md` — per-page Convex flip recipe + status table
- `/docs/reference.md` — this file


## Appendix B — Recent Critical Fixes

### F1–F6 (prior waves)

| Fix | Area | What changed |
|---|---|---|
| **F1** | Insurance COI tokens | `crypto.randomUUID()` token generation + 7-day expiry enforcement + ISO 8601 date validation; expired tokens MUST be rejected on lookup |
| **F2** | Notification callbacks | `markDelivered` / `markFailed` promoted from `mutation` to `internalMutation` — closes cross-tenant write surface |
| **F3** | Bulk operations | `bulkCharge`, `bulkRenewContracts`, `bulkSendComms` dispatchers wired into `ConvexAgentRouter` with per-entity audit rows |
| **F4** | Draft contract route | `/api/draft-contract` reads Clerk JWT → derives `tenantId` before any Convex call (same pattern as `/api/agent`) |
| **F5** | PII detokenizer | Field-path discrimination (identity vs content slots) + streaming chunk buffer (tokens split across NDJSON chunks reassemble correctly) |
| **F6** | Mutation error surface | `useTenantMutation` exposes `onError` + dispatches `window` `CustomEvent("marina-stee:mutation-error")` for app-wide toast handling |

### F#1–F#15 (J wave — public-surface + race + audit hardening)

| Fix | Area | What changed |
|---|---|---|
| **F#1** | Application token entropy | `applications.submit` mints `app_${crypto.randomUUID()}` (≥122 bits CSPRNG). Prior `Date.now()+Math.random()` was ~31 bits effective — brute-forceable |
| **F#2** | Waitlist offer token entropy | `waitlist.fireOffer` mints `wlo_${crypto.randomUUID()}`. Prior timestamp-prefixed form shared bits across siblings in a batch — guessable |
| **F#3** | Public-mutation tenant validation | `applications.submit` calls `ctx.db.get(args.tenantId)` and refuses unknown marinas — defeats enumeration + non-existent-tenant pollution |
| **F#4** | Public-mutation field length caps | 200-char cap on every string field; 4000-char cap on `notes`. Refuses row-blow-up + DoS on subsequent index scans |
| **F#5** | Public-mutation email format check | `applicant_email` must contain `@` and be ≥5 chars before insert |
| **F#6** | Public-mutation CRLF rejection | Every applicant string field rejected on `/[\r\n]/`. Prevents SMTP header injection through the welcome-comm body |
| **F#7** | Per-email submission rate limit | At most 25 application submissions per tenant per email per hour. Floods drop on the floor without poisoning the queue |
| **F#8** | Application token length cap | `lookupByToken` refuses input > 128 chars before index scan — adversarial-input defense |
| **F#9** | Waitlist offer token length cap | `acceptOffer` / `declineOffer` same defense — refuse > 128 char tokens |
| **F#10** | Applicant-safe projection on `lookupByToken` | Public query returns ONLY the applicant-safe fields. `internal_review_notes`, `reviewed_by`, `tenantId` deliberately omitted |
| **F#11** | Race-safe approve ordering | `applications.approve` patches status to `approved` BEFORE inserting Boater + Vessel. Convex OCC retry sees `approved` and short-circuits — no duplicate boater/vessel mints on concurrent approve |
| **F#12** | Waitlist offer expiry check | `acceptOffer` / `declineOffer` patch `status=expired` and throw if `offer_expires_at` is past — no late-acceptance bypasses the 48h window |
| **F#13** | Decline-on-expired is no-op | `declineOffer` on an expired offer flips to `expired` instead of `declined` — cleaner audit trail |
| **F#14** | Idempotent `expireStaleOffers` | Cron walker is a no-op when no stale rows exist; audit-log row only fires when `expired > 0` |
| **F#15** | Audit prompt provenance on waitlist + applications | Every waitlist + application mutation accepts `agent_prompt` and stamps it onto the audit row when set |

### K1 / K2 / K3 (atomicity + cross-tenant defense)

| Fix | Area | What changed |
|---|---|---|
| **K1** | Atomic per-tenant counters | New `counters` table + `_helpers.ts → nextSequenceNumber`. Race-free APP-####, WO-####, INV-#### etc. Replaces every `(await collect()).length + 1` mint pattern. Convex serializes mutations on the same document so parallel inserts retry deterministically |
| **K2** | Vendor bill idempotency | `vendorBills` rows carry an `idempotency_key`; PDF re-upload with the same key returns the existing row instead of double-inserting |
| **K3** | Cross-tenant webhook defense | `convex/communications.ingestWebhookEvent` accepts an `expectedTenantId` arg. When the per-tenant URL is used, the action asserts `row.tenantId === expectedTenantId` and refuses + logs warn otherwise. Closes the forged-event vector on the shared workspace URL |

### L1 / L2 / L3 / L4 (PII + abuse + consent)

| Fix | Area | What changed |
|---|---|---|
| **L1** | Audit log payload PII | `applicant_email` redacted out of `application.submit` audit `payload_delta`; same redaction applied to `marina.update` rows holding `postmark_api_key` / `twilio_auth_token`. Per-callsite today; `scrubPayloadDelta` helper deferred to Phase 8 |
| **L2** | Webhook callbacks stay internal | `markOpened` / `markClicked` / `markBounced` / `recordWebhookEvent` / `logWebhookAudit` all `internalMutation` — webhook route is the only path that can invoke them, signature-verified at the route layer |
| **L3** | PDF extract per-tenant rate limit | `/api/pdf-extract` increments `pdf_extract.requests` (100/day) via `rateLimit.checkAndIncrementForTenant` before calling Anthropic. Audit row written on every call. Caps Claude vision spend per tenant |
| **L4** | Holder consent disclosure on PDF upload | `components/portal/holder-coi-upload.tsx` displays a consent disclosure naming Anthropic as the document processor + listing extracted fields (carrier, policy number, vessel registration, owner name) before the upload button activates. COI upload token TTL also extended to honor the holder-side consent flow |
