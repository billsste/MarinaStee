"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { loadHolderSession } from "@/lib/holder-session";

/*
 * Tiny client island for the /portal landing page.
 *
 * If a previous holder session lives in localStorage, bounce straight
 * to /portal/{token} on mount — that way installed PWA users tapping
 * the home-screen icon never see the dev picker, they land in their
 * own portal. New / signed-out users see the demo list as usual.
 *
 * Server-rendered HTML is the dev demo picker; this island only kicks
 * in after hydration when a session exists.
 */
export function HolderSessionBounce() {
  const router = useRouter();
  React.useEffect(() => {
    const session = loadHolderSession();
    if (session?.token) {
      router.replace(`/portal/${session.token}`);
    }
  }, [router]);
  return null;
}
