import { AuditLogView } from "@/components/settings/audit-log-view";

export const metadata = { title: "Audit Log — Marina Stee Settings" };

/*
 * Settings → Audit Log Explorer.
 *
 * Operator-facing surface for the tenant-scoped, append-only record of
 * every mutation that touched the marina's data. The page is just the
 * frame; the explorer (header + filter sidebar + virtualized list +
 * drawer) lives in components/settings/audit-log-view.tsx so the
 * settings shell can drop the same component in elsewhere if needed.
 *
 * Header note: the settings shell (app/settings/layout.tsx) already
 * renders the section H2 "Audit Log" + description from NAV_ITEMS, so
 * this page intentionally does NOT add its own header. Without this
 * dedup, marina owners saw "Settings → Audit Log → Audit log" stacked
 * three deep and assumed the page was broken.
 */
export default function AuditLogPage() {
  return <AuditLogView />;
}
