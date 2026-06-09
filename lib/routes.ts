/*
 * Route catalog — the single source of truth for in-app navigation.
 *
 * Why this exists
 * ───────────────
 * The agent used to hallucinate URLs ("contract templates are usually under
 * /settings/contracts or /contracts/templates") because it had no ground
 * truth about the app's layout. This file is that ground truth.
 *
 * Every operator-facing page gets one entry. The agent's `navigate_to` tool
 * picks a `key` from this catalog and the chat host renders a clickable
 * card that does a client-side `router.push(path)`. No copy-paste URLs.
 *
 * Conventions
 * ───────────
 * - `key` is dot-namespaced, stable, never renamed.       e.g. "services.contracts"
 * - `path` is the actual Next.js route.                   e.g. "/services/contracts"
 * - `label` is what the operator sees on the link card.   e.g. "Contracts"
 * - `description` is what the agent reads when deciding which key fits the
 *   user's intent. Be specific about what's edited or seen on that page.
 * - `params` lists dynamic segments (e.g. `[id]`). The agent passes values
 *   in the `params` tool arg; the executor substitutes them in.
 * - `keywords` are extra trigger words for the agent to match against
 *   user intent ("templates" → services.contracts since templates live there).
 * - `tabs` are sub-views inside a single page (URL-synced via ?tab=…).
 *   Including them as separate keys lets the agent land the operator on
 *   the right sub-view, not just the right page.
 *
 * Adding a route
 * ──────────────
 * 1. Add an entry to ROUTE_CATALOG below.
 * 2. That's it. The agent picks it up automatically via formatRouteCatalog().
 * 3. If the page has tabs, add one entry per tab with `tab` set.
 *
 * Holder-mode routes are intentionally excluded — those live in the boater
 * portal under `/portal/[token]/...` and have their own tool surface.
 */

export type RouteEntry = {
  /** Stable identifier the agent passes to `navigate_to`. Never renamed. */
  key: string;
  /** Next.js route. May contain `[param]` placeholders. */
  path: string;
  /** Operator-facing label shown on the link card. */
  label: string;
  /** What lives on this page — the agent reads this to pick the right key. */
  description: string;
  /** Dynamic segment names. e.g. ["id"] for /members/[id]. */
  params?: string[];
  /** Extra trigger words to help the agent match user intent. */
  keywords?: string[];
  /** Optional URL-synced tab (?tab=foo). */
  tab?: string;
  /** Group label for the catalog injected into the system prompt. */
  group:
    | "Overview"
    | "Services"
    | "Members"
    | "Bookings"
    | "Operations"
    | "Money"
    | "Communications"
    | "Settings"
    | "Reports";
};

/*
 * Ordered by group so the prompt-injected catalog reads top-down the way
 * the sidebar does.
 */
