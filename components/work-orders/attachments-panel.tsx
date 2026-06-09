import { Paperclip } from "lucide-react";
import type { WorkOrder } from "@/lib/types";

// Read-only attachments list. The wizard captures file names into
// attachment_ids today (the upload pipeline is shared with Contract
// attachments and lands in Phase 4 alongside Convex file storage).
// Until the real pipeline ships, names render as plain rows — clicks
// don't open anything yet.

export function AttachmentsPanel({ wo }: { wo: WorkOrder }) {
  const ids = wo.attachment_ids ?? [];
  if (ids.length === 0) return null;

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          <Paperclip className="size-3.5" />
          Attachments
        </div>
        <div className="tabular text-[11px] text-fg-muted">
          {ids.length}
        </div>
      </div>
      <ul className="divide-y divide-hairline">
        {ids.map((id) => (
          <li
            key={id}
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-fg"
          >
            <Paperclip className="size-3.5 shrink-0 text-fg-tertiary" />
            <span className="truncate" title={id}>
              {id}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
