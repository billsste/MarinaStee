"use client";

import * as React from "react";
import { Megaphone, Send, Users } from "lucide-react";
import {
  CreateSheet,
  Field,
  Select,
  TextInput,
  Textarea,
} from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BOATERS, RENTAL_GROUPS, RENTAL_SPACES } from "@/lib/mock-data";
import {
  addCommunication,
  useBoaters,
  useStore,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { Boater, Communication } from "@/lib/types";

/*
 * Broadcast — pick an audience, write one message, fan it out.
 *
 * Audience filters AND together. Each filter is a single-select dropdown
 * for keep-it-simple. "All boaters" is the default.
 *
 * Mail-merge tokens:
 *   {{first_name}}  — recipient's first name
 *   {{last_name}}   — recipient's last name
 *   {{display_name}} — recipient's display name
 *   {{slip}}        — current slip if any, else blank
 *
 * On send: writes one outbound Communication per recipient, batched by
 * timestamp (each gets ts + i ms so they sort deterministically).
 */

type CadenceFilter = "all" | "annual" | "seasonal" | "monthly" | "transient";
type DockFilter = string; // dock name OR "all"
type StatusFilter = "all" | "current" | "overdue";

export function BroadcastSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;
  const { ledger, reservations } = useStore();

  // Docks are RentalGroup names — RentalSpace just has group_id.
  const docks = RENTAL_GROUPS.map((g) => g.name).sort();
  const groupIdByDock = new Map(RENTAL_GROUPS.map((g) => [g.name, g.id]));

  const [channel, setChannel] = React.useState<"email" | "sms">("email");
  const [cadence, setCadence] = React.useState<CadenceFilter>("all");
  const [dock, setDock] = React.useState<DockFilter>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setChannel("email");
      setCadence("all");
      setDock("all");
      setStatus("all");
      setSubject("");
      setBody("");
      setSending(false);
    }
  }, [open]);

  // Compute audience live as filters change
  const audience = React.useMemo(() => {
    return boaters.filter((b) => {
      if (cadence !== "all" && b.billing_cadence !== cadence) return false;
      if (dock !== "all") {
        const myRes = reservations.find(
          (r) => r.boater_id === b.id && (r.status === "occupied" || r.status === "scheduled")
        );
        if (!myRes) return false;
        const sp = RENTAL_SPACES.find((s) => s.id === myRes.slip_id);
        const wantGroup = groupIdByDock.get(dock);
        if (!sp || sp.group_id !== wantGroup) return false;
      }
      if (status === "overdue") {
        const open = ledger
          .filter((l) => l.boater_id === b.id && l.type === "invoice")
          .reduce((s, i) => s + i.open_balance, 0);
        if (open <= 0) return false;
      }
      if (status === "current") {
        const open = ledger
          .filter((l) => l.boater_id === b.id && l.type === "invoice")
          .reduce((s, i) => s + i.open_balance, 0);
        if (open > 0) return false;
      }
      // Channel feasibility — must have the contact method
      if (channel === "email" && !b.primary_contact.email) return false;
      if (channel === "sms" && !b.primary_contact.phone) return false;
      return true;
    });
  }, [boaters, cadence, dock, status, channel, ledger, reservations]);

  // SMS character estimate (after mail-merge tokens get filled with sample values)
  const sampleRendered = renderTemplate(body, audience[0] ?? boaters[0]);
  const smsSegments = Math.max(1, Math.ceil(sampleRendered.length / 160));

  const canSubmit = body.trim().length > 0 && audience.length > 0 && !sending;

  function submit() {
    if (!canSubmit) return;
    setSending(true);
    const base = Date.now();
    audience.forEach((b, i) => {
      const rendered = renderTemplate(body.trim(), b);
      const subj = channel === "email" ? renderTemplate(subject.trim(), b) || "Marina Stee" : undefined;
      const comm: Communication = {
        id: `cm_bcast_${base}_${i}`,
        boater_id: b.id,
        type: channel,
        direction: "outbound",
        subject: subj,
        body_preview: rendered,
        sender_label: "Sync, Service",
        sender_is_system: true,
        recipient: channel === "email" ? (b.primary_contact.email ?? "—") : (b.primary_contact.phone ?? "—"),
        sent_at: new Date(base + i).toISOString(),
        status: "delivered",
      };
      addCommunication(comm);
    });
    // brief processing feedback then close
    setTimeout(() => {
      onOpenChange(false);
    }, 500);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Broadcast message"
      description="Send one message to many boaters. Pick the audience, write once, fan out."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            <Send className="size-3.5" />
            {sending ? "Sending…" : `Send to ${audience.length}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Audience */}
        <div className="rounded-[12px] border border-hairline bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-fg-tertiary">
              <Users className="size-3.5" />
              Audience
            </span>
            <Badge tone={audience.length > 0 ? "primary" : "warn"} size="sm">
              {audience.length} recipient{audience.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Field label="Cadence">
              <Select value={cadence} onChange={(v) => setCadence(v as CadenceFilter)}>
                <option value="all">All cadences</option>
                <option value="annual">Annual</option>
                <option value="seasonal">Seasonal</option>
                <option value="monthly">Monthly</option>
                <option value="transient">Transient</option>
              </Select>
            </Field>
            <Field label="Dock">
              <Select value={dock} onChange={setDock}>
                <option value="all">All docks</option>
                {docks.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Balance">
              <Select value={status} onChange={(v) => setStatus(v as StatusFilter)}>
                <option value="all">Any</option>
                <option value="overdue">Has open balance</option>
                <option value="current">Current</option>
              </Select>
            </Field>
          </div>
          {audience.length === 0 ? (
            <p className="mt-2 text-[11px] text-status-warn">
              No recipients match these filters{channel === "sms" ? " (and have a phone on file)" : ""}.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-fg-tertiary">
              Sending to {audience.slice(0, 5).map((b) => b.first_name).join(", ")}
              {audience.length > 5 ? ` and ${audience.length - 5} more.` : "."}
            </p>
          )}
        </div>

        {/* Channel */}
        <div className="flex rounded-[10px] border border-hairline bg-surface-2 p-1 text-[12px]">
          {(["email", "sms"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={cn(
                "flex-1 rounded-[6px] px-3 py-1.5 font-medium capitalize transition-colors",
                channel === c ? "bg-surface-1 text-fg shadow-sm" : "text-fg-subtle hover:text-fg"
              )}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>

        {channel === "email" && (
          <Field label="Subject">
            <TextInput
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Marina opens for the season May 30th"
            />
          </Field>
        )}

        <Field
          label="Message"
          required
          hint={
            channel === "sms"
              ? `Approx ${smsSegments} SMS segment${smsSegments === 1 ? "" : "s"} per recipient (${sampleRendered.length} chars rendered).`
              : "Tokens: {{first_name}}, {{last_name}}, {{display_name}}, {{slip}}"
          }
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              channel === "sms"
                ? "Hi {{first_name}}, the marina is open for the season — see you soon!"
                : "Hi {{first_name}},\n\nA quick note for everyone in {{slip}}…"
            }
            rows={6}
          />
        </Field>

        {/* Preview */}
        {body && audience.length > 0 && (
          <div className="rounded-[10px] border border-hairline-strong bg-surface-1 p-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-fg-tertiary">
              <Megaphone className="size-3" /> Preview for {audience[0].display_name}
            </div>
            {channel === "email" && subject && (
              <p className="text-[13px] font-medium text-fg">
                {renderTemplate(subject, audience[0])}
              </p>
            )}
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-fg-subtle">
              {sampleRendered}
            </p>
          </div>
        )}
      </div>
    </CreateSheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mail-merge helper

function renderTemplate(template: string, b: Boater | undefined): string {
  if (!template) return "";
  const slip = "—"; // we'd resolve current slip per boater here in a fuller impl
  return template
    .replace(/\{\{\s*first_name\s*\}\}/g, b?.first_name ?? "")
    .replace(/\{\{\s*last_name\s*\}\}/g, b?.last_name ?? "")
    .replace(/\{\{\s*display_name\s*\}\}/g, b?.display_name ?? "")
    .replace(/\{\{\s*slip\s*\}\}/g, slip);
}
