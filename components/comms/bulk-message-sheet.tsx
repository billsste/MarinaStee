"use client";

import * as React from "react";
import { CreateSheet, Field, Select, TextInput, Textarea } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { executeAgentAction } from "@/lib/agent-actions";
import type { Boater } from "@/lib/types";

/*
 * BulkMessageSheet — operator-side mass-message composer.
 *
 * Chenoa row 22 + Dan row 65 + Chenoa row 36: "Mass emails through
 * marina program", "Mass email capabilities", "If there are multiple
 * charges on an account, I have to individually send that to each of
 * them."
 *
 * Usage: pass a pre-resolved list of recipient Boaters (e.g. the
 * currently-filtered Members list). The sheet shows the count + a
 * sample of recipients up top, picks email/sms, composes the body
 * with {{first_name}} merge token support, and dispatches via the
 * bulk_send_message agent action — same path the agent itself uses
 * for "remind everyone overdue".
 */
export function BulkMessageSheet({
  open,
  onOpenChange,
  recipients,
  filterSummary,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipients: Boater[];
  /** Operator-readable description of who's on the list: "All active members · 47" */
  filterSummary: string;
}) {
  const [channel, setChannel] = React.useState<"email" | "sms">("email");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setChannel("email");
      setSubject("");
      setBody("");
    }
  }, [open]);

  // Recipients without the chosen channel populated get filtered out
  // so the operator sees an accurate "will reach" count. Mirrors how
  // the agent's bulk_send_message resolver handles missing contacts.
  const reachable = React.useMemo(
    () =>
      recipients.filter((b) =>
        channel === "email"
          ? !!b.primary_contact.email
          : !!b.primary_contact.phone
      ),
    [recipients, channel]
  );

  const canSubmit = reachable.length > 0 && body.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    executeAgentAction({
      kind: "bulk_send_message",
      label: `Mass ${channel} to ${reachable.length} ${reachable.length === 1 ? "member" : "members"}`,
      target_boater_ids: reachable.map((b) => b.id),
      filter_summary: filterSummary,
      channel,
      subject: channel === "email" ? subject.trim() || undefined : undefined,
      body: body.trim(),
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Mass message"
      description={`${filterSummary} — confirm copy before queueing the agent action.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            disabled={!canSubmit}
          >
            Queue {channel === "email" ? "email" : "SMS"} ({reachable.length})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Recipient summary — count + a preview chip cluster */}
        <div className="rounded-[10px] border border-hairline bg-surface-2 p-3">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
            Recipients
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-[16px] font-medium text-fg tabular">
              {reachable.length}
            </span>
            <span className="text-[12px] text-fg-subtle">
              reachable via {channel}
            </span>
            {recipients.length !== reachable.length && (
              <Badge tone="warn" size="sm">
                {recipients.length - reachable.length} missing {channel}
              </Badge>
            )}
          </div>
          {reachable.length > 0 && (
            <p className="mt-1.5 text-[11px] text-fg-tertiary">
              {reachable
                .slice(0, 5)
                .map((b) => b.display_name)
                .join(", ")}
              {reachable.length > 5 ? ` + ${reachable.length - 5} more` : ""}
            </p>
          )}
        </div>

        <Field label="Channel">
          <Select
            value={channel}
            onChange={(v) => setChannel(v as "email" | "sms")}
          >
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </Select>
        </Field>

        {channel === "email" && (
          <Field label="Subject">
            <TextInput
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Dock closure Friday, May 15"
            />
          </Field>
        )}

        <Field
          label="Message"
          hint="Use {{first_name}} to personalize. The agent renders it per recipient before sending."
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder={`Hi {{first_name}},\n\nJust a heads-up that the fuel dock will be closed Friday for maintenance. Back in service Saturday morning.\n\n— Marina Stee`}
          />
        </Field>
      </div>
    </CreateSheet>
  );
}
