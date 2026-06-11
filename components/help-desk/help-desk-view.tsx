"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { LocalTime } from "@/components/ui/local-time";
import {
  AREA_OPTIONS,
  PRIORITY_OPTIONS,
  TYPE_OPTIONS,
  addHelpComment,
  areaLabel,
  cancelHelpTicket,
  createHelpTicket,
  priorityLabel,
  priorityTone,
  statusLabel,
  statusTone,
  typeLabel,
  useHelpTickets,
  type HelpAttachment,
  type HelpTicket,
  type HelpTicketArea,
  type HelpTicketPriority,
  type HelpTicketType,
} from "@/lib/help-desk";
import { cn } from "@/lib/utils";

/*
 * Help-desk view — two-tab UI modeled on EquipDispatch's
 * /(admin)/support page. New ticket form + my-tickets table + detail
 * modal with reply + cancel. Same structure, Marina Stee design tokens.
 */

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5 MB

type PendingAttachment = {
  id: string; // ephemeral pre-submit id
  name: string;
  mime_type: string;
  size_bytes: number;
  file: File;
};

type SupportTab = "new" | "history";

// Stable "current operator" identity. With Clerk wired this will pull
// from the active user; today the marina profile + a fallback email
// keep the form looking real.
const ME = {
  name: "Operator",
  email: "operator@marinastee.com",
};

