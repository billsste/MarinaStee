"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Inbox, Sailboat, Users } from "lucide-react";
import { BoaterList } from "@/components/boaters/boater-list";
import { ApplicationsSection } from "@/components/members/applications-section";
import { RentalClubView } from "@/components/members/rental-club-view";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { cn } from "@/lib/utils";

/*
 * Client wrapper for /members. Top-level left rail switches between:
 *
 *   - All members  — the full directory (BoaterList). Default.
 *   - Rental Club  — subscription roster + booking calendar.
 *
 * Same shell pattern as /settings, /services, /ledger — sticky rail at md+,
 * single content column on mobile. Initial section comes from `?tab=club`
 * when set, otherwise defaults to "all" — dashboard Quick Actions and the
 * club catalog member-count link both use this for deep-linking.
 */

type SectionKey = "all" | "club" | "applications";

// Context-aware agent prompts. The agent sits at the layout level
// (matching /services) so it persists across the Slip Holders ↔
// Rental Club sub-nav switch and produces an identical structural
// gap above the sub-view's toolbar on both surfaces.
const AGENT_PROMPTS: Record<
  SectionKey,
  { placeholder: string; suggestions: string[] }
> = {
  all: {
    placeholder:
      "Ask the agent — e.g. 'who's past due?' or 'add Sarah Reyes, monthly, slip B-12, 1989 Sea Ray 28ft'",
    suggestions: [
      "Who's past due?",
      "Add Sarah Reyes, monthly, slip B-12",
      "Which contracts expire in 60 days?",
      "Send a renewal reminder to annual holders",
    ],
  },
  club: {
    placeholder:
      "Ask about the club — e.g. 'add Jones to plus plan' or 'who's past due?'",
    suggestions: [
      "Add Jones to the plus plan",
      "Who's past due in the club?",
      "Book Morales for Saturday",
      "Bump Singh to premium",
    ],
  },
  applications: {
    placeholder:
      "Ask the agent — e.g. 'approve APP-1002' or 'decline Pratt — beam too wide'",
    suggestions: [
      "Approve APP-1002",
      "Decline Pratt — beam exceeds covered max",
      "Route Renfrew to the waitlist",
      "Who's been pending longest?",
    ],
  },
};

const NAV_ITEMS: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    key: "all",
    label: "Slip Holders",
    icon: Users,
    description:
      "Annual, seasonal, monthly, and transient slip members. Rental Club lives in its own section.",
  },
  {
    key: "club",
    label: "Rental Club",
    icon: Sailboat,
    description:
      "Subscription members + booked days against the rental fleet.",
  },
  {
    key: "applications",
    label: "Applications",
    icon: Inbox,
    description:
      "Prospective boaters who applied via /apply. Review, approve, decline, or route to the waitlist.",
  },
];

export function MembersClient() {
  const searchParams = useSearchParams();
  // Deep-link support — `?tab=club` lands directly on the Rental Club
  // section. Anything else falls back to "all".
  const tab = searchParams?.get("tab");
  const initial: SectionKey =
    tab === "club"
      ? "club"
      : tab === "applications"
        ? "applications"
        : "all";
  const [section, setSection] = React.useState<SectionKey>(initial);
  const active = NAV_ITEMS.find((n) => n.key === section) ?? NAV_ITEMS[0];

  return (
    // No section h1 — the AppShell breadcrumb ("Marina Stee / Members")
    // identifies the page and the left rail tells you which sub-area
    // you're in. See CLAUDE.md §"List-page UX consistency" rule #10.
    <div className="mx-auto w-full max-w-[1400px] px-5 pt-4 pb-32">
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: "200px minmax(0, 1fr)" }}
      >
        {/* Left rail */}
        <nav
          aria-label="Member sections"
          className="space-y-0.5 md:sticky md:top-20 md:self-start"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors",
                  isActive
                    ? "bg-surface-3 font-medium text-fg"
                    : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Content. Wrapper mirrors /services/layout.tsx exactly —
            `space-y-5` between agent and sub-view so the gap above
            the sub-view's toolbar matches Services to the pixel. */}
        <div className="min-w-0 space-y-5">
          <RentalsAsk
            placeholder={AGENT_PROMPTS[section].placeholder}
            suggestions={AGENT_PROMPTS[section].suggestions}
          />
          {section === "all" && <BoaterList />}
          {section === "club" && <RentalClubView />}
          {section === "applications" && <ApplicationsSection />}
        </div>
      </div>
    </div>
  );
}
