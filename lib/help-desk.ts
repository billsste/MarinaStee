"use client";

import * as React from "react";

/*
 * Help-desk module — marina operators (Marina Stee's *users*) file
 * build-side tickets to the Marina Stee SaaS team.
 *
 * Distinct from the multi-tenant boater→marina support module under
 * /support. That one is a marina's customer-facing queue. This one is
 * a SaaS-product feedback channel: a marina admin reports a bug,
 * requests a feature, asks a question.
 *
 * Routing destination: long-term, admin.marinastee.com (the SaaS
 * provider's own support backend). For now the destination is a
 * placeholder — tickets land in a self-contained in-browser store
 * that survives soft-reloads via localStorage, so demos can show the
 * full lifecycle (file → reply → cancel) without a real backend.
 *
 * The shape mirrors EquipDispatch's `/api/support/tickets` request +
 * response so when the real Marina Stee admin backend lands, the
 * client code doesn't need to change.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type HelpTicketType = "issue" | "enhancement" | "question";
export type HelpTicketPriority = "low" | "normal" | "high" | "urgent";
export type HelpTicketStatus =
  | "open"
  | "in_progress"
  | "human_review"
  | "waiting"
  | "resolved"
  | "closed"
  | "cancelled";

export type HelpTicketArea =
  | "members"
  | "slips_docks"
  | "contracts"
  | "ledger_pos"
  | "comms"
  | "bookings_rentals"
  | "work_orders"
  | "inbox"
  | "agent"
  | "onboarding"
  | "settings"
  | "auth"
  | "general";

export interface HelpAttachment {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  /** In real backend this is an opaque storage id. Here we hold the
   *  decoded data URL so the demo can show real previews. */
  data_url?: string;
}

export interface HelpComment {
  id: string;
  actor: string;
  actor_kind: "operator" | "support" | "system";
  body: string;
  created_at: string;
}

export interface HelpTicket {
  id: string;
  reference: string; // e.g. "HD-204"
  subject: string;
  description: string;
  type: HelpTicketType;
  priority: HelpTicketPriority;
  area: HelpTicketArea;
  steps_to_reproduce?: string;
  page_url?: string;
  attachments: HelpAttachment[];
  comments: HelpComment[];
  status: HelpTicketStatus;
  submitter_name: string;
  submitter_email: string;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────
// Constants — surfaced to the page so option lists stay in lockstep
// ─────────────────────────────────────────────────────────────────────

export const TYPE_OPTIONS: { value: HelpTicketType; label: string }[] = [
  { value: "issue", label: "Bug / Issue" },
  { value: "enhancement", label: "Enhancement" },
  { value: "question", label: "Question" },
];

export const PRIORITY_OPTIONS: { value: HelpTicketPriority; label: string }[] =
  [
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" },
  ];

export const AREA_OPTIONS: { value: HelpTicketArea; label: string }[] = [
  { value: "members", label: "Members / Boaters" },
  { value: "slips_docks", label: "Slips & Docks" },
  { value: "contracts", label: "Contracts & Signing" },
  { value: "ledger_pos", label: "Ledger / POS / Billing" },
  { value: "comms", label: "Comms & Messaging" },
  { value: "bookings_rentals", label: "Bookings & Rentals" },
  { value: "work_orders", label: "Work Orders" },
  { value: "inbox", label: "Inbox" },
  { value: "agent", label: "Agent / AI" },
  { value: "onboarding", label: "Onboarding flow" },
  { value: "settings", label: "Settings" },
  { value: "auth", label: "Login / Access" },
  { value: "general", label: "General" },
];

// Friendly labels used in the UI ─────────────────────────────────────

export function typeLabel(t: HelpTicketType): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? "Other";
}
export function priorityLabel(p: HelpTicketPriority): string {
  return PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? "Normal";
}
export function areaLabel(a: HelpTicketArea): string {
  return AREA_OPTIONS.find((o) => o.value === a)?.label ?? "General";
}
export function statusLabel(s: HelpTicketStatus): string {
  switch (s) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "human_review":
      return "Human review";
    case "waiting":
      return "Waiting on you";
    case "resolved":
      return "Resolved";
    case "closed":
      return "Closed";
    case "cancelled":
      return "Cancelled";
  }
}

/** Maps to the design-token-driven Badge tones. */
export function statusTone(
  s: HelpTicketStatus,
): "ok" | "warn" | "info" | "danger" | "neutral" {
  switch (s) {
    case "resolved":
    case "closed":
      return "ok";
    case "waiting":
      return "warn";
    case "in_progress":
    case "human_review":
      return "info";
    case "cancelled":
      return "neutral";
    case "open":
    default:
      return "info";
  }
}
export function priorityTone(
  p: HelpTicketPriority,
): "danger" | "warn" | "info" | "neutral" {
  switch (p) {
    case "urgent":
      return "danger";
    case "high":
      return "warn";
    case "low":
      return "neutral";
    case "normal":
    default:
      return "info";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Self-contained store — useSyncExternalStore singleton, mirroring
// the client-store pattern Marina Stee uses everywhere else.
// localStorage-backed so demo sessions persist a refresh.
// ─────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "marina-stee:help-desk:v1";

interface StoreState {
  tickets: HelpTicket[];
}

let state: StoreState = { tickets: [] };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable (private window) — swallow.
  }
}

function hydrate() {
  try {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Seed an initial example ticket so the empty state isn't bleak
      // on first visit. Skippable in tests via a "skip-seed" flag the
      // page can set before mounting.
      state = { tickets: defaultSeed() };
      persist();
      return;
    }
    state = JSON.parse(raw) as StoreState;
  } catch {
    state = { tickets: defaultSeed() };
  }
}

let hydrated = false;
function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  hydrate();
}

