"use client";

import {
  addAttachment,
  addExtractionDraft,
  findPosItemByHint,
  findStaffByName,
  findVendorByName,
  getAiSettings,
  getAttachmentById,
  getExtractionDraftById,
  logAuditLocal,
  markOnboardingStepComplete,
  nextAttachmentId,
  nextBillId,
  nextCertificationId,
  nextMarinaAssetId,
  nextStaffId,
  nextVendorId,
  recordStockMovement,
  updateExtractionDraft,
  upsertBill,
  upsertCertification,
  upsertMarinaAsset,
  upsertStaffMember,
  upsertVendor,
} from "@/lib/client-store";
import type {
  Attachment,
  Bill,
  Certification,
  ExtractionDraft,
  MarinaAsset,
  StaffMember,
  Vendor,
  VendorPaymentTerms,
} from "@/lib/types";

/*
 * Approve / reject an ExtractionDraft and post the underlying records.
 *
 * Each module has a tiny per-shape adapter that maps the staged action
 * to the corresponding entity create. The draft itself is updated to
 * track outcome (approved / auto_approved / rejected / errored) and
 * source-doc attachment_ids stamped on the resulting entity.
 *
 * Auto-approve hook: bills under `bills_auto_approve_threshold_cents`
 * skip review entirely and post immediately. The draft still appears
 * in the inbox marked Auto-approved for audit.
 */

export type ApproveResult =
  | { ok: true; entityId: string }
  | { ok: false; reason: string };

export function approveDraft(draftId: string): ApproveResult {
  const draft = getExtractionDraftById(draftId);
  if (!draft) return { ok: false, reason: "draft_not_found" };
  const result = executeDraft(draft, /* auto = */ false);
  if (result.ok) {
    logAuditLocal({
      actor_label: "Operator",
      action_type: `extraction_draft.approve.${draft.module}`,
      target_entity: "extraction_draft",
      target_id: draft.id,
      payload_delta: JSON.stringify({
        module: draft.module,
        entityId: result.entityId,
        attachment_id: draft.source_attachment_id,
      }),
      via_agent: true,
    });
  }
  return result;
}

export function rejectDraft(draftId: string, reason?: string) {
  updateExtractionDraft(draftId, {
    status: "rejected",
    decided_at: new Date().toISOString(),
    notes: reason ? `Rejected — ${reason}` : "Rejected",
  });
  const draft = getExtractionDraftById(draftId);
  logAuditLocal({
    actor_label: "Operator",
    action_type: `extraction_draft.reject.${draft?.module ?? "unknown"}`,
    target_entity: "extraction_draft",
    target_id: draftId,
    payload_delta: reason ? JSON.stringify({ reason }) : undefined,
    via_agent: true,
  });
}

/**
 * Persist a freshly-extracted draft from the /api/extract response,
 * including the source attachment. If the draft qualifies for auto-
 * approve under the current tenant config, runs the executor and
 * marks status `auto_approved`.
 */
export function persistFreshDraft(
  draft: ExtractionDraft,
  fileMeta: { name: string; mime: string; size_bytes: number; data_url: string }
): { draftId: string; attachmentId: string; autoApproved: boolean } {
  const attId = nextAttachmentId();
  const att: Attachment = {
    id: attId,
    tenant_id: "",
    name: fileMeta.name,
    mime: fileMeta.mime,
    size_bytes: fileMeta.size_bytes,
    data_url: fileMeta.data_url,
    uploaded_at: new Date().toISOString(),
    source: "drop",
  };
  addAttachment(att);

  const draftId = addExtractionDraft({
    ...draft,
    source_attachment_id: attId,
  });

  markOnboardingStepComplete("first_drop");

  let autoApproved = false;
  const settings = getAiSettings();
  if (draft.module === "bill" && settings.bills_auto_approve_enabled) {
    const action = draft.staged_actions[0] as Record<string, unknown>;
    const amount = typeof action?.amount === "number" ? action.amount : 0;
    const threshold = settings.bills_auto_approve_threshold_cents / 100;
    if (amount > 0 && amount <= threshold) {
      const familiar = settings.bills_auto_approve_requires_familiar_vendor
        ? !!findVendorByName(String(action?.vendor_name ?? ""))
        : true;
      if (familiar) {
        const persistedDraft = getExtractionDraftById(draftId);
        if (persistedDraft) {
          const res = executeDraft(persistedDraft, true);
          if (res.ok) {
            autoApproved = true;
            // Auto-approve audit row — finance + compliance need this.
            logAuditLocal({
              actor_label: "AI (auto-approve)",
              action_type: `extraction_draft.auto_approve.${draft.module}`,
              target_entity: "extraction_draft",
              target_id: draftId,
              payload_delta: JSON.stringify({
                module: draft.module,
                entityId: res.entityId,
                attachment_id: attId,
                threshold_cents: settings.bills_auto_approve_threshold_cents,
                amount: amount,
                rule: "bills_auto_approve_under_threshold",
              }),
              via_agent: true,
            });
          }
        }
      }
    }
  }

  return { draftId, attachmentId: attId, autoApproved };
}

