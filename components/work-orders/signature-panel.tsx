"use client";

import { Send, CheckCheck, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Quote } from "@/lib/types";

export function SignaturePanel({ quote }: { quote: Quote }) {
  if (quote.signed_at) {
    return (
      <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/[0.04] p-4">
        <div className="mb-2 flex items-center gap-2">
          <CheckCheck className="size-4 text-status-ok" />
          <h3 className="text-[13px] font-medium text-fg">Signed</h3>
          <Badge tone="ok" size="sm">Authorized</Badge>
        </div>
        <div className="space-y-1 text-[12px] text-fg-subtle">
          <div>
            <span className="text-fg-tertiary">Signer:</span>{" "}
            <span className="font-medium text-fg">{quote.signer_name ?? "—"}</span>
          </div>
          <div>
            <span className="text-fg-tertiary">Signed:</span>{" "}
            <span className="text-fg">{new Date(quote.signed_at).toLocaleString()}</span>
          </div>
          {quote.signature_token && (
            <div>
              <span className="text-fg-tertiary">Audit token:</span>{" "}
              <span className="font-mono text-[11px] text-fg">{quote.signature_token}</span>
            </div>
          )}
        </div>
        {quote.signature_data_url ? (
          <div className="mt-3 rounded-[8px] border border-hairline bg-surface-1 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={quote.signature_data_url} alt="Signature" className="max-h-24 object-contain" />
          </div>
        ) : (
          <div className="mt-3 rounded-[8px] border border-dashed border-hairline bg-surface-1 px-3 py-4 text-center text-[11px] italic text-fg-tertiary">
            Signature image stored at /signatures/{quote.signature_token}.png
          </div>
        )}
      </div>
    );
  }

  if (quote.status === "sent" || quote.status === "viewed") {
    return (
      <div className="rounded-[12px] border border-status-info/30 bg-status-info/[0.05] p-4">
        <div className="mb-2 flex items-center gap-2">
          <Send className="size-4 text-status-info" />
          <h3 className="text-[13px] font-medium text-fg">Sent for signature</h3>
          <Badge tone="info" size="sm">{quote.status}</Badge>
        </div>
        <div className="space-y-1 text-[12px] text-fg-subtle">
          {quote.sent_at && <div>Sent {new Date(quote.sent_at).toLocaleString()}</div>}
          {quote.viewed_at && <div>Viewed {new Date(quote.viewed_at).toLocaleString()}</div>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="sm">Resend</Button>
          <Button variant="ghost" size="sm">
            <ExternalLink className="size-3.5" />
            Open signer URL
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-4 text-center">
      <h3 className="text-[13px] font-medium text-fg">Awaiting signature</h3>
      <p className="mt-1 text-[12px] text-fg-subtle">
        Send this quote to the boater to authorize the work and charges.
      </p>
      <Button variant="primary" size="sm" className="mt-3">
        <Send className="size-3.5" />
        Send for signature
      </Button>
    </div>
  );
}
