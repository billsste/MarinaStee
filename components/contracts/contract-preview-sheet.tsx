"use client";

import * as React from "react";
import {
  Anchor,
  Calendar,
  Check,
  ChevronLeft,
  ChevronDown,
  Edit3,
  Loader2,
  Mail,
  MessageSquare,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BOATERS,
  CONTRACT_TEMPLATES,
  SLIPS,
  VESSELS,
  formatMoney,
} from "@/lib/mock-data";
import {
  addCommunication,
  mintContractSignatureToken,
  updateContract,
  useCurrentTenant,
  useContracts,
  useMarinaProfile,
  logAuditLocal,
} from "@/lib/client-store";
import { resolveContractTokens } from "@/lib/contract-tokens";
import type { Communication } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContractMarkdown } from "@/components/contracts/contract-markdown";

/*
 * Contract Preview Sheet
 *
 * Sits between "wizard submits + draft is generated" and "outbound
 * comm fires to the boater." Earlier flow shipped the contract to the
 * boater immediately upon wizard submit, with the AI-drafted body
 * filling in asynchronously — operator never had a chance to review
 * what Claude generated.
 *
 * Now: wizard submit creates the contract in `draft` status, awaits
 * the /api/draft-contract response, opens this sheet. Operator can:
 *
 *   1. Read the rendered body (markdown → simple HTML)
 *   2. Edit the markdown inline ("Edit text")
 *   3. Ask the agent to fix something ("shorten the cancellation
 *      policy", "add a pets clause") — calls /api/edit-contract
 *   4. Send to the customer (mints signature token, dispatches the
 *      onboarding email/SMS, transitions status to "sent")
 *   5. Save and close (contract stays draft, operator can re-open
 *      from the contract detail page)
 *
 * Layout: full-screen sheet with a centered max-w container. Left
 * column = rendered body; right column = metadata + actions.
 */
