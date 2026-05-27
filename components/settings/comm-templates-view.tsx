"use client";

import * as React from "react";
import { Mail, MessageCircle, Phone, Power, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  updateCommTemplate,
  useCommTemplates,
} from "@/lib/client-store";
import type { CommTemplate } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Settings → Comm Templates editor. Each system-generated comm (receipt,
 * contract sent, COI reminder, etc.) reads its copy from a CommTemplate.
 * Operators can edit subject + body, swap channel (email ↔ SMS), toggle
 * active. Inactive templates fall back to hard-coded copy in the
 * dispatcher — safety net so a deleted template never breaks a chain.
 *
 * Editor is a master-detail layout: list on left, full editor on right
 * for the selected template. Save commits to the store immediately.
 */

function channelIcon(c: CommTemplate["channel"]) {
  if (c === "email") return <Mail className="size-3.5" />;
  if (c === "sms") return <MessageCircle className="size-3.5" />;
  return <Phone className="size-3.5" />;
}

export function CommTemplatesView() {
  const templates = useCommTemplates();
  const [selectedId, setSelectedId] = React.useState<string | undefined>(
    templates[0]?.id
  );
  const selected = templates.find((t) => t.id === selectedId);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      {/* List */}
      <aside className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <header className="border-b border-hairline px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          System comms ({templates.length})
        </header>
        <ul className="divide-y divide-hairline">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors",
                  t.id === selectedId
                    ? "bg-primary-soft/40"
                    : "hover:bg-surface-2"
                )}
              >
                <span className="mt-0.5 text-fg-tertiary">{channelIcon(t.channel)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-fg">
                      {t.name}
                    </span>
                    {!t.active && <Badge tone="warn" size="sm">Off</Badge>}
                  </div>
                  {t.description && (
                    <p className="line-clamp-1 text-[11px] text-fg-tertiary">
                      {t.description}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Detail */}
      <div>
        {selected ? (
          <TemplateEditor template={selected} key={selected.id} />
        ) : (
          <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-10 text-center text-[13px] text-fg-subtle">
            Pick a template to edit.
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateEditor({ template }: { template: CommTemplate }) {
  const [name, setName] = React.useState(template.name);
  const [description, setDescription] = React.useState(template.description ?? "");
  const [channel, setChannel] = React.useState<CommTemplate["channel"]>(template.channel);
  const [subject, setSubject] = React.useState(template.subject);
  const [body, setBody] = React.useState(template.body_markdown);
  const [active, setActive] = React.useState(template.active);
  const [savedFlash, setSavedFlash] = React.useState(false);

  const dirty =
    name !== template.name ||
    description !== (template.description ?? "") ||
    channel !== template.channel ||
    subject !== template.subject ||
    body !== template.body_markdown ||
    active !== template.active;

  function save() {
    updateCommTemplate(template.id, {
      name,
      description,
      channel,
      subject,
      body_markdown: body,
      active,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div>
          <h2 className="text-[14px] font-medium text-fg">{template.name}</h2>
          <p className="text-[11px] text-fg-tertiary">
            Kind:{" "}
            <span className="font-mono">{template.kind}</span>
            {" · "}
            {template.available_tokens.length} merge tokens available
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActive(!active)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              active
                ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                : "border-hairline bg-surface-2 text-fg-tertiary"
            )}
          >
            <Power className="size-3" />
            {active ? "Active" : "Off"}
          </button>
          <Button variant="primary" size="sm" onClick={save} disabled={!dirty}>
            <Save className="size-3.5" />
            {savedFlash ? "Saved" : "Save"}
          </Button>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <FieldGroup>
          <Field label="Template name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
            />
          </Field>
          <Field label="Channel">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as CommTemplate["channel"])}
              className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="voice">Voice / IVR</option>
            </select>
          </Field>
        </FieldGroup>

        <Field label="When this sends">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
            placeholder="Plain English description of what triggers this comm."
          />
        </Field>

        {channel === "email" && (
          <Field label="Subject line">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
              placeholder="Marina Stee receipt"
            />
          </Field>
        )}

        <Field label={channel === "sms" ? "SMS body" : "Email body"}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={channel === "sms" ? 5 : 12}
            className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 font-mono text-[12px] leading-5 text-fg focus:border-hairline-strong focus:outline-none"
            placeholder="Hi {{boater.first_name}}, …"
          />
        </Field>

        <div className="rounded-[10px] border border-hairline bg-surface-2 p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            Available merge tokens
          </div>
          <div className="flex flex-wrap gap-1.5">
            {template.available_tokens.map((tok) => (
              <button
                key={tok}
                type="button"
                onClick={() => {
                  const insert = `{{${tok}}}`;
                  setBody((b) => `${b}${b.endsWith(" ") || b.endsWith("\n") || b === "" ? "" : " "}${insert}`);
                }}
                className="rounded-full border border-hairline bg-surface-1 px-2 py-0.5 font-mono text-[11px] text-fg-subtle hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
                title="Insert at end"
              >
                {`{{${tok}}}`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg-tertiary">
            Click a token to append it. The dispatcher fills tokens at send
            time. Unknown tokens render as &mdash;.
          </p>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      {children}
    </label>
  );
}
