import { InsuranceView } from "@/components/insurance/insurance-view";

export const metadata = { title: "Insurance / COIs — Marina Stee" };

export default function InsurancePage() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-5 pt-6 pb-32">
      <header className="mb-4">
        <h1 className="display-tight text-[26px] font-semibold text-fg">Insurance / COIs</h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Certificates of Insurance for every holder. Lapsed coverage is a
          liability — chase renewals before policies expire.
        </p>
      </header>
      <InsuranceView />
    </div>
  );
}