export const ROUTE_CATALOG: ReadonlyArray<RouteEntry> = [
  // ── Overview ────────────────────────────────────────────────
  {
    key: "dashboard",
    path: "/",
    label: "Dashboard",
    description: "Marina overview — today's arrivals, departures, open balances, anomalies.",
    keywords: ["home", "overview", "today"],
    group: "Overview",
  },
  {
    key: "dock",
    path: "/dock",
    label: "Dock view (mobile)",
    description: "Mobile-first dock map — used by dockhands for walk-arounds and quick lookups.",
    keywords: ["mobile", "pwa", "walkaround"],
    group: "Overview",
  },

  // ── Services ────────────────────────────────────────────────
  {
    key: "services.overview",
    path: "/services",
    label: "Services overview",
    description: "Index page for slips, rental club, rates, fees, gas, meters, contracts.",
    keywords: ["services"],
    group: "Services",
  },
  {
    key: "services.roster",
    path: "/services/roster",
    label: "Slips",
    description: "Slip roster grouped by dock — assign holders, edit rates, see vacancy and lapsed status.",
    keywords: ["slip", "dock", "vacant", "assign", "holder"],
    group: "Services",
  },
  {
    key: "services.waitlist",
    path: "/services/waitlist",
    label: "Slip Waitlist",
    description: "Waitlist for slip openings — queue, offers, matches, archive.",
    keywords: ["waitlist", "queue", "offer"],
    group: "Services",
  },
  {
    key: "services.rental_club",
    path: "/services/rental-club",
    label: "Rental Boats",
    description: "Rental fleet — pontoons, kayaks, fishing boats. Plans, rotations, bookings.",
    keywords: ["rental", "boat club", "fleet", "pontoon"],
    group: "Services",
  },
  {
    key: "services.rates",
    path: "/services/rates",
    label: "Service rates",
    description: "Slip rates by dock and size. Change a rate here and it applies to all new contracts.",
    keywords: ["rate", "price", "annual", "monthly", "seasonal"],
    group: "Services",
  },
  {
    key: "services.fees",
    path: "/services/fees",
    label: "Fees",
    description: "One-time and recurring service fees — pump-out, winterization, hoist, transfer.",
    keywords: ["fee", "pump-out", "winterization", "hoist"],
    group: "Services",
  },
  {
    key: "services.gas",
    path: "/services/gas",
    label: "Gas",
    description: "Fuel dock — prices, tanks, dispenses, reconciliations.",
    keywords: ["fuel", "gas", "diesel", "tank"],
    group: "Services",
  },
  {
    key: "services.meters",
    path: "/services/meters",
    label: "Meters",
    description: "Electric meter readings per slip — anomaly detection, monthly billing rollups.",
    keywords: ["meter", "electric", "kwh", "reading"],
    group: "Services",
  },
  {
    key: "services.contracts",
    path: "/services/contracts",
    label: "Contracts",
    description: "All contracts list + renewal pipeline. Includes contract TEMPLATES (the template merge body lives here, not under Settings).",
    keywords: ["contract", "renewal", "template", "lease", "agreement"],
    group: "Services",
  },
  {
    key: "services.contracts.detail",
    path: "/services/contracts/[id]",
    label: "Contract detail",
    description: "Single contract — body, signatures, term, rate, history.",
    params: ["id"],
    group: "Services",
  },
  {
    key: "services.contracts.pipeline",
    path: "/services/contracts?tab=pipeline",
    label: "Renewal pipeline",
    description: "Kanban view of contracts moving from Up-for-renewal → Drafted → Sent → Signed.",
    tab: "pipeline",
    keywords: ["renewal", "pipeline", "kanban"],
    group: "Services",
  },
  {
    key: "services.renewals",
    path: "/services/renewals",
    label: "Renewals",
    description: "Bulk renewal cycle runner — draft successor contracts in waves with rate lifts.",
    keywords: ["bulk renewal", "renewals", "cycle"],
    group: "Services",
  },
  {
    key: "services.slip_detail",
    path: "/services/[id]",
    label: "Slip detail",
    description: "Single slip — current holder, vessel, contract, meter, history.",
    params: ["id"],
    group: "Services",
  },
  {
    key: "services.slip_assign",
    path: "/services/[id]/assign",
    label: "Assign slip holder",
    description: "Wizard for assigning a holder to a vacant slip — member, pricing, services, contract.",
    params: ["id"],
    keywords: ["assign", "wizard"],
    group: "Services",
  },

  // ── Members ────────────────────────────────────────────────
  {
    key: "members",
    path: "/members",
    label: "Members",
    description: "All boaters/members. Search, filter, see balances and contracts at a glance.",
    keywords: ["boater", "member", "customer", "holder"],
    group: "Members",
  },
  {
    key: "members.detail",
    path: "/members/[id]",
    label: "Member detail",
    description: "Single boater — contact info, vessels, slip, contract, ledger, comms.",
    params: ["id"],
    group: "Members",
  },
  {
    key: "members.bulk_renewals",
    path: "/members/bulk-renewals",
    label: "Bulk renewals",
    description: "Bulk-renew a filtered cohort of members. Pick rate adjustment + scope.",
    keywords: ["bulk", "mass renewal"],
    group: "Members",
  },
  {
    key: "billing.bulk_run",
    path: "/billing/bulk-run",
    label: "Bulk billing run",
    description: "Run annual / monthly recurring billing for all eligible members.",
    keywords: ["billing", "bulk", "invoices"],
    group: "Money",
  },
  {
    key: "comms.bulk_send",
    path: "/comms/bulk-send",
    label: "Bulk message",
    description: "Send a broadcast to a filtered cohort — SMS or email.",
    keywords: ["broadcast", "bulk send", "message"],
    group: "Communications",
  },

  // ── Bookings ────────────────────────────────────────────────
  {
    key: "bookings",
    path: "/bookings",
    label: "Bookings",
    description: "Transient reservations — calendar, day-of arrivals, departures.",
    keywords: ["reservation", "transient", "booking"],
    group: "Bookings",
  },
  {
    key: "reservations.detail",
    path: "/reservations/[id]",
    label: "Reservation detail",
    description: "Single reservation — boat, dates, slip, charges.",
    params: ["id"],
    group: "Bookings",
  },
  {
    key: "boat_rentals",
    path: "/boat-rentals",
    label: "Boat rentals",
    description: "Rental club active sessions — what's out, when it's back.",
    keywords: ["rental session", "out on water"],
    group: "Bookings",
  },
  {
    key: "boat_rentals.detail",
    path: "/boat-rentals/[id]",
    label: "Rental detail",
    description: "Single rental — patron/boater, hours, fuel, damage.",
    params: ["id"],
    group: "Bookings",
  },

  // ── Operations ──────────────────────────────────────────────
  {
    key: "work_orders",
    path: "/work-orders",
    label: "Work Orders",
    description: "Service work orders — winterization, bottom paint, repair, inspection.",
    keywords: ["work order", "service", "WO"],
    group: "Operations",
  },
  {
    key: "work_orders.detail",
    path: "/work-orders/[id]",
    label: "Work order detail",
    description: "Single work order — task, assignee, status, attachments.",
    params: ["id"],
    group: "Operations",
  },
  {
    key: "assets",
    path: "/assets",
    label: "Assets & PM",
    description: "Marina assets (lifts, pumps, vehicles) + preventive maintenance schedules.",
    keywords: ["asset", "PM", "preventive maintenance", "lift"],
    group: "Operations",
  },
  {
    key: "assets.detail",
    path: "/assets/[id]",
    label: "Asset detail",
    description: "Single asset — PM schedule, history, last check.",
    params: ["id"],
    group: "Operations",
  },
  {
    key: "inventory",
    path: "/inventory",
    label: "Inventory",
    description: "Ship store stock + back-of-house parts. Receive, adjust, log loss.",
    keywords: ["stock", "store", "parts", "inventory"],
    group: "Operations",
  },
  {
    key: "vendors",
    path: "/vendors",
    label: "Vendors",
    description: "Suppliers + service providers. Bills, payments, contact info.",
    keywords: ["supplier", "vendor", "bill", "AP"],
    group: "Operations",
  },
  {
    key: "vendors.detail",
    path: "/vendors/[id]",
    label: "Vendor detail",
    description: "Single vendor — bills, payments, contact.",
    params: ["id"],
    group: "Operations",
  },
  {
    key: "insurance",
    path: "/insurance",
    label: "Insurance / COIs",
    description: "Certificates of insurance on file. Expirations, renewals, holder uploads.",
    keywords: ["COI", "insurance", "certificate", "policy"],
    group: "Operations",
  },
  {
    key: "staff",
    path: "/staff",
    label: "Staff",
    description: "Marina staff — wages, time entries, certifications, shifts.",
    keywords: ["staff", "employee", "timecard", "payroll"],
    group: "Operations",
  },
  {
    key: "staff.detail",
    path: "/staff/[id]",
    label: "Staff detail",
    description: "Single staff member — wage, certs, shifts.",
    params: ["id"],
    group: "Operations",
  },

  // ── Money ──────────────────────────────────────────────────
  {
    key: "ledger",
    path: "/ledger",
    label: "Ledger / POS",
    description: "All financial activity — invoices, payments, POS orders, applied credits.",
    keywords: ["ledger", "POS", "invoice", "payment", "register"],
    group: "Money",
  },

  // ── Communications ─────────────────────────────────────────
  {
    key: "inbox",
    path: "/inbox",
    label: "Inbox",
    description: "Inbound communications — emails, texts, contact-form submissions.",
    keywords: ["inbox", "email", "sms", "messages"],
    group: "Communications",
  },
  {
    key: "comms",
    path: "/comms",
    label: "Communications",
    description: "Outbound communications log — what was sent, when, to whom.",
    keywords: ["sent", "log", "outbound"],
    group: "Communications",
  },
  {
    key: "notifications",
    path: "/notifications",
    label: "Notifications",
    description: "In-app notification feed — anomalies, threshold breaches, action confirmations.",
    keywords: ["alerts", "notifications"],
    group: "Communications",
  },

  // ── Reports ────────────────────────────────────────────────
  {
    key: "reports",
    path: "/reports",
    label: "Reports",
    description: "Saved reports — occupancy, open balances, renewals by month, lapsed cohort.",
    keywords: ["report", "analytics", "saved query"],
    group: "Reports",
  },

  // ── Settings ───────────────────────────────────────────────
  {
    key: "settings",
    path: "/settings",
    label: "Settings",
    description: "Marina settings — profile, docks, POS locations, comm templates, integrations.",
    keywords: ["settings", "config"],
    group: "Settings",
  },
  {
    key: "settings.marina_profile",
    path: "/settings/marina-profile",
    label: "Marina profile",
    description: "Edit marina display name, address, phone, outbound email sender.",
    keywords: ["profile", "branding"],
    group: "Settings",
  },
  {
    key: "settings.docks",
    path: "/settings/docks",
    label: "Docks",
    description: "Manage dock definitions — names, slip counts, layouts.",
    keywords: ["dock setup"],
    group: "Settings",
  },
  {
    key: "settings.pos_locations",
    path: "/settings/pos-locations",
    label: "POS locations",
    description: "Register / register-group setup. Tax rates, default location for charges.",
    keywords: ["register", "POS setup"],
    group: "Settings",
  },
  {
    key: "settings.comm_templates",
    path: "/settings/comm-templates",
    label: "Comm templates",
    description: "Reusable email + SMS templates with merge fields for transactional comms.",
    keywords: ["template", "merge", "email template", "sms template"],
    group: "Settings",
  },
  {
    key: "settings.staff",
    path: "/settings/staff",
    label: "Staff & roles",
    description: "Add / invite staff and define role permissions.",
    keywords: ["roles", "permissions", "invite"],
    group: "Settings",
  },
  {
    key: "settings.connections",
    path: "/settings/connections",
    label: "Integrations",
    description: "Third-party connections — QuickBooks, Twilio, Postmark, payment processor.",
    keywords: ["integration", "QuickBooks", "Twilio", "Postmark"],
    group: "Settings",
  },
  {
    key: "settings.customization",
    path: "/settings/customization",
    label: "Customization",
    description: "Marina-specific customization — logo, brand color, custom fields.",
    keywords: ["branding", "logo", "theme"],
    group: "Settings",
  },
  {
    key: "settings.audit_log",
    path: "/settings/audit-log",
    label: "Audit log",
    description: "Append-only mutation log — every write with actor, IP, payload delta.",
    keywords: ["audit", "log", "history", "compliance"],
    group: "Settings",
  },
  {
    key: "settings.import",
    path: "/settings/import",
    label: "Data import",
    description: "Bulk import boaters, contracts, vessels from CSV.",
    keywords: ["import", "CSV", "bulk upload"],
    group: "Settings",
  },
  {
    key: "onboarding",
    path: "/onboarding",
    label: "Onboarding",
    description: "Operator onboarding wizard — first-run setup.",
    keywords: ["onboarding", "first run", "setup"],
    group: "Settings",
  },
  {
    key: "support",
    path: "/support",
    label: "Support",
    description: "Operator-facing support tickets to the Marina Stee team.",
    keywords: ["help", "support"],
    group: "Settings",
  },
];