function defaultSeed(): HelpTicket[] {
  // Two example tickets — one resolved (shows the conversation pattern),
  // one open. Created-at is a fixed-relative string rather than Date.now()
  // so server-render and client-render line up.
  const nowISO = "2026-06-09T15:30:00.000Z";
  const earlierISO = "2026-06-05T10:12:00.000Z";
  return [
    {
      id: "hd_demo_resolved",
      reference: "HD-103",
      subject: "Stepper label truncated on long step names",
      description:
        "The work-order wizard shows 'SCHEDULE & ESTIMA…' on the 5th step. Looks broken.",
      type: "issue",
      priority: "normal",
      area: "work_orders",
      steps_to_reproduce:
        "1. Open + New work order from Members → Work Orders\n2. Pick Service, Continue\n3. See the stepper row above the form",
      page_url: "https://marina.stee-suite.com/work-orders",
      attachments: [],
      comments: [
        {
          id: "cmt_demo_1",
          actor: "Marina Stee Support",
          actor_kind: "support",
          body: "Confirmed — fixed in today's deploy. The label was clipping with `truncate`; we now allow it to wrap. Thanks for the screenshot!",
          created_at: nowISO,
        },
      ],
      status: "resolved",
      submitter_name: "Steven Bills",
      submitter_email: "billsste@gmail.com",
      created_at: earlierISO,
      updated_at: nowISO,
    },
    {
      id: "hd_demo_open",
      reference: "HD-104",
      subject: "Allow custom contract templates per marina",
      description:
        "We have a non-standard winterization addendum. Would be great to upload our own contract template instead of editing the seeded one.",
      type: "enhancement",
      priority: "high",
      area: "contracts",
      page_url: "https://marina.stee-suite.com/services/contracts",
      attachments: [],
      comments: [],
      status: "open",
      submitter_name: "Steven Bills",
      submitter_email: "billsste@gmail.com",
      created_at: nowISO,
      updated_at: nowISO,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

function subscribe(cb: () => void) {
  ensureHydrated();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): HelpTicket[] {
  ensureHydrated();
  return state.tickets;
}

function getServerSnapshot(): HelpTicket[] {
  return [];
}

/** Subscribe to all tickets. Newest first. */
export function useHelpTickets(): HelpTicket[] {
  const tickets = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  // Sort defensively here so insert-order doesn't have to maintain sort.
  return React.useMemo(
    () =>
      [...tickets].sort((a, b) =>
        a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
      ),
    [tickets],
  );
}

let counter = 200;
function nextReference(): string {
  counter += 1;
  return `HD-${counter}`;
}

function nowIso(): string {
  // Deferred until call time (not module-load) so tests with frozen
  // time still produce sensible output.
  return new Date().toISOString();
}

export interface CreateHelpTicketInput {
  subject: string;
  description: string;
  type: HelpTicketType;
  priority: HelpTicketPriority;
  area: HelpTicketArea;
  steps_to_reproduce?: string;
  page_url?: string;
  attachments?: Array<Omit<HelpAttachment, "id">>;
  submitter_name: string;
  submitter_email: string;
}

export function createHelpTicket(input: CreateHelpTicketInput): HelpTicket {
  ensureHydrated();
  const ts = nowIso();
  const ticket: HelpTicket = {
    id: `hd_${ts}_${Math.random().toString(36).slice(2, 8)}`,
    reference: nextReference(),
    subject: input.subject.trim(),
    description: input.description.trim(),
    type: input.type,
    priority: input.priority,
    area: input.area,
    steps_to_reproduce: input.steps_to_reproduce?.trim() || undefined,
    page_url: input.page_url?.trim() || undefined,
    attachments: (input.attachments ?? []).map((a, i) => ({
      ...a,
      id: `att_${ts}_${i}`,
    })),
    comments: [],
    status: "open",
    submitter_name: input.submitter_name,
    submitter_email: input.submitter_email,
    created_at: ts,
    updated_at: ts,
  };
  state = { tickets: [ticket, ...state.tickets] };
  persist();
  emit();
  return ticket;
}

export function addHelpComment(
  ticketId: string,
  body: string,
  actor: { name: string; kind: HelpComment["actor_kind"] },
): HelpComment | null {
  ensureHydrated();
  const idx = state.tickets.findIndex((t) => t.id === ticketId);
  if (idx < 0) return null;
  const ts = nowIso();
  const comment: HelpComment = {
    id: `cmt_${ts}_${Math.random().toString(36).slice(2, 6)}`,
    actor: actor.name,
    actor_kind: actor.kind,
    body: body.trim(),
    created_at: ts,
  };
  const next = { ...state.tickets[idx] };
  next.comments = [...next.comments, comment];
  next.updated_at = ts;
  // Operator reply → status moves to in_progress so the queue reflects
  // that the conversation is alive again.
  if (actor.kind === "operator" && next.status === "waiting") {
    next.status = "in_progress";
  }
  const nextList = state.tickets.slice();
  nextList[idx] = next;
  state = { tickets: nextList };
  persist();
  emit();
  return comment;
}

export function cancelHelpTicket(ticketId: string): boolean {
  ensureHydrated();
  const idx = state.tickets.findIndex((t) => t.id === ticketId);
  if (idx < 0) return false;
  const ts = nowIso();
  const next: HelpTicket = {
    ...state.tickets[idx],
    status: "cancelled",
    updated_at: ts,
    comments: [
      ...state.tickets[idx].comments,
      {
        id: `cmt_${ts}_sys`,
        actor: "System",
        actor_kind: "system",
        body: "Ticket cancelled by the operator. History preserved.",
        created_at: ts,
      },
    ],
  };
  const nextList = state.tickets.slice();
  nextList[idx] = next;
  state = { tickets: nextList };
  persist();
  emit();
  return true;
}
