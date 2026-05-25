"use client";

import * as React from "react";
import { CreateSheet, Field, Select, TextInput, Textarea } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { BOATERS } from "@/lib/mock-data";
import { addCommunication, useBoaters } from "@/lib/client-store";
import type { Communication } from "@/lib/types";

/*
 * Boater-to-marina message form. Writes an INBOUND communication directly
 * to the store (not through the agent send_message action, which is
 * outbound-only). This makes the message show up on the admin Inbox as
 * needing triage.
 */
export function PortalMessageMarinaSheet({
  open,
  onOpenChange,
  boaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  boaterId: string;
}) {
  const liveBoaters = useBoaters();
  const boater = (liveBoaters.length > 0 ? liveBoaters : BOATERS).find((b) => b.id === boaterId);

  const [channel, setChannel] = React.useState<"email" | "sms">(
    boater?.communication_prefs.preferred_channel === "sms" ? "sms" : "email"
  );
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setSubject("");
      setBody("");
      setChannel(boater?.communication_prefs.preferred_channel === "sms" ? "sms" : "email");
    }
  }, [open, boater]);

  const canSubmit = body.trim().length > 0;

  function submit() {
    if (!canSubmit || !boater) return;
    const comm: Communication = {
      id: `cm_portal_${Date.now()}`,
      boater_id: boaterId,
      type: channel,
      direction: "inbound",
      subject: channel === "email" ? subject.trim() || "Portal message" : undefined,
      body_preview: body.trim(),
      sender_label: boater.display_name,
      sender_is_system: false,
      recipient: "marina@marinastee.com",
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    addCommunication(comm);
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Message the marina"
      description="We see your message on the operator inbox and reply usually within the hour."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Channel">
          <Select value={channel} onChange={(v) => setChannel(v as typeof channel)}>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </Select>
        </Field>

        {channel === "email" && (
          <Field label="Subject">
            <TextInput
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Slip question, billing, scheduling…"
            />
          </Field>
        )}

        <Field label="Message" required>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your message…"
            rows={5}
          />
        </Field>
      </div>
    </CreateSheet>
  );
}
