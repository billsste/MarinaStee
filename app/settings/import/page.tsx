import { PageShell } from "@/components/page-shell";
import { CsvImportView } from "@/components/settings/csv-import-view";

export const metadata = { title: "CSV Import — Marina Stee Settings" };

export default function ImportPage() {
  return (
    <PageShell
      title="Data Import"
      description="Bulk-import slips, boaters, and vessels from CSV files. Use this once at onboarding or any time you onboard a new dock / acquire a new property."
    >
      <CsvImportView />
    </PageShell>
  );
}
