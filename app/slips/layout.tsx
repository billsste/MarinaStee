import { RentalsSubNav } from "@/components/rentals/rentals-sub-nav";

export default function RentalsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-5 pt-6 pb-32">
      <header className="mb-4">
        <h1 className="display-tight text-[26px] font-semibold text-fg">Slips</h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Slips, jet skis, buoys, dry storage — plus rates, fees, gas, meters, and contracts.
        </p>
      </header>
      <RentalsSubNav />
      <div className="pt-5">{children}</div>
    </div>
  );
}
