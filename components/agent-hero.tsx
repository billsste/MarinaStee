"use client";

import * as React from "react";
import { RentalsAsk } from "@/components/rentals/rentals-ask";

/*
 * Dashboard agent hero — uses the same compact RentalsAsk surface as
 * the other pages (ledger, inbox, members, etc.) so the agent UI is
 * uniform across the app. Idle state: slim input with a sparkle icon,
 * placeholder, and suggestion chips below. Once submitted, transitions
 * into the streaming AgentChat conversation view inside the same card.
 */
export function AgentHero() {
  return (
    <section className="mx-auto w-full max-w-[1240px] px-6 pt-8 pb-4">
      <RentalsAsk
        placeholder="Ask Marina Stee — e.g. 'who's past due?' or 'pay the Pinon Petroleum bill'"
        suggestions={[
          "Who's up for renewal in the next 90 days?",
          "Show me past-due accounts",
          "Send the pickup link for BR-1002",
          "Pay the Pinon Petroleum bill",
        ]}
      />
    </section>
  );
}
