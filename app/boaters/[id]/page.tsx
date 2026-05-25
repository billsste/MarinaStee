import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { BoaterIdentityBar } from "@/components/boaters/boater-identity-bar";
import { BoaterDetail } from "@/components/boaters/boater-detail";
import { BoaterAsk } from "@/components/boaters/boater-ask";
import {
  getBoater,
  getCardsForBoater,
  getCommunicationsForBoater,
  getContractsForBoater,
  getCurrentReservation,
  getLedgerForBoater,
  getOpenBalance,
  getReservationsForBoater,
  getVesselsForBoater,
  getWorkOrdersForBoater,
} from "@/lib/mock-data";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const b = getBoater(id);
  return { title: b ? `${b.display_name} — Marina Stee` : "Boater — Marina Stee" };
}

export default async function BoaterDetailPage({ params }: Props) {
  const { id } = await params;
  const boater = getBoater(id);
  if (!boater) notFound();

  const vessels = getVesselsForBoater(boater.id);
  const reservations = getReservationsForBoater(boater.id);
  const ledger = getLedgerForBoater(boater.id);
  const workOrders = getWorkOrdersForBoater(boater.id);
  const comms = getCommunicationsForBoater(boater.id);
  const contracts = getContractsForBoater(boater.id);
  const cards = getCardsForBoater(boater.id);
  const openBalance = getOpenBalance(boater.id);
  const currentReservation = getCurrentReservation(boater.id);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pt-6 pb-12">
      <Link
        href="/boaters"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
      >
        <ChevronLeft className="size-3.5" /> All boaters
      </Link>

      <BoaterIdentityBar
        boater={boater}
        currentReservation={currentReservation}
      />

      <div className="mt-4">
        <BoaterAsk boater={boater} />
      </div>

      <div className="mt-4">
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