export function HelpDeskView() {
  const tickets = useHelpTickets();
  const [activeTab, setActiveTab] = React.useState<SupportTab>("new");
  const [activeTicketId, setActiveTicketId] = React.useState<string | null>(
    null,
  );

  const activeTicket = activeTicketId
    ? tickets.find((t) => t.id === activeTicketId) ?? null
    : null;

  // Submission state ─────────────────────────────────────────────────
  const [ticketType, setTicketType] = React.useState<HelpTicketType>("issue");
  const [priority, setPriority] =
    React.useState<HelpTicketPriority>("normal");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [steps, setSteps] = React.useState("");
  const [area, setArea] = React.useState<HelpTicketArea>("members");
  // Lazy initializer reads window.location once at first render
  // (client-only) so we don't trigger a cascading set-state from inside
  // an effect. SSR uses the empty string and the submitted ticket gets
  // hydrated on the client before the operator hits Submit.
  const [pageUrl, setPageUrl] = React.useState(() =>
    typeof window === "undefined" ? "" : window.location.href,
  );
  const [attachments, setAttachments] = React.useState<PendingAttachment[]>(
    [],
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  // setPageUrl is currently only read by the form submit; keep the
  // setter exported so a future "auto-fill page url" toggle can update
  // it without restructuring the state.
  void setPageUrl;

  const validationMessage = React.useMemo(() => {
    if (subject.trim().length < 3 && description.trim().length < 5) {
      return "Add a short subject and description before submitting.";
    }
    if (subject.trim().length < 3)
      return "Add a short subject before submitting.";
    if (description.trim().length < 5)
      return "Add a bit more detail in the description.";
    return "";
  }, [subject, description]);

  function resetForm() {
    setTicketType("issue");
    setPriority("normal");
    setSubject("");
    setDescription("");
    setSteps("");
    setArea("members");
    setAttachments([]);
    setError("");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const next: PendingAttachment[] = [...attachments];
    let attachmentError = "";
    for (const file of files) {
      if (next.length >= MAX_ATTACHMENTS) {
        attachmentError = `You can attach up to ${MAX_ATTACHMENTS} files.`;
        break;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        attachmentError = `${file.name} is too large. Keep attachments under 5 MB.`;
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        file,
      });
    }
    setAttachments(next);
    setError(attachmentError);
    e.target.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((curr) => curr.filter((a) => a.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validationMessage) {
      setError(validationMessage);
      setSuccess("");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      // Convert pending files to attachment records. In the demo store
      // we hold a data URL inline; the real backend will swap this
      // for a multipart upload + storage id.
      const resolved: Array<Omit<HelpAttachment, "id">> = await Promise.all(
        attachments.map(
          (a) =>
            new Promise<Omit<HelpAttachment, "id">>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  name: a.name,
                  mime_type: a.mime_type,
                  size_bytes: a.size_bytes,
                  data_url:
                    typeof reader.result === "string" ? reader.result : "",
                });
              };
              reader.onerror = () =>
                resolve({
                  name: a.name,
                  mime_type: a.mime_type,
                  size_bytes: a.size_bytes,
                });
              reader.readAsDataURL(a.file);
            }),
        ),
      );
      const created = createHelpTicket({
        subject,
        description,
        type: ticketType,
        priority,
        area,
        steps_to_reproduce: steps,
        page_url: pageUrl,
        attachments: resolved,
        submitter_name: ME.name,
        submitter_email: ME.email,
      });
      setSuccess(`Ticket ${created.reference} submitted.`);
      resetForm();
      setActiveTab("history");
      setActiveTicketId(created.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        <TabButton
          active={activeTab === "new"}
          label="New ticket"
          onClick={() => setActiveTab("new")}
        />
        <TabButton
          active={activeTab === "history"}
          label={`My tickets${tickets.length ? ` (${tickets.length})` : ""}`}
          onClick={() => setActiveTab("history")}
        />
      </div>

      {activeTab === "new" ? (
        <NewTicketForm
          me={ME}
          ticketType={ticketType}
          setTicketType={setTicketType}
          priority={priority}
          setPriority={setPriority}
          area={area}
          setArea={setArea}
          subject={subject}
          setSubject={setSubject}
          description={description}
          setDescription={setDescription}
          steps={steps}
          setSteps={setSteps}
          attachments={attachments}
          onFileChange={handleFileChange}
          onRemoveAttachment={removeAttachment}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
          success={success}
          validationMessage={validationMessage}
        />
      ) : (
        <TicketHistory
          tickets={tickets}
          activeTicketId={activeTicketId}
          onOpen={setActiveTicketId}
        />
      )}

      {activeTicket && (
        <TicketDetailModal
          ticket={activeTicket}
          onClose={() => setActiveTicketId(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-[8px] border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        active
          ? "border-primary/30 bg-primary-soft text-primary"
          : "border-transparent text-fg-subtle hover:bg-surface-2 hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// New Ticket form
// ─────────────────────────────────────────────────────────────────────

function NewTicketForm(props: {
  me: { name: string; email: string };
  ticketType: HelpTicketType;
  setTicketType: (v: HelpTicketType) => void;
  priority: HelpTicketPriority;
  setPriority: (v: HelpTicketPriority) => void;
  area: HelpTicketArea;
  setArea: (v: HelpTicketArea) => void;
  subject: string;
  setSubject: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  steps: string;
  setSteps: (v: string) => void;
  attachments: PendingAttachment[];
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  error: string;
  success: string;
  validationMessage: string;
}) {
  return (
    <div className="rounded-[14px] border border-hairline bg-surface-1 p-5 shadow-sm">
      <form onSubmit={props.onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ReadonlyField label="Your name" value={props.me.name} />
          <ReadonlyField label="Email" value={props.me.email} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ChipGroup<HelpTicketType>
            label="Type"
            value={props.ticketType}
            options={TYPE_OPTIONS}
            onChange={props.setTicketType}
          />
          <ChipGroup<HelpTicketPriority>
            label="Priority"
            value={props.priority}
            options={PRIORITY_OPTIONS}
            onChange={props.setPriority}
          />
        </div>

        {/* AREA_OPTIONS has 13 entries — per CLAUDE.md §6.3 lists with
            more than 5 options must be a searchable combobox, not a
            native <select>. */}
        <div>
          <FieldLabel>Area</FieldLabel>
          <Combobox
            value={props.area}
            onChange={(v) => props.setArea(v as HelpTicketArea)}
            options={AREA_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            placeholder="Pick the area this is about…"
            searchPlaceholder="Search areas…"
          />
        </div>

        <TextField
          label="Subject"
          value={props.subject}
          onChange={props.setSubject}
          placeholder="Brief summary of the issue or request"
          required
        />

        <TextAreaField
          label="Description"
          value={props.description}
          onChange={props.setDescription}
          placeholder="What happened, what you expected, and anything that helps reproduce."
          minHeight={140}
          required
        />

        <TextAreaField
          label="Steps to reproduce"
          helper="Optional — helpful for bugs."
          value={props.steps}
          onChange={props.setSteps}
          placeholder={"1. Go to…\n2. Click on…\n3. See issue…"}
          minHeight={100}
        />

        <AttachmentPicker
          attachments={props.attachments}
          onChange={props.onFileChange}
          onRemove={props.onRemoveAttachment}
        />

        {props.error && (
          <Banner tone="danger" icon={<AlertTriangle className="size-3.5" />}>
            {props.error}
          </Banner>
        )}
        {props.success && (
          <Banner tone="ok" icon={<CheckCircle2 className="size-3.5" />}>
            {props.success}
          </Banner>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={props.submitting || !!props.validationMessage}
          >
            {props.submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <Send className="size-3.5" />
                Submit ticket
              </>
            )}
          </Button>
          {props.validationMessage && (
            <span className="text-[12px] text-fg-tertiary">
              {props.validationMessage}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// My Tickets — clickable rows
// ─────────────────────────────────────────────────────────────────────

function TicketHistory({
  tickets,
  activeTicketId,
  onOpen,
}: {
  tickets: HelpTicket[];
  activeTicketId: string | null;
  onOpen: (id: string) => void;
}) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-hairline bg-surface-2 px-6 py-14 text-center text-[13px] text-fg-subtle">
        No tickets yet. Use the{" "}
        <span className="font-medium text-fg">New ticket</span> tab to file
        your first one.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-[14px] border border-hairline bg-surface-1 shadow-sm">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-surface-2 text-left">
            {[
              "Ticket",
              "Subject",
              "Type",
              "Priority",
              "Status",
              "Submitted",
            ].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const isActive = activeTicketId === t.id;
            return (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className={cn(
                  "cursor-pointer border-t border-hairline transition-colors",
                  isActive
                    ? "bg-primary-soft/40"
                    : "hover:bg-surface-2/70",
                )}
              >
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="rounded-[6px] bg-primary-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
                    {t.reference}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-fg">{t.subject}</div>
                  {t.description && (
                    <div className="mt-0.5 line-clamp-1 text-[12px] text-fg-subtle">
                      {t.description}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                  {typeLabel(t.type)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <Badge tone={priorityTone(t.priority)} size="sm">
                    {priorityLabel(t.priority)}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <Badge tone={statusTone(t.status)} size="sm">
                    {statusLabel(t.status)}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-fg-tertiary">
                  <RelativeOrLocalTime iso={t.created_at} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Detail Modal
// ─────────────────────────────────────────────────────────────────────

function TicketDetailModal({
  ticket,
  onClose,
}: {
  ticket: HelpTicket;
  onClose: () => void;
}) {
  const [commentText, setCommentText] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const [postError, setPostError] = React.useState("");
  const [cancelling, setCancelling] = React.useState(false);
  const isClosed =
    ticket.status === "closed" ||
    ticket.status === "resolved" ||
    ticket.status === "cancelled";

  async function postReply() {
    if (!commentText.trim()) return;
    setPosting(true);
    setPostError("");
    try {
      const result = addHelpComment(ticket.id, commentText, {
        name: "Operator",
        kind: "operator",
      });
      if (!result) {
        setPostError("Could not post reply — ticket missing.");
        return;
      }
      setCommentText("");
    } finally {
      setPosting(false);
    }
  }

  function doCancel() {
    if (cancelling || isClosed) return;
    const confirmed = window.confirm(
      "Cancel this support ticket? The history will be preserved.",
    );
    if (!confirmed) return;
    setCancelling(true);
    try {
      cancelHelpTicket(ticket.id);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ticket ${ticket.reference}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[14px] bg-surface-1 shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <div className="text-[10.5px] font-medium uppercase tracking-wide text-primary">
              {ticket.reference}
            </div>
            <h2 className="display-tight mt-1 text-[20px] font-semibold text-fg">
              {ticket.subject}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral" size="sm">
                {typeLabel(ticket.type)}
              </Badge>
              <Badge tone={priorityTone(ticket.priority)} size="sm">
                {priorityLabel(ticket.priority)}
              </Badge>
              <Badge tone={statusTone(ticket.status)} size="sm">
                {statusLabel(ticket.status)}
              </Badge>
            </div>
            <div className="mt-1.5 text-[11.5px] text-fg-tertiary">
              Submitted{" "}
              <LocalTime iso={ticket.created_at} fmt="short_datetime" />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full border border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto bg-surface-2 px-5 py-4">
          <DetailSection title="Where it happened">
            <div className="text-fg">{areaLabel(ticket.area)}</div>
            {ticket.page_url && (
              <div className="mt-1 break-all text-[12px] text-fg-subtle">
                {ticket.page_url}
              </div>
            )}
          </DetailSection>

          <DetailSection title="Description">
            <p className="whitespace-pre-wrap text-fg">{ticket.description}</p>
          </DetailSection>

          {ticket.steps_to_reproduce && (
            <DetailSection title="Steps to reproduce">
              <p className="whitespace-pre-wrap text-fg">
                {ticket.steps_to_reproduce}
              </p>
            </DetailSection>
          )}

          <DetailSection title="Attachments">
            {ticket.attachments.length === 0 ? (
              <div className="text-[12px] text-fg-tertiary">
                No attachments.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {ticket.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={a.data_url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[13px] text-fg-muted hover:bg-surface-3"
                  >
                    <Paperclip className="size-3.5 shrink-0 text-fg-tertiary" />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="text-[11px] font-medium text-primary">
                      Open
                    </span>
                  </a>
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection title="Reply">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a follow-up note…"
              className="min-h-[100px] w-full resize-y rounded-[8px] border border-hairline bg-surface-1 p-2.5 text-[13px] text-fg outline-none focus:border-primary"
              disabled={isClosed}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="primary"
                onClick={postReply}
                disabled={posting || !commentText.trim() || isClosed}
              >
                {posting ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="size-3" />
                    Send reply
                  </>
                )}
              </Button>
              {postError && (
                <span className="text-[11.5px] text-status-danger">
                  {postError}
                </span>
              )}
            </div>
          </DetailSection>

          {ticket.comments.length > 0 && (
            <DetailSection title="Conversation">
              <div className="flex flex-col gap-2">
                {ticket.comments.map((c) => (
                  <CommentBubble key={c.id} comment={c} />
                ))}
              </div>
            </DetailSection>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline bg-surface-1 px-5 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={doCancel}
            disabled={cancelling || isClosed}
            className="text-status-danger hover:bg-status-danger/10"
          >
            {cancelling ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Cancelling…
              </>
            ) : (
              <>
                <AlertTriangle className="size-3" />
                Cancel ticket
              </>
            )}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </div>
      <div className="rounded-[10px] border border-hairline bg-surface-1 px-3 py-2.5 text-[13px] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function CommentBubble({
  comment,
}: {
  comment: HelpTicket["comments"][number];
}) {
  const isSystem = comment.actor_kind === "system";
  const isSupport = comment.actor_kind === "support";
  return (
    <div
      className={cn(
        "rounded-[10px] border px-3 py-2 text-[13px]",
        isSystem &&
          "border-status-warn/30 bg-status-warn/10 text-status-warn",
        isSupport && "border-primary/30 bg-primary-soft text-fg",
        !isSystem && !isSupport && "border-hairline bg-surface-1 text-fg",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{comment.actor}</div>
        <Badge tone={isSystem ? "warn" : isSupport ? "primary" : "neutral"} size="sm">
          {isSystem ? "Status" : isSupport ? "Support" : "You"}
        </Badge>
      </div>
      <div className="mt-0.5 text-[11px] text-fg-tertiary">
        <LocalTime iso={comment.created_at} fmt="short_datetime" />
      </div>
      <div className="mt-1.5 whitespace-pre-wrap leading-relaxed">
        {comment.body}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Form primitives
// ─────────────────────────────────────────────────────────────────────

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-2 text-[13px] text-fg-subtle">
        {value}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-2 text-[13px] text-fg outline-none focus:border-primary"
      />
    </div>
  );
}

function TextAreaField({
  label,
  helper,
  value,
  onChange,
  placeholder,
  minHeight,
  required,
}: {
  label: string;
  helper?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight: number;
  required?: boolean;
}) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      {helper && (
        <div className="mb-1 text-[11px] text-fg-tertiary">{helper}</div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={{ minHeight }}
        className="w-full resize-y rounded-[8px] border border-hairline bg-surface-1 p-2.5 text-[13px] text-fg outline-none focus:border-primary"
      />
    </div>
  );
}

function ChipGroup<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: Array<{ value: V; label: string }>;
  onChange: (v: V) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={cn(
                "rounded-[8px] border px-3 py-1.5 text-[12px] font-medium transition-colors",
                active
                  ? "border-primary/30 bg-primary-soft text-primary"
                  : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2 hover:text-fg",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AttachmentPicker({
  attachments,
  onChange,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <FieldLabel>Attachments</FieldLabel>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-hairline bg-surface-2 p-4 text-center transition-colors hover:bg-surface-3">
        <input
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.csv"
          onChange={onChange}
          className="hidden"
        />
        <Paperclip className="size-4 text-fg-tertiary" />
        <div className="text-[12.5px] font-medium text-fg">
          Add screenshots or files
        </div>
        <div className="text-[11px] text-fg-tertiary">
          Up to 5 files, 5 MB each. PNG, JPG, PDF, etc.
        </div>
      </label>
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-fg">
                  {a.name}
                </div>
                <div className="text-[11px] text-fg-tertiary">
                  {formatFileSize(a.size_bytes)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                className="rounded-[6px] border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] font-medium text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="mb-1 block text-[11.5px] font-medium text-fg-muted">
      {children}
      {required && <span className="ml-0.5 text-status-danger">*</span>}
    </label>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "danger";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[8px] border px-3 py-2 text-[13px]",
        tone === "ok"
          ? "border-status-ok/30 bg-status-ok/10 text-status-ok"
          : "border-status-danger/30 bg-status-danger/10 text-status-danger",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/**
 * Compact "5 min ago" timestamp for the table column. Falls back to
 * <LocalTime> for older entries so server/client renders agree (the
 * relative phrasing covers <7 days, which is the only horizon where
 * "X min ago" reads better than an absolute date).
 *
 * `suppressHydrationWarning` on the wrapping span covers the relative
 * path — Date.now() differs across server and client, so the first
 * client render will overwrite whatever the server emitted. Same
 * contract LocalTime uses for its own toLocaleString fields.
 */
function RelativeOrLocalTime({ iso }: { iso: string }) {
  const ms = Date.now() - new Date(iso).getTime();
  let relative: string | null = null;
  if (!Number.isNaN(ms)) {
    if (ms < 60_000) relative = "just now";
    else if (ms < 3_600_000) relative = `${Math.floor(ms / 60_000)} min ago`;
    else if (ms < 86_400_000)
      relative = `${Math.floor(ms / 3_600_000)} hr ago`;
    else {
      const days = Math.floor(ms / 86_400_000);
      if (days < 7) relative = `${days} day${days === 1 ? "" : "s"} ago`;
    }
  }
  if (relative != null) return <span suppressHydrationWarning>{relative}</span>;
  return <LocalTime iso={iso} fmt="short_datetime" />;
}
