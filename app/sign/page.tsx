import Link from "next/link";
import { FileText } from "lucide-react";
import { QUOTES, BOATERS } from "@/lib/mock-data";

export const metadata = { title: "Quote signing — Marina Stee" };

export default function SignIndexPage() {
  const tokenized = QUOTES.filter((q) => q.signature_token);
  return (
    <div className="mx-auto w-full max-w-[480px] px-5 py-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-fg">
        Marina Stee — Quote signing
      </h1>
      <p className="mt-1 text-[13px] text-fg-subtle">
        Open a tokenized quote URL to review and sign. Demo links:
      </p>
      <ul className="mt-4 space-y-2">
        {tokenized.map((q) => {
          const b = BOATERS.find((x) => x.id === q.boater_id);
          return (
            <li key={q.id}>
              <Link
                href={`/sign/${q.signature_token}`}
                className="flex items-start gap-3 rounded-[10px] border border-hairline bg-surface-1 p-3 transition-colors hover:border-hairline-strong"
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg">
                    {q.number} {q.signed_at ? "· signed" : "· awaiting signature"}
                  </div>
                  <div className="truncate text-[11px] text-fg-tertiary">
                    {b?.display_name ?? "—"} · {q.signature_token}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