// ── Internal: shape-specific executors ─────────────────────────

function executeDraft(draft: ExtractionDraft, auto: boolean): ApproveResult {
  try {
    const action = draft.staged_actions[0] as Record<string, unknown>;
    switch (draft.module) {
      case "bill":
        return executeBillDraft(draft, action, auto);
      case "vendor":
        return executeVendorDraft(draft, action, auto);
      case "certification":
        return executeCertDraft(draft, action, auto);
      case "asset":
        return executeAssetDraft(draft, action, auto);
      case "packing_slip":
        return executePackingSlipDraft(draft, action, auto);
      case "staff_onboarding":
        return executeStaffDraft(draft, action, auto);
      default:
        return { ok: false, reason: `unknown_module:${draft.module}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateExtractionDraft(draft.id, {
      status: "errored",
      error_message: msg,
      decided_at: new Date().toISOString(),
    });
    return { ok: false, reason: msg };
  }
}

function executeBillDraft(
  draft: ExtractionDraft,
  a: Record<string, unknown>,
  auto: boolean
): ApproveResult {
  const vendorName = String(a.vendor_name ?? "").trim();
  let vendor = findVendorByName(vendorName);
  const settings = getAiSettings();
  if (!vendor && settings.vendors_auto_create_from_invoice && vendorName) {
    const vId = nextVendorId();
    const newVendor: Vendor = {
      id: vId,
      tenant_id: "",
      name: vendorName,
      payment_terms: (a.payment_terms_hint as VendorPaymentTerms) ?? "net_30",
      issue_1099: false,
      active: true,
      created_at: new Date().toISOString(),
      attachment_ids: [draft.source_attachment_id],
      extracted_from_draft_id: draft.id,
    };
    upsertVendor(newVendor);
    vendor = newVendor;
  }
  if (!vendor) {
    return { ok: false, reason: `vendor_not_found:${vendorName}` };
  }

  const id = nextBillId();
  const lineItems = Array.isArray(a.line_items)
    ? (a.line_items as Array<{ description: string; amount: number; gl_account_hint?: string }>).map(
        (li) => ({
          description: li.description,
          amount: Number(li.amount) || 0,
          gl_account: li.gl_account_hint ?? vendor!.default_gl_account,
        })
      )
    : [
        {
          description: `Bill ${String(a.number ?? "")}`,
          amount: Number(a.amount) || 0,
          gl_account: vendor.default_gl_account,
        },
      ];

  const bill: Bill = {
    id,
    tenant_id: "",
    vendor_id: vendor.id,
    number: String(a.number ?? id),
    bill_date: String(a.bill_date ?? new Date().toISOString().slice(0, 10)),
    due_date: String(
      a.due_date ??
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    ),
    amount: Number(a.amount) || 0,
    amount_paid: 0,
    status: "open",
    line_items: lineItems,
    qb_sync_status: "pending",
    created_at: new Date().toISOString(),
    attachment_ids: [draft.source_attachment_id],
    extracted_from_draft_id: draft.id,
    auto_approved_by_rule: auto ? "bills_auto_approve_under_threshold" : undefined,
  };
  upsertBill(bill);
  updateExtractionDraft(draft.id, {
    status: auto ? "auto_approved" : "approved",
    auto_approved: auto,
    decided_at: new Date().toISOString(),
  });
  return { ok: true, entityId: id };
}

function executeVendorDraft(
  draft: ExtractionDraft,
  a: Record<string, unknown>,
  auto: boolean
): ApproveResult {
  const id = nextVendorId();
  const v: Vendor = {
    id,
    tenant_id: "",
    name: String(a.name ?? ""),
    display_name: a.display_name ? String(a.display_name) : undefined,
    contact_name: a.contact_name ? String(a.contact_name) : undefined,
    email: a.email ? String(a.email) : undefined,
    phone: a.phone ? String(a.phone) : undefined,
    address_line1: a.address_line1 ? String(a.address_line1) : undefined,
    city: a.city ? String(a.city) : undefined,
    state: a.state ? String(a.state) : undefined,
    postal_code: a.postal_code ? String(a.postal_code) : undefined,
    payment_terms: (a.payment_terms as VendorPaymentTerms) ?? "net_30",
    default_gl_account: a.default_gl_account_hint
      ? String(a.default_gl_account_hint)
      : undefined,
    tax_id_last4: a.tax_id_last4 ? String(a.tax_id_last4) : undefined,
    issue_1099: false,
    active: true,
    created_at: new Date().toISOString(),
    attachment_ids: [draft.source_attachment_id],
    extracted_from_draft_id: draft.id,
  };
  upsertVendor(v);
  updateExtractionDraft(draft.id, {
    status: auto ? "auto_approved" : "approved",
    auto_approved: auto,
    decided_at: new Date().toISOString(),
  });
  return { ok: true, entityId: id };
}

function executeCertDraft(
  draft: ExtractionDraft,
  a: Record<string, unknown>,
  auto: boolean
): ApproveResult {
  const staffName = String(a.holder_name ?? "").trim();
  const staff = staffName ? findStaffByName(staffName) : undefined;
  if (!staff) {
    return { ok: false, reason: `staff_not_found:${staffName}` };
  }
  const id = nextCertificationId();
  const cert: Certification = {
    id,
    tenant_id: "",
    staff_id: staff.id,
    name: String(a.cert_name ?? ""),
    issuer: a.issuer ? String(a.issuer) : undefined,
    issued_at: String(a.issued_at ?? new Date().toISOString().slice(0, 10)),
    expires_at: a.expires_at ? String(a.expires_at) : undefined,
    attachment_ids: [draft.source_attachment_id],
    extracted_from_draft_id: draft.id,
  };
  upsertCertification(cert);
  updateExtractionDraft(draft.id, {
    status: auto ? "auto_approved" : "approved",
    auto_approved: auto,
    decided_at: new Date().toISOString(),
  });
  return { ok: true, entityId: id };
}

function executeAssetDraft(
  draft: ExtractionDraft,
  a: Record<string, unknown>,
  auto: boolean
): ApproveResult {
  const id = nextMarinaAssetId();
  const now = new Date().toISOString();
  const asset: MarinaAsset = {
    id,
    tenant_id: "",
    name: String(a.name ?? "New Asset"),
    kind: (a.kind as MarinaAsset["kind"]) ?? "other",
    manufacturer: a.manufacturer ? String(a.manufacturer) : undefined,
    model: a.model ? String(a.model) : undefined,
    serial_number: a.serial_number ? String(a.serial_number) : undefined,
    purchase_date: a.purchase_date ? String(a.purchase_date) : undefined,
    purchase_price:
      typeof a.purchase_price === "number" ? a.purchase_price : undefined,
    warranty_until: a.warranty_until ? String(a.warranty_until) : undefined,
    status: "active",
    created_at: now,
    updated_at: now,
    attachment_ids: [draft.source_attachment_id],
    extracted_from_draft_id: draft.id,
  };
  upsertMarinaAsset(asset);
  updateExtractionDraft(draft.id, {
    status: auto ? "auto_approved" : "approved",
    auto_approved: auto,
    decided_at: new Date().toISOString(),
  });
  return { ok: true, entityId: id };
}

function executePackingSlipDraft(
  draft: ExtractionDraft,
  a: Record<string, unknown>,
  auto: boolean
): ApproveResult {
  const lines = Array.isArray(a.line_items)
    ? (a.line_items as Array<{ sku_hint?: string; description?: string; quantity?: number }>)
    : [];
  const unmatched: string[] = [];
  let receivedCount = 0;
  for (const li of lines) {
    const item = findPosItemByHint(li.sku_hint, li.description);
    if (!item) {
      unmatched.push(li.description ?? li.sku_hint ?? "(unknown line)");
      continue;
    }
    const qty = Number(li.quantity) || 0;
    if (qty <= 0) continue;
    recordStockMovement({
      item_id: item.id,
      delta: qty,
      kind: "receive",
      notes: `Packing slip ${String(a.po_number ?? "")} — ${li.description ?? ""}`,
    });
    receivedCount++;
  }
  updateExtractionDraft(draft.id, {
    status: auto ? "auto_approved" : "approved",
    auto_approved: auto,
    decided_at: new Date().toISOString(),
    notes:
      unmatched.length > 0
        ? `${receivedCount} lines received. Unmatched: ${unmatched.join(", ")}.`
        : `${receivedCount} lines received.`,
  });
  return { ok: true, entityId: `packing_${draft.id}` };
}

function executeStaffDraft(
  draft: ExtractionDraft,
  a: Record<string, unknown>,
  auto: boolean
): ApproveResult {
  const id = nextStaffId();
  const tenantId = getAiSettings().tenant_id;
  const roleId = `role_${tenantId.slice(-6)}_manager`;
  const staff: StaffMember = {
    id,
    tenant_id: "",
    name: String(a.name ?? "New Hire"),
    email: String(a.email ?? ""),
    phone: a.phone ? String(a.phone) : undefined,
    role_id: roleId,
    status: "invited",
    mfa_enabled: false,
    created_at: new Date().toISOString(),
    employment_type: (a.employment_type as "w2" | "1099") ?? "w2",
    hourly_rate: typeof a.hourly_rate === "number" ? a.hourly_rate : undefined,
    salary_annual:
      typeof a.salary_annual === "number" ? a.salary_annual : undefined,
    ot_multiplier:
      a.employment_type === "w2" && typeof a.hourly_rate === "number"
        ? 1.5
        : undefined,
    hire_date: a.hire_date
      ? String(a.hire_date)
      : new Date().toISOString().slice(0, 10),
    default_position: a.position ? String(a.position) : "Dockhand",
    payment_method: "direct_deposit",
    pto_hours_balance: 0,
    attachment_ids: [draft.source_attachment_id],
    extracted_from_draft_id: draft.id,
  };
  upsertStaffMember(staff);
  updateExtractionDraft(draft.id, {
    status: auto ? "auto_approved" : "approved",
    auto_approved: auto,
    decided_at: new Date().toISOString(),
  });
  return { ok: true, entityId: id };
}

// Re-export so pages don't need a second import.
export { getAttachmentById };