export function ContractPreviewSheet({
  contractId,
  open,
  onOpenChange,
}: {
  contractId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const contracts = useContracts();
  const tenant = useCurrentTenant();
  const marina = useMarinaProfile();
  const contract = contractId
    ? contracts.find((c) => c.id === contractId)
    : undefined;

  const [mode, setMode] = React.useState<"view" | "edit" | "asking">("view");
  const [editingBody, setEditingBody] = React.useState("");
  const [instruction, setInstruction] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [agentNote, setAgentNote] = React.useState<string | null>(null);

  // Reset internal state when the sheet opens against a different
  // contract (or re-opens against the same one after a close).
  React.useEffect(() => {
    if (open) {
      setMode("view");
      setInstruction("");
      setSending(false);
      setAgentNote(null);
      if (contract?.drafted_body_markdown) {
        setEditingBody(contract.drafted_body_markdown);
      }
    }
  }, [open, contractId, contract?.drafted_body_markdown]);

  if (!open || !contract) return null;

  const boater = BOATERS.find((b) => b.id === contract.boater_id);
  const vessel = contract.vessel_id
    ? VESSELS.find((v) => v.id === contract.vessel_id)
    : undefined;
  const slip = SLIPS.find((s) => s.id === contract.slip_id);

  // Effective body = whatever the operator sees rendered. A freshly-
  // generated contract has an empty `drafted_body_markdown` and the
  // body falls back to the template, with merge tokens resolved against
  // the boater/vessel/slip/contract record. Previously `body` only
  // pulled from `drafted_body_markdown`, so `hasBody` was false and the
  // Send button silently disabled — clicks did nothing.
  const template = CONTRACT_TEMPLATES.find(
    (t) => t.id === contract.template_id,
  );
  const body =
    contract.drafted_body_markdown && contract.drafted_body_markdown.trim()
      ? contract.drafted_body_markdown
      : boater
        ? resolveContractTokens(
            contract,
            boater,
            vessel,
            slip,
            template?.body_markdown,
            marina,
          )
        : "";

  const hasBody = body.trim().length > 0;
  const alreadySent = contract.status !== "draft";

  // What the operator will actually send. Computed here so the preview
  // card and the send handler stay in lockstep — change either, change
  // both. Kept simple (no template engine) — the same `${...}` flavor
  // sendToCustomer() uses inline.
  const outbound = (() => {
    if (!boater) return null;
    const channel = boater.communication_prefs.preferred_channel;
    const recipient =
      channel === "email"
        ? (boater.primary_contact.email ?? "")
        : (boater.primary_contact.phone ?? "");
    const subject = slip
      ? `Welcome to your slip ${slip.number} — complete onboarding`
      : "Welcome — complete onboarding";
    const greeting = `Hi ${boater.first_name},`;
    const slipLine = slip
      ? `Your slip ${slip.number} at ${slip.dock} is reserved. `
      : "";
    const bodyPlain =
      `${greeting}\n\n` +
      `${slipLine}Please complete the following to activate your contract:\n\n` +
      `  1. Review and sign your agreement\n` +
      `  2. Add a payment method\n\n` +
      `It takes about 2 minutes — we'll email a secure link as soon as you click Send.\n\n` +
      `Reply to this message if you have any questions.`;
    return { channel, recipient, subject, body: bodyPlain };
  })();

  function saveEdits() {
    if (editingBody.trim() === body.trim()) {
      setMode("view");
      return;
    }
    updateContract(contract!.id, {
      drafted_body_markdown: editingBody,
      drafted_at: new Date().toISOString(),
    });
    logAuditLocal({
      actor_user_id: "u_current",
      actor_label: "Operator",
      action_type: "contract.preview.edit_inline",
      target_entity: "contract",
      target_id: contract!.id,
      payload_delta: JSON.stringify({ source: "inline_edit" }),
    });
    setMode("view");
  }

  async function askAgent() {
    if (!instruction.trim() || !contract) return;
    setMode("asking");
    setAgentNote(null);
    try {
      const res = await fetch("/api/edit-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_body: body,
          instruction,
          contract_label: `${contract.id} — ${boater?.display_name ?? "Unknown"}${slip ? ` · ${slip.id}` : ""}`,
          tenant_id: tenant?.id,
        }),
      });
      const json = (await res.json()) as {
        drafted_body_markdown?: string;
        source?: string;
        note?: string;
      };
      if (json.drafted_body_markdown) {
        updateContract(contract.id, {
          drafted_body_markdown: json.drafted_body_markdown,
          drafted_at: new Date().toISOString(),
        });
        setEditingBody(json.drafted_body_markdown);
        logAuditLocal({
          actor_user_id: "u_current",
          actor_label: "Operator",
          action_type: "contract.preview.edit_via_agent",
          target_entity: "contract",
          target_id: contract.id,
          payload_delta: JSON.stringify({
            instruction,
            source: json.source ?? "unknown",
          }),
        });
        setInstruction("");
      }
      if (json.note) {
        setAgentNote(json.note);
      }
    } catch (err) {
      setAgentNote(
        err instanceof Error
          ? `Edit failed: ${err.message}`
          : "Edit failed — try again or use “Edit text”.",
      );
    } finally {
      setMode("view");
    }
  }

  function sendToCustomer() {
    if (!contract || !boater) return;
    setSending(true);
    // If the operator never opened "Edit text" / "Ask agent", the
    // contract's `drafted_body_markdown` is still empty even though
    // they're looking at a fully-rendered template body. Snapshot
    // what's on screen so the signed copy preserves the exact text
    // that was shown at send time.
    if (
      hasBody &&
      (!contract.drafted_body_markdown ||
        !contract.drafted_body_markdown.trim())
    ) {
      updateContract(contract.id, {
        drafted_body_markdown: body,
        drafted_at: new Date().toISOString(),
      });
    }
    // Mint the signature token + dispatch the onboarding comm. Same
    // logic that used to live in the wizard's submit handler; moved
    // here so the operator's "Send" click is what actually pushes the
    // contract out.
    const token = mintContractSignatureToken(contract.id);
    if (token) {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const onboardUrl = `${origin}/onboard/${token}`;
      const channel = boater.communication_prefs.preferred_channel;
      const commType: Communication["type"] = channel;
      const recipient =
        commType === "email"
          ? (boater.primary_contact.email ?? "")
          : (boater.primary_contact.phone ?? "");
      addCommunication({
        id: `cm_onboard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        boater_id: boater.id,
        type: commType,
        direction: "outbound",
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient,
        subject: slip
          ? `Welcome to your slip ${slip.number} — complete onboarding`
          : "Welcome — complete onboarding",
        body_preview: `Sign your contract and add a payment method here: ${onboardUrl}`,
        full_body:
          `Hi ${boater.first_name},\n\n` +
          (slip
            ? `Your slip ${slip.number} at ${slip.dock} is reserved. `
            : "") +
          `Please complete the following to activate your contract:\n\n` +
          `  1. Review and sign your agreement\n` +
          `  2. Add a payment method\n\n` +
          `It takes about 2 minutes: ${onboardUrl}\n\n` +
          `Reply to this message if you have any questions.`,
        sent_at: new Date().toISOString(),
        status: "delivered",
      });
      // Flip contract status — `sent` means "out to the boater,
      // awaiting signature."
      updateContract(contract.id, { status: "sent" });
      logAuditLocal({
        actor_user_id: "u_current",
        actor_label: "Operator",
        action_type: "contract.preview.send_to_customer",
        target_entity: "contract",
        target_id: contract.id,
        payload_delta: JSON.stringify({
          token,
          channel: commType,
          onboard_url: onboardUrl,
        }),
      });
    }
    setSending(false);
    onOpenChange(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review draft contract"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="m-4 flex w-full max-w-[1200px] flex-col overflow-hidden rounded-[14px] border border-hairline bg-surface-1 shadow-xl">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
              Review draft contract
            </span>
            <span className="text-[14px] font-semibold text-fg">
              {contract.id}
            </span>
            {alreadySent && (
              <Badge tone="ok" size="sm">
                Sent
              </Badge>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-7 items-center justify-center rounded-[6px] text-fg-tertiary hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">
          {/* Left column — rendered contract body */}
          <div className="min-h-0 overflow-y-auto border-b border-hairline lg:border-b-0 lg:border-r">
            {mode === "edit" ? (
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-hairline bg-surface-2 px-4 py-2 text-[12px] text-fg-subtle">
                  <span>Editing contract markdown</span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingBody(body);
                        setMode("view");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" onClick={saveEdits}>
                      <Check className="size-3.5" />
                      Save
                    </Button>
                  </div>
                </div>
                <textarea
                  value={editingBody}
                  onChange={(e) => setEditingBody(e.target.value)}
                  className="h-full min-h-[400px] w-full resize-none bg-surface-1 p-5 font-mono text-[12.5px] leading-relaxed text-fg focus:outline-none"
                  autoFocus
                />
              </div>
            ) : (
              <div className="p-6">
                {mode === "asking" && (
                  <div className="mb-4 flex items-center gap-2 rounded-[8px] border border-primary/30 bg-primary-soft/20 px-3 py-2 text-[12px] text-primary">
                    <Loader2 className="size-3.5 animate-spin" />
                    Agent is editing the contract…
                  </div>
                )}
                {!hasBody && mode !== "asking" && (
                  <div className="rounded-[10px] border border-dashed border-hairline bg-surface-2 px-6 py-10 text-center text-[13px] text-fg-subtle">
                    Contract body hasn&apos;t been drafted yet.
                  </div>
                )}
                {hasBody && (
                  <article className="max-w-none">
                    <ContractMarkdown body={body} variant="preview" />
                  </article>
                )}
              </div>
            )}
          </div>

          {/* Right column — metadata + actions */}
          <aside className="flex min-h-0 flex-col overflow-y-auto bg-surface-2">
            <div className="border-b border-hairline px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                Counterparty
              </div>
              <div className="mt-1.5 space-y-1.5 text-[13px]">
                {boater && (
                  <div className="flex items-center gap-1.5 text-fg">
                    <User className="size-3.5 text-fg-tertiary" />
                    <span className="font-medium">{boater.display_name}</span>
                  </div>
                )}
                {slip && (
                  <div className="flex items-center gap-1.5 text-fg-subtle">
                    <Anchor className="size-3.5 text-fg-tertiary" />
                    <span>
                      Slip {slip.id} · {slip.dock}
                    </span>
                  </div>
                )}
                {vessel && (
                  <div className="text-[12px] text-fg-subtle">
                    {[vessel.year, vessel.make, vessel.name]
                      .filter(Boolean)
                      .join(" ")}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
                  <Calendar className="size-3.5 text-fg-tertiary" />
                  <span>
                    {contract.effective_start} → {contract.effective_end}
                  </span>
                </div>
                <div className="text-[12px] text-fg-subtle">
                  {contract.annual_rate !== undefined ? (
                    <>
                      <span className="font-medium text-fg">
                        {formatMoney(contract.annual_rate)}
                      </span>
                      <span className="text-fg-tertiary">/yr</span>
                      <span className="ml-1 text-fg-tertiary">
                        · billed {contract.billing_cadence}
                      </span>
                    </>
                  ) : (
                    "Rate not set"
                  )}
                </div>
              </div>
            </div>

            {/* Ask the agent */}
            <div className="border-b border-hairline px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                <Sparkles className="size-3 text-primary" />
                Ask the agent
              </div>
              <p className="mt-1 text-[11px] text-fg-tertiary">
                Plain-English edits. e.g. <em>“shorten the cancellation policy,”</em>{" "}
                <em>“add a pets clause,”</em>{" "}
                <em>“change late fees to monthly.”</em>
              </p>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="What should we change?"
                rows={3}
                className="mt-2 w-full resize-none rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[12.5px] text-fg placeholder:text-fg-tertiary focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={mode === "asking" || alreadySent}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={askAgent}
                disabled={!instruction.trim() || mode === "asking" || alreadySent}
                className="mt-2 w-full"
              >
                {mode === "asking" ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Editing…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    Apply edit
                  </>
                )}
              </Button>
              {agentNote && (
                <p className="mt-2 rounded-[6px] bg-status-warn/10 px-2 py-1 text-[11px] text-status-warn">
                  {agentNote}
                </p>
              )}
            </div>

            {/* What will be sent — preview the outbound message so the
                operator can see EXACTLY what lands in the boater's inbox
                before clicking Send. Hidden once already sent. */}
            {!alreadySent && outbound && (
              <OutboundPreview outbound={outbound} />
            )}

            {/* Manual edit + send */}
            <div className="flex flex-1 flex-col gap-2 px-4 py-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingBody(body);
                  setMode(mode === "edit" ? "view" : "edit");
                }}
                disabled={!hasBody || alreadySent || mode === "asking"}
                className="w-full"
              >
                {mode === "edit" ? (
                  <>
                    <ChevronLeft className="size-3.5" />
                    Back to preview
                  </>
                ) : (
                  <>
                    <Edit3 className="size-3.5" />
                    Edit text manually
                  </>
                )}
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={sendToCustomer}
                disabled={
                  !hasBody || sending || alreadySent || mode === "asking"
                }
                className={cn("w-full", !alreadySent && "mt-auto")}
              >
                {sending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Sending…
                  </>
                ) : alreadySent ? (
                  <>
                    <Check className="size-3.5" />
                    Already sent
                  </>
                ) : (
                  <>
                    <Send className="size-3.5" />
                    Send to customer
                  </>
                )}
              </Button>
              {!alreadySent && (
                <p className="text-[11px] text-fg-tertiary">
                  Sending mints a signature link and dispatches it to{" "}
                  {boater?.communication_prefs.preferred_channel ?? "email"}.
                </p>
              )}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="mt-1 rounded-[6px] py-1 text-[11.5px] text-fg-subtle transition-colors hover:text-fg"
              >
                Save &amp; close — return later from contract detail
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// Markdown rendering lives in components/contracts/contract-markdown.tsx
// as the single source of truth across operator + holder surfaces.

/**
 * OutboundPreview — collapsed-by-default card showing the operator
 * exactly what will land in the boater's inbox / SMS when they click
 * Send to customer. The actual subject + body are computed in the
 * parent so the preview and the send action can't drift.
 */
function OutboundPreview({
  outbound,
}: {
  outbound: {
    channel: "email" | "sms" | "voice";
    recipient: string;
    subject: string;
    body: string;
  };
}) {
  const [expanded, setExpanded] = React.useState(false);
  const ChannelIcon = outbound.channel === "email" ? Mail : MessageSquare;
  const channelLabel =
    outbound.channel === "email"
      ? "Email"
      : outbound.channel === "sms"
        ? "SMS"
        : "Voice";

  return (
    <div className="border-b border-hairline px-4 py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ChannelIcon className="size-3 shrink-0 text-fg-tertiary" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
            Will send via {channelLabel}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-fg-tertiary transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      <div className="mt-1.5 truncate text-[12px] text-fg-subtle">
        To: <span className="text-fg">{outbound.recipient || "—"}</span>
      </div>
      <div className="mt-0.5 truncate text-[12px] text-fg-subtle">
        Subject:{" "}
        <span className="text-fg" title={outbound.subject}>
          {outbound.subject}
        </span>
      </div>
      {expanded && (
        <pre className="mt-2 max-h-[200px] overflow-auto whitespace-pre-wrap rounded-[6px] border border-hairline bg-surface-1 p-2.5 font-sans text-[11.5px] leading-[1.5] text-fg">
          {outbound.body}
        </pre>
      )}
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
        >
          Show full message
        </button>
      )}
    </div>
  );
}
