// Marina Stee auth + RBAC.
//
// Demo-mode: the "current user" is just a client-side selection over the
// mock USERS list — a topbar switcher lets you act as any of them so role
// gating can be exercised without a real session. Production will swap
// this for a magic-link auth + a `marina_id`-scoped JWT.
//
// Role permissions: a single matrix keyed by Role × Entity → allowed
// Actions. The `can()` helper is the single source of truth that every
// surface (UI buttons, RecordEditDialog, agent tool routing) checks.

"use client";

import * as React from "react";
import { USERS } from "@/lib/mock-data";
import type { User } from "@/lib/types";

export type Role =
  | "super_admin"    // platform owner (us, Marina Stee operator)
  | "manager"        // marina-level admin — full ops + financial + config
  | "accounting"    // financial + reporting, no slip/dock ops
  | "dockhand"      // daily ops — arrivals, meters, fuel, day passes, WOs
  | "read_only";    // view + agent queries only

// One entity = one bucket of records the user can interact with.
export type Entity =
  | "rate"
  | "fee"
  | "contract"
  | "template"      // contract templates
  | "reservation"
  | "insurance"
  | "boater"
  | "vessel"
  | "work_order"
  | "ledger"        // invoices, payments, refunds
  | "meter"
  | "staff_note"
  | "settings"      // marina identity, staff list, integrations
  | "broadcast"     // mass-send messages
  | "event"         // marina events on the calendar
  | "waitlist"
  | "rental_group"  // docks / jet-ski racks / buoy fields / dry storage
  | "rental_space"  // individual slip / berth / bay
  | "gas";          // fuel dock readings + pricing

export type Action = "view" | "create" | "edit" | "delete";

// Permission matrix. A blank Action[] means the role has no access to that
// entity at all (which the can() helper translates to false for any action).
const PERMISSIONS: Record<Role, Partial<Record<Entity, Action[]>>> = {
  super_admin: {
    rate: ["view", "create", "edit", "delete"],
    fee: ["view", "create", "edit", "delete"],
    contract: ["view", "create", "edit", "delete"],
    template: ["view", "create", "edit", "delete"],
    reservation: ["view", "create", "edit", "delete"],
    insurance: ["view", "create", "edit", "delete"],
    boater: ["view", "create", "edit", "delete"],
    vessel: ["view", "create", "edit", "delete"],
    work_order: ["view", "create", "edit", "delete"],
    ledger: ["view", "create", "edit", "delete"],
    meter: ["view", "create", "edit", "delete"],
    staff_note: ["view", "create", "edit", "delete"],
    settings: ["view", "create", "edit", "delete"],
    broadcast: ["view", "create", "edit", "delete"],
    event: ["view", "create", "edit", "delete"],
    waitlist: ["view", "create", "edit", "delete"],
    rental_group: ["view", "create", "edit", "delete"],
    rental_space: ["view", "create", "edit", "delete"],
    gas: ["view", "create", "edit", "delete"],
  },
  manager: {
    rate: ["view", "create", "edit", "delete"],
    fee: ["view", "create", "edit", "delete"],
    contract: ["view", "create", "edit", "delete"],
    template: ["view", "create", "edit", "delete"],
    reservation: ["view", "create", "edit", "delete"],
    insurance: ["view", "create", "edit", "delete"],
    boater: ["view", "create", "edit", "delete"],
    vessel: ["view", "create", "edit", "delete"],
    work_order: ["view", "create", "edit", "delete"],
    ledger: ["view", "create", "edit", "delete"],
    meter: ["view", "create", "edit", "delete"],
    staff_note: ["view", "create", "edit", "delete"],
    settings: ["view", "edit"],
    broadcast: ["view", "create", "edit"],
    event: ["view", "create", "edit", "delete"],
    waitlist: ["view", "create", "edit", "delete"],
    rental_group: ["view", "create", "edit", "delete"],
    rental_space: ["view", "create", "edit", "delete"],
    gas: ["view", "create", "edit"],
  },
  accounting: {
    // Financial domain — full access. Slip/dock ops — read-only.
    rate: ["view"],
    fee: ["view", "create", "edit"],
    contract: ["view", "create", "edit"],
    template: ["view"],
    reservation: ["view"],
    insurance: ["view"],
    boater: ["view", "edit"],
    vessel: ["view"],
    work_order: ["view"],
    ledger: ["view", "create", "edit", "delete"],
    meter: ["view"],
    staff_note: ["view", "create"],
    settings: ["view"],
    broadcast: ["view", "create"], // payment reminders etc.
    event: ["view"],
    waitlist: ["view"],
    rental_group: ["view"],
    rental_space: ["view"],
    gas: ["view"],
  },
  dockhand: {
    // Daily ops — make stuff happen on the docks. No money / no contracts.
    rate: ["view"],
    fee: ["view"],
    contract: ["view"],
    template: ["view"],
    reservation: ["view", "create", "edit"],
    insurance: ["view"],
    boater: ["view"],
    vessel: ["view", "edit"],
    work_order: ["view", "create", "edit"],
    ledger: ["view"],
    meter: ["view", "create", "edit"],
    staff_note: ["view", "create"],
    settings: [],
    broadcast: ["view"],
    event: ["view"],
    waitlist: ["view", "create"],
    rental_group: ["view"],
    rental_space: ["view", "edit"],
    gas: ["view", "edit"],
  },
  read_only: {
    rate: ["view"],
    fee: ["view"],
    contract: ["view"],
    template: ["view"],
    reservation: ["view"],
    insurance: ["view"],
    boater: ["view"],
    vessel: ["view"],
    work_order: ["view"],
    ledger: ["view"],
    meter: ["view"],
    staff_note: ["view"],
    settings: [],
    broadcast: ["view"],
    event: ["view"],
    waitlist: ["view"],
    rental_group: ["view"],
    rental_space: ["view"],
    gas: ["view"],
  },
};

