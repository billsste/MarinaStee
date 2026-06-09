"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { BOATERS } from "@/lib/mock-data";

/*
 * Context-aware Back link for the work order detail page.
 *
 * If the user navigated here from a boater page (/members/[id]/...),
 * the back link returns to that boater. Otherwise it falls back to the
 * global kanban (/work-orders). Reads document.referrer once on mount;
 * before that, renders the safe default so SSR + first paint match.
 */
export function WorkOrderBackLink({ fallbackBoaterId }: { fallbackBoaterId?: string }) {
  const [origin, setOrigin] = React.useState<
    | { href: "/work-orders"; label: "All work orders" }
    | { href: string; label: string }
  >({ href: "/work-orders", label: "All work orders" });

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    try {
      const ref = document.referrer;
      if (!ref) return;
      const url = new URL(ref);
      if (url.origin !== window.location.origin) return;
      // Match both /members (new) and /holders (legacy, for old bookmarks
      // / browser history that still has the pre-rename path).
      const m = url.pathname.match(/^\/(?:members|holders)\/([^/]+)/);
      if (m) {
        const boaterId = m[1];
        const boater = BOATERS.find((b) => b.id === boaterId);
        if (boater) {
          setOrigin({
            href: `/members/${boaterId}`,
            label: `Back to ${boater.display_name}`,
          });
          return;
        }
      }
      // Same-origin but not a boater page — keep default.
    } catch {
      // Invalid referrer URL — keep default.
    }
  }, [fallbackBoaterId]);

  return (
    <Link
      href={origin.href}
      className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
    >
      <ChevronLeft className="size-3.5" /> {origin.label}
    </Link>
  );
}
