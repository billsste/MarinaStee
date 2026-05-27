"use client";

import * as React from "react";
import { CreateSheet, Field, Select, TextInput, Textarea } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { BOATERS } from "@/lib/mock-data";
import { useBoaters } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import { formatPhone } from "@/lib/utils";

export function NewMessageSheet({
  open,
  onOpenChange,
  defaultBoaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;
  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  const [channel, setChannel] = React.useState<"email" | "sms">("email");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setBoaterId(defaultBoaterId ?? "");
      setSubject("");
      setBody("");
      // Default channel to the boater's preference if known
      const b = boaters.find((x) => x.id === (defaultBoaterId ?? ""));
      const pref = b?.communication_prefs.preferred_channel;
      setChannel(pref === "sms" ? "sms" : "email");
    }
  }, [open, defaultBoaterId, boaters]);

  const boater = boaters.find((b) => b.id === boaterId);
  const recipient =
    boater && (channel === "email"
      ? boater.primary_contact.email ?? "—"
      : formatPhone(boater.primary_contact.phone) || "—");

  const canSubmit = boaterId.length > 0 && body.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    executeAgentAction({
      kind: "send_message",
      label: "",
      boater_id: boaterId,
      type: channel,
      subject: subject.trim() || undefined,
      body: body.trim(),
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New message"
      description="Send an SMS or email to the holder. The agent will append it to the timeline and the inbox."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Send message
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Holder" required>
          <Combobox
            value={boaterId}
            onChange={setBoaterId}
            options={boaters.map((b) => ({
              value: b.id,
              label: b.display_name,
              hint: b.code ? `· ${b.code}` : undefined,
            }))}
            placeholder="Pick a holder…"
            searchPlaceholder="Search by name, code…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Channel">
            <Select value={channel} onChange={(v) => setChannel(v as typeof channel)}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </Select>
          </Field>
          <Field label="Recipient" hint={recipient ? `Will send to ${recipient}` : undefined}>
            <TextInput value={recipient ?? ""} readOnly placeholder="Pick a boater first" />
          </Field>
        </div>

        {channel === "email" && (
          <Field label="Subject">
            <TextInput
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Slip assignment confirmed"
            />
          </Field>
        )}

        <Field label="Message" required>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              channel === "sms"
                ? "Keep it short — SMS works best in 1-2 sentences."
                : "What do you need them to know?"
            }
            rows={5}
          />
        </Field>
      </div>
    </CreateSheet>
  );
}
