import { PageShell } from "@/components/page-shell";
import { BoaterList } from "@/components/boaters/boater-list";
import {
  BOATERS,
  getCurrentReservation,
  getOpenBalance,
} from "@/lib/mock-data";

export const metadata = { title: "Boaters — Marina Stee" };

export default function BoatersPage() {
  const rows = BOATERS.map((boater) => ({
    boater,
    currentReservation: getCurrentReservation(boater.id),
    openBalance: getOpenBalance(boater.id),
  }));

  return (
    <PageShell
      title="Boaters"
      description="Slip holders, transients, and house-charge accounts. Ask the agent or click in."
    >
      <BoaterList rows={rows} />
    </PageShell>
  );
}