export function can(role: Role, action: Action, entity: Entity): boolean {
  const allowed = PERMISSIONS[role]?.[entity];
  if (!allowed) return false;
  return allowed.includes(action);
}

/*
 * Human-readable role label + short blurb for UI affordances.
 */
export const ROLE_META: Record<Role, { label: string; blurb: string }> = {
  super_admin: { label: "Super admin", blurb: "Platform owner — full access" },
  manager: { label: "Manager", blurb: "Full marina ops + finance + config" },
  accounting: { label: "Accounting", blurb: "Finance + reporting only" },
  dockhand: { label: "Dockhand", blurb: "Daily ops — slips, meters, fuel" },
  read_only: { label: "Read only", blurb: "View + agent queries" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Current user — demo-mode reactive store
// ─────────────────────────────────────────────────────────────────────────────

// We attach roles to existing mock USERS (which already have `role` but with
// a smaller union). Map them here so we don't have to rewrite mock-data.
const USER_ROLE_OVERRIDE: Record<string, Role> = {
  u_steven: "manager",
  u_tiffany: "accounting",
  u_will: "dockhand",
  u_jreyes: "dockhand",
  u_system: "super_admin",
};

// Override User.role with our broader Role type (User.role is the legacy
// narrower union from before RBAC).
export type CurrentUser = Omit<User, "role"> & { role: Role };

let currentUserId: string = "u_steven";
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function snapshot(): CurrentUser {
  const u = USERS.find((x) => x.id === currentUserId) ?? USERS[0];
  return { ...u, role: USER_ROLE_OVERRIDE[u.id] ?? "read_only" };
}

let cached = snapshot();

export function setCurrentUser(id: string) {
  if (id === currentUserId) return;
  currentUserId = id;
  cached = snapshot();
  notify();
}

export function useCurrentUser(): CurrentUser {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cached,
    () => cached,
  );
}

// Convenience hook — "can the current user do X?"
export function useCan(action: Action, entity: Entity): boolean {
  const user = useCurrentUser();
  return can(user.role, action, entity);
}