/**
 * Look up a single route by key. Returns undefined if the key doesn't exist —
 * the agent should never pass an unknown key, but the executor still guards
 * against it as defense-in-depth.
 */
export function getRoute(key: string): RouteEntry | undefined {
  return ROUTE_CATALOG.find((r) => r.key === key);
}

/**
 * Substitute params (e.g. `[id]`) into a route path. Missing params throw —
 * the agent is supposed to provide every value listed in `params`.
 */
export function resolveRoutePath(
  entry: RouteEntry,
  params: Record<string, string | undefined> = {},
): string {
  let path = entry.path;
  for (const name of entry.params ?? []) {
    const value = params[name];
    if (!value) {
      throw new Error(`navigate_to: missing param "${name}" for route "${entry.key}"`);
    }
    path = path.replace(`[${name}]`, encodeURIComponent(value));
  }
  return path;
}

/**
 * Render the catalog as a compact textual list for injection into the agent's
 * system prompt. The agent uses this to pick the right `route_key`.
 *
 * Output shape (one line per route):
 *   - services.contracts → /services/contracts — Contracts: All contracts list + renewal pipeline…
 *
 * Grouped to mirror the sidebar so the agent gets spatial intuition for free.
 */
export function formatRouteCatalog(): string {
  const groups = new Map<string, RouteEntry[]>();
  for (const r of ROUTE_CATALOG) {
    const list = groups.get(r.group) ?? [];
    list.push(r);
    groups.set(r.group, list);
  }

  const lines: string[] = [];
  for (const [group, entries] of groups) {
    lines.push(`\n## ${group}`);
    for (const e of entries) {
      const paramStr = e.params?.length ? ` (params: ${e.params.join(", ")})` : "";
      const kwStr = e.keywords?.length ? ` [keywords: ${e.keywords.join(", ")}]` : "";
      lines.push(
        `- ${e.key} → ${e.path}${paramStr} — ${e.label}: ${e.description}${kwStr}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * List of valid route keys — used as a Claude tool enum so the model can only
 * pick a key that actually exists.
 */
export const ROUTE_KEYS: string[] = ROUTE_CATALOG.map((r) => r.key);
