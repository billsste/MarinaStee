"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { BoaterIdentityBar } from "@/components/boaters/boater-identity-bar";
import { BoaterDetail } from "@/components/boaters/boater-detail";
import { BoaterAsk } from "@/components/boaters/boater-ask";
import {
  useBoaters,
  useCardsForBoater,
  useCommunicationsForBoater,
  useContractsForBoater,
  useLedgerForBoater,
  useVesselsForBoater,
  useWorkOrdersForBoater,
} from "@/lib/client-store";
import {
  getCurrentReservation,
  getReservationsForBoater,
  getOpenBalance,
} from "@/lib/mock-data";

/*
 * Client-side holder detail. The page wraps this so newly-created
 * holders (id like `b_runtime_…`) resolve against the in-memory store
 * instead of 404ing on the seed-only `getBoater` lookup. Reservations,
 * open-balance, and "current reservation" still read from the seed
 * helpers — those are derived and don't have a store-backed equivalent
 * yet. Will move them when the real backend lands.
 */
export function HolderDetailClient({ id }: { id: string }) {
  const boaters = useBoaters();
  const boater = boaters.find((b) => b.id === id);

  // Hooks must run unconditionally, so call them with the id even if
  // the boater isn't resolved yet. They'll return empty arrays in that
  // case, which is fine for the early-return branch below.
  const vessels = useVesselsForBoater(id);
  const ledger = useLedgerForBoater(id);
  const workOrders = useWorkOrdersForBoater(id);
  const comms = useCommunicationsForBoater(id);
  const contracts = useContractsForBoater(id);
  const cards = useCardsForBoater(id);

  if (!boater) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-5 pt-6 pb-12">
        <Link
          href="/members"
          className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
        >
          <ChevronLeft className="size-3.5" /> Members
        </Link>
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-8 text-center">
          <div className="text-[14px] font-medium text-fg">Member not found</div>
          <p className="mt-1 text-[12px] text-fg-subtle">
            We couldn&apos;t find a member with id <code>{id}</code>. It may have
            been removed.
          </p>
        </div>
      </div>
    );
  }

  // Seed-only derivations — safe to call now that we have a real boater.
  const reservations = getReservationsForBoater(boater.id);
  const openBalance = getOpenBalance(boater.id);
  const currentReservation = getCurrentReservation(boater.id);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pt-6 pb-12">
      <Link
        href="/members"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
      >
        <ChevronLeft className="size-3.5" /> Members
      </Link>

      <BoaterIdentityBar
        boater={boater}
        currentReservation={currentReservation}
      />

      {/* Agent ask sits a canonical 20px below the identity bar and
          20px above the detail tabs, matching the agent → next gap
          used on every other top-level page. */}
      <div className="mt-5">
        <BoaterAsk boater={boater} />
      </div>

      <div className="mt-5">
        <BoaterDetail
          boater={boater}
          vessels={vessels}
          reservations={reservations}
          ledger={ledger}
          workOrders={workOrders}
          comms={comms}
          contracts={contracts}
          cards={cards}
          openBalance={openBalance}
        />
      </div>
    </div>
  );
}
