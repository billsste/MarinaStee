"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, UserRound } from "lucide-react";
import { useCurrentUser, setCurrentUser, ROLE_META, type Role } from "@/lib/auth";
import { USERS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/*
 * Topbar "Acting as" pill. Demo-mode role switcher — click to pop a list
 * of mock users, pick one, role updates everywhere (sidebar visibility,
 * Edit/Delete button gating, agent tool authorization).
 *
 * Production swap: replaces with the logged-in user's badge + actual
 * profile menu. Role comes from the session not a manual selector.
 */

const ROLE_TONE: Record<Role, string> = {
  super_admin: "bg-status-danger/10 text-status-danger border-status-danger/30",
  manager: "bg-primary/15 text-primary border-primary/30",
  accounting: "bg-status-info/15 text-status-info border-status-info/30",
  dockhand: "bg-status-warn/15 text-status-warn border-status-warn/30",
  read_only: "bg-surface-3 text-fg-subtle border-hairline",
};

// Map our user id → which Role they get for demo purposes. (Kept in lib/auth
// USER_ROLE_OVERRIDE; we just expose it visually here.)
const USER_ROLE_DISPLAY: Record<string, Role> = {
  u_steven: "manager",
  u_tiffany: "accounting",
  u_will: "dockhand",
  u_jreyes: "dockhand",
  u_system: "super_admin",
};

export function CurrentUserSwitcher() {
  const user = useCurrentUser();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-1 py-1 pl-1 pr-2.5 text-[12px] transition-colors hover:bg-surface-2"
          aria-label="Acting as"
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-surface-3 text-fg-subtle">
            <UserRound className="size-3" />
          </span>
          <span className="text-fg">{user.name}</span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-px text-[10px] font-medium capitalize",
              ROLE_TONE[user.role]
            )}
          >
            {ROLE_META[user.role].label}
          </span>
          <ChevronDown className="size-3 text-fg-tertiary" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[240px] overflow-hidden rounded-[10px] border border-hairline bg-surface-1 shadow-lg"
        >
          <div className="border-b border-hairline px-3 py-2 text-[11px] uppercase tracking-wide text-fg-tertiary">
            Acting as
          </div>
          {USERS.map((u) => {
            const role = USER_ROLE_DISPLAY[u.id] ?? "read_only";
            const isMe = u.id === user.id;
            return (
              <DropdownMenu.Item
                key={u.id}
                onSelect={() => setCurrentUser(u.id)}
                className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[12px] outline-none hover:bg-surface-2 data-[highlighted]:bg-surface-2"
              >
                <div>
                  <div className="text-fg">{u.name}</div>
                  <div className="text-[11px] text-fg-tertiary">
                    {ROLE_META[role].label} · {ROLE_META[role].blurb}
                  </div>
                </div>
                {isMe && <Check className="size-3.5 text-primary" />}
              </DropdownMenu.Item>
            );
          })}
          <div className="border-t border-hairline px-3 py-1.5 text-[10px] text-fg-tertiary">
            Demo: try editing rates as Dockhand
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
