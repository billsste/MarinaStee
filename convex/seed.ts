/*
 * One-time seed action — copies the in-source mock dataset into Convex.
 *
 * Run after `npx convex dev` provisions a deployment + an org-binding has
 * been made. From a terminal:
 *
 *     npx convex run seed:loadFromMockData --org-id org_xxx
 *
 * The action:
 *   1. Provisions a Marina record for the given Clerk org_id
 *   2. Seeds reference data (roles, picklists, comm templates, fuel inventory)
 *   3. Seeds entities in dependency order, building mock-id → Convex-id maps
 *   4. Reports row counts back to the caller
 *
 * IMPORTANT: idempotent on a per-tenant basis. Re-running clears the
 * tenant's existing rows first, then re-inserts. Other tenants are
 * untouched.
 *
 * Since lib/mock-data.ts contains the canonical demo dataset, the seed
 * imports directly from there. The bundler resolves the path at deploy
 * time — no runtime Node APIs touched.
 */

import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ──────────────────────────────────────────────────────────────
// Public action — the entry point invoked via `npx convex run`
// ──────────────────────────────────────────────────────────────

export const loadFromMockData = action({
  args: {
    clerkOrgId: v.string(),
    // When true, wipe the tenant's existing rows first. Default true so
    // repeated `npx convex run seed:loadFromMockData` calls converge to
    // the same state. Pass `false` to append.
    fresh: v.optional(v.boolean()),
  },
  handler: async (ctx, { clerkOrgId, fresh }) => {
    return await ctx.runMutation(internal.seed.runSeed, {
      clerkOrgId,
      fresh: fresh ?? true,
    });
  },
});

// ──────────────────────────────────────────────────────────────
// Internal mutation — does the actual inserts.
//
// Wrapped in a mutation so all inserts happen in one Convex
// transaction. If anything throws, the tenant ends up with no
// partial data.
// ──────────────────────────────────────────────────────────────

export const runSeed = internalMutation({
  args: { clerkOrgId: v.string(), fresh: v.boolean() },
  handler: async (ctx, { clerkOrgId, fresh }) => {
    // Lazy-import the dataset so it isn't bundled into other Convex
    // functions. Type imports get erased at deploy time; the JS module
    // gets bundled only for this function's call graph.
    const {
      BOATERS,
      VESSELS,
      DOCKS,
      SLIPS,
      CONTRACTS,
      CONTRACT_TEMPLATES,
      RESERVATIONS,
      WORK_ORDERS,
      LEDGER_ENTRIES,
      ADDITIONAL_FEES,
      RATES,
      POS_LOCATIONS,
      POS_CATALOG,
      POS_ORDERS,
      RENTAL_GROUPS,
      RENTAL_SPACES,
      INSURANCE_CERTIFICATES,
      WAITLIST_ENTRIES,
      METER_READINGS,
      FUEL_INVENTORY,
      FUEL_DELIVERIES,
      FUEL_SALES,
      RENTAL_BOATS,
      BOAT_RENTALS,
      COMMUNICATIONS,
      COMM_TEMPLATES_SEED,
      MARINA_PROFILE_SEED,
      ROLES_SEED,
      STAFF_SEED,
      PROVIDER_CONFIGS_SEED,
      PICKLISTS_SEED,
      MARINA_EVENTS,
      STAFF_NOTES,
    } = await import("../lib/mock-data");

    // ── 1. Tenant ────────────────────────────────────────────
    let marina = await ctx.db
      .query("marinas")
      .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", clerkOrgId))
      .unique();

    if (marina && fresh) {
      // Wipe everything for this tenant before re-seeding.
      await wipeTenant(ctx, marina._id);
    }

    if (!marina) {
      const profile = MARINA_PROFILE_SEED;
      const marinaId = await ctx.db.insert("marinas", {
        clerkOrgId,
        display_name: profile.display_name,
        short_name: profile.short_name,
        tagline: profile.tagline,
        email: profile.email,
        phone: profile.phone,
        website: profile.website,
        address_line1: profile.address_line1,
        address_line2: profile.address_line2,
        city: profile.city,
        state: profile.state,
        postal_code: profile.postal_code,
        country: profile.country,
        timezone: profile.timezone,
        business_hours_open: profile.business_hours_open,
        business_hours_close: profile.business_hours_close,
        default_tax_rate: profile.default_tax_rate,
        accounting_close: profile.accounting_close,
        outbound_email_from_name: profile.outbound_email_from_name,
        outbound_sms_sender_label: profile.outbound_sms_sender_label,
      });
      marina = (await ctx.db.get(marinaId))!;
    }
    const tenantId = marina._id;

    // ── Mock-id → Convex-id maps. Built as we insert, used by
    //    downstream FK references.
    const dockIdMap = new Map<string, Id<"docks">>();
    const boaterIdMap = new Map<string, Id<"boaters">>();
    const vesselIdMap = new Map<string, Id<"vessels">>();
    const slipIdMap = new Map<string, Id<"slips">>();
    const contractIdMap = new Map<string, Id<"contracts">>();
    const contractTemplateIdMap = new Map<string, Id<"contractTemplates">>();
    const workOrderIdMap = new Map<string, Id<"workOrders">>();
    const reservationIdMap = new Map<string, Id<"reservations">>();
    const ledgerIdMap = new Map<string, Id<"ledgerEntries">>();
    const feeIdMap = new Map<string, Id<"additionalFees">>();
    const posLocationIdMap = new Map<string, Id<"posLocations">>();
    const posItemIdMap = new Map<string, Id<"posCatalog">>();
    const rentalGroupIdMap = new Map<string, Id<"rentalGroups">>();
    const rentalSpaceIdMap = new Map<string, Id<"rentalSpaces">>();
    const rentalBoatIdMap = new Map<string, Id<"rentalBoats">>();
    const roleIdMap = new Map<string, Id<"roles">>();

    // ── 2. Roles ──────────────────────────────────────────────
    for (const r of ROLES_SEED) {
      const id = await ctx.db.insert("roles", {
        tenantId,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        is_system: r.is_system,
        sort_order: r.sort_order,
      });
      roleIdMap.set(r.id, id);
    }

    // ── 3. Staff (linked to roles) ────────────────────────────
    for (const s of STAFF_SEED) {
      const roleConvexId = roleIdMap.get(s.role_id);
      if (!roleConvexId) continue;
      await ctx.db.insert("staffMembers", {
        tenantId,
        clerkUserId: undefined,
        name: s.name,
        email: s.email,
        phone: s.phone,
        role_id: roleConvexId,
        status: s.status,
        mfa_enabled: s.mfa_enabled,
        last_login_at: s.last_login_at,
      });
    }

    // ── 4. Picklists ──────────────────────────────────────────
    for (const p of PICKLISTS_SEED) {
      await ctx.db.insert("picklists", {
        tenantId,
        field_key: p.field_key,
        label: p.label,
        values: p.values.map((vv) => ({
          id: vv.id,
          label: vv.label,
          code: vv.code,
          sort_order: vv.sort_order,
          active: vv.active,
        })),
      });
    }

    // ── 5. Comm templates ────────────────────────────────────
    for (const t of COMM_TEMPLATES_SEED) {
      await ctx.db.insert("commTemplates", {
        tenantId,
        kind: t.kind,
        name: t.name,
        description: t.description,
        channel: t.channel,
        subject: t.subject,
        body_markdown: t.body_markdown,
        active: t.active,
        available_tokens: t.available_tokens,
      });
    }

    // ── 6. Provider configs ───────────────────────────────────
    for (const p of PROVIDER_CONFIGS_SEED) {
      await ctx.db.insert("providerConfigs", {
        tenantId,
        kind: p.kind,
        provider: p.provider,
        enabled: p.enabled,
        public_config: JSON.stringify(p.public_config ?? {}),
        has_secret: p.has_secret,
      });
    }

    // ── 7. Docks ──────────────────────────────────────────────
    for (const d of DOCKS) {
      const id = await ctx.db.insert("docks", {
        tenantId,
        name: d.name,
        short_name: d.short_name,
        prefix: d.prefix,
        sort_order: d.sort_order,
        active: d.active,
        notes: d.notes,
      });
      dockIdMap.set(d.id, id);
    }

    // ── 8. Rental groups + spaces (legacy — kept for migration) ─
    for (const g of RENTAL_GROUPS) {
      const id = await ctx.db.insert("rentalGroups", {
        tenantId,
        name: g.name,
        type: g.type,
        description: g.description,
        active: g.active ?? true,
      });
      rentalGroupIdMap.set(g.id, id);
    }
    for (const s of RENTAL_SPACES) {
      const groupId = rentalGroupIdMap.get(s.group_id);
      if (!groupId) continue;
      const id = await ctx.db.insert("rentalSpaces", {
        tenantId,
        group_id: groupId,
        number: s.number,
        status: s.status,
        length_inches: s.length_inches,
        width_inches: s.width_inches,
        has_power: s.has_power,
        has_water: s.has_water,
      });
      rentalSpaceIdMap.set(s.id, id);
    }

    // ── 9. Slips (refs docks) ─────────────────────────────────
    for (const s of SLIPS) {
      const dockId = dockIdMap.get(s.dock_id);
      if (!dockId) continue;
      const id = await ctx.db.insert("slips", {
        tenantId,
        dock_id: dockId,
        dock_name_cache: s.dock,
        number: s.number,
        slip_class: s.slip_class,
        invoice_category: s.invoice_category,
        max_loa_inches: s.max_loa_inches,
        max_beam_inches: s.max_beam_inches,
        has_power: s.has_power,
        has_water: s.has_water,
        default_annual_rate: s.default_annual_rate,
        default_monthly_rate: s.default_monthly_rate,
        default_seasonal_rate: s.default_seasonal_rate,
        // current_holder_boater_id + current_contract_id resolved
        // after boaters + contracts land
        occupancy_status: s.occupancy_status,
        notes: s.notes,
      });
      slipIdMap.set(s.id, id);
    }

    // ── 10. POS locations + catalog ──────────────────────────
    for (const l of POS_LOCATIONS) {
      const id = await ctx.db.insert("posLocations", {
        tenantId,
        key: l.key,
        name: l.name,
        allows_charge_to_account: l.allows_charge_to_account,
        default_tax_rate: l.default_tax_rate,
        icon_key: l.icon_key,
        active: l.active,
        sort_order: l.sort_order,
      });
      posLocationIdMap.set(l.id, id);
    }
    for (const item of POS_CATALOG) {
      const id = await ctx.db.insert("posCatalog", {
        tenantId,
        sku: item.sku,
        name: item.name,
        category: item.category,
        price: item.price,
        cost: item.cost,
        location_keys: item.location_keys,
        taxable: item.taxable,
        active: item.active,
      });
      posItemIdMap.set(item.id, id);
    }

    // ── 11. Rates + fees ──────────────────────────────────────
    for (const r of RATES) {
      await ctx.db.insert("rates", {
        tenantId,
        name: r.name,
        occupancy_type: r.occupancy_type,
        cadence: r.cadence,
        amount: r.amount,
        active: r.active ?? true,
        notes: r.notes,
      });
    }
    // Contract templates first so fees can link to them
    for (const t of CONTRACT_TEMPLATES) {
      const id = await ctx.db.insert("contractTemplates", {
        tenantId,
        name: t.name,
        template_type: t.template_type,
        body_markdown: t.body_markdown,
        available_tokens: t.available_tokens ?? [],
        version: t.version,
        active: t.active,
      });
      contractTemplateIdMap.set(t.id, id);
    }
    for (const f of ADDITIONAL_FEES) {
      const id = await ctx.db.insert("additionalFees", {
        tenantId,
        name: f.name,
        description: f.description,
        amount: f.amount,
        recurrence: f.recurrence,
        applies_to: f.applies_to,
        accounting_line_item: f.accounting_line_item,
        applies_to_group_ids: f.applies_to_group_ids
          ?.map((id) => rentalGroupIdMap.get(id)!)
          .filter(Boolean),
        linked_activity_type: f.linked_activity_type,
        linked_template_id: f.linked_template_id
          ? contractTemplateIdMap.get(f.linked_template_id)
          : undefined,
        auto_attach: f.auto_attach,
      });
      feeIdMap.set(f.id, id);
    }

    // ── 12. Boaters ───────────────────────────────────────────
    for (const b of BOATERS) {
      const id = await ctx.db.insert("boaters", {
        tenantId,
        display_name: b.display_name,
        first_name: b.first_name,
        last_name: b.last_name,
        code: b.code,
        active: b.active,
        billing_cadence: b.billing_cadence,
        tags: b.tags,
        communication_prefs: b.communication_prefs,
        primary_contact: b.primary_contact,
        additional_contacts: b.additional_contacts,
        address: b.address,
        cards_on_file: b.cards_on_file,
        trust_score: b.trust_score,
        notes: b.notes,
      });
      boaterIdMap.set(b.id, id);
    }

    // ── 13. Vessels (refs boaters) ────────────────────────────
    for (const v of VESSELS) {
      const boaterId = boaterIdMap.get(v.boater_id);
      if (!boaterId) continue;
      const id = await ctx.db.insert("vessels", {
        tenantId,
        boater_id: boaterId,
        co_owner_ids: (v.co_owner_ids ?? [])
          .map((id) => boaterIdMap.get(id)!)
          .filter(Boolean),
        name: v.name,
        year: v.year,
        make: v.make,
        model: v.model,
        vessel_type: v.vessel_type,
        fuel_type: v.fuel_type,
        loa_inches: v.loa_inches,
        beam_inches: v.beam_inches,
        draft_inches: v.draft_inches,
        hull_vin: v.hull_vin,
        registration: v.registration,
        active: v.active,
      });
      vesselIdMap.set(v.id, id);
    }

    // ── 14. Contracts (refs boaters + vessels + slips + templates) ─
    for (const c of CONTRACTS) {
      const boaterId = boaterIdMap.get(c.boater_id);
      if (!boaterId) continue;
      const templateId = contractTemplateIdMap.get(c.template_id);
      if (!templateId) continue;
      const id = await ctx.db.insert("contracts", {
        tenantId,
        number: c.number,
        boater_id: boaterId,
        template_id: templateId,
        template_version: c.template_version,
        vessel_id: c.vessel_id ? vesselIdMap.get(c.vessel_id) : undefined,
        slip_id: c.slip_id ? slipIdMap.get(c.slip_id) : undefined,
        status: c.status,
        effective_start: c.effective_start,
        effective_end: c.effective_end,
        annual_rate: c.annual_rate,
        billing_cadence: c.billing_cadence,
        signature_token: c.signature_token,
        signed_at: c.signed_at,
        signed_by_name: c.signed_by_name,
        drafted_body_markdown: c.drafted_body_markdown,
        drafted_at: c.drafted_at,
      });
      contractIdMap.set(c.id, id);
    }

    // Back-fill slip → current_holder + current_contract
    for (const s of SLIPS) {
      const slipId = slipIdMap.get(s.id);
      if (!slipId) continue;
      const patch: Record<string, Id<"boaters"> | Id<"contracts">> = {};
      if (s.current_holder_boater_id) {
        const bid = boaterIdMap.get(s.current_holder_boater_id);
        if (bid) patch.current_holder_boater_id = bid;
      }
      if (s.current_contract_id) {
        const cid = contractIdMap.get(s.current_contract_id);
        if (cid) patch.current_contract_id = cid;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(slipId, patch);
    }

    // ── 15. Reservations ─────────────────────────────────────
    for (const r of RESERVATIONS) {
      const boaterId = boaterIdMap.get(r.boater_id);
      const slipId = slipIdMap.get(r.slip_id);
      if (!boaterId || !slipId) continue;
      const id = await ctx.db.insert("reservations", {
        tenantId,
        number: r.number,
        seq: r.seq,
        boater_id: boaterId,
        vessel_id: r.vessel_id ? vesselIdMap.get(r.vessel_id) : undefined,
        slip_id: slipId,
        arrival_date: r.arrival_date,
        departure_date: r.departure_date,
        status: r.status,
        type: r.type,
        nightly_rate: r.nightly_rate,
        notes: r.notes,
      });
      reservationIdMap.set(r.id, id);
    }

    // ── 16. Work orders ──────────────────────────────────────
    for (const w of WORK_ORDERS) {
      const boaterId = boaterIdMap.get(w.boater_id);
      if (!boaterId) continue;
      const id = await ctx.db.insert("workOrders", {
        tenantId,
        number: w.number,
        boater_id: boaterId,
        vessel_id: w.vessel_id ? vesselIdMap.get(w.vessel_id) : undefined,
        slip_id: w.slip_id ? slipIdMap.get(w.slip_id) : undefined,
        subject: w.subject,
        description: w.description,
        status: w.status,
        priority: w.priority,
        assignee_user_id: w.assignee_user_id,
        activity_type: w.activity_type,
        start_date: w.start_date,
        end_date: w.end_date,
        due_date: w.due_date,
        billable_minutes: w.billable_minutes,
        flagged: w.flagged,
      });
      workOrderIdMap.set(w.id, id);
    }

    // ── 17. Ledger entries (refs boaters; FK to invoices comes
    //     via applied_to_invoice_ids — second pass) ───────────
    for (const l of LEDGER_ENTRIES) {
      const boaterId = boaterIdMap.get(l.boater_id);
      if (!boaterId) continue;
      const id = await ctx.db.insert("ledgerEntries", {
        tenantId,
        boater_id: boaterId,
        type: l.type,
        number: l.number,
        date: l.date,
        amount: l.amount,
        open_balance: l.open_balance,
        method: l.method ?? undefined,
        status: l.status,
        line_items: l.line_items,
        qb_sync_status: l.qb_sync_status,
        qb_ref: l.qb_ref,
        refund_reason: l.refund_reason,
        refund_notes: l.refund_notes,
      });
      ledgerIdMap.set(l.id, id);
    }
    // Second pass: applied_to_invoice_ids
    for (const l of LEDGER_ENTRIES) {
      if (!l.applied_to_invoice_ids?.length) continue;
      const paymentId = ledgerIdMap.get(l.id);
      if (!paymentId) continue;
      const appliedIds = l.applied_to_invoice_ids
        .map((id) => ledgerIdMap.get(id)!)
        .filter(Boolean);
      if (appliedIds.length > 0) {
        await ctx.db.patch(paymentId, { applied_to_invoice_ids: appliedIds });
      }
    }

    // ── 18. Insurance certificates ───────────────────────────
    for (const c of INSURANCE_CERTIFICATES) {
      const boaterId = boaterIdMap.get(c.boater_id);
      if (!boaterId) continue;
      await ctx.db.insert("insuranceCertificates", {
        tenantId,
        boater_id: boaterId,
        carrier: c.carrier,
        policy_number: c.policy_number,
        effective_start: c.effective_start,
        effective_end: c.effective_end,
        coverage_amount: c.coverage_amount,
        status: c.status,
        upload_token: c.upload_token,
      });
    }

    // ── 19. Waitlist ─────────────────────────────────────────
    for (const w of WAITLIST_ENTRIES) {
      await ctx.db.insert("waitlistEntries", {
        tenantId,
        boater_id: w.boater_id ? boaterIdMap.get(w.boater_id) : undefined,
        patron_name: w.patron_name,
        patron_email: w.patron_email,
        patron_phone: w.patron_phone,
        preferences: {
          min_loa_inches: w.preferences?.min_loa_inches,
          max_loa_inches: w.preferences?.max_loa_inches,
          needs_power: w.preferences?.needs_power,
          needs_water: w.preferences?.needs_water,
          preferred_dock_ids: w.preferences?.preferred_dock_ids
            ?.map((id) => dockIdMap.get(id)!)
            .filter(Boolean),
        },
        status: w.status,
        offered_slip_id: w.offered_slip_id ? slipIdMap.get(w.offered_slip_id) : undefined,
        offer_token: w.offer_token,
        offer_expires_at: w.offer_expires_at,
      });
    }

    // ── 20. Meters ───────────────────────────────────────────
    for (const m of METER_READINGS) {
      const spaceId = slipIdMap.get(m.space_id);
      if (!spaceId) continue;
      await ctx.db.insert("meterReadings", {
        tenantId,
        space_id: spaceId,
        meter_number: m.meter_number,
        current_reading: m.current_reading,
        current_ts: m.current_ts,
        prev_reading: m.prev_reading,
        prev_ts: m.prev_ts,
        rate_per_unit: m.rate_per_unit,
        unit: m.unit,
      });
    }

    // ── 21. Fuel ─────────────────────────────────────────────
    for (const f of FUEL_INVENTORY) {
      await ctx.db.insert("fuelInventory", {
        tenantId,
        fuel_type: f.fuel_type,
        current_gallons: f.current_gallons,
        tank_capacity: f.tank_capacity,
        reorder_threshold_pct: f.reorder_threshold_pct,
        current_price_per_gallon: f.current_price_per_gallon,
        current_cost_per_gallon: f.current_cost_per_gallon,
      });
    }
    for (const d of FUEL_DELIVERIES) {
      await ctx.db.insert("fuelDeliveries", {
        tenantId,
        fuel_type: d.fuel_type,
        gallons_delivered: d.gallons_delivered,
        cost_per_gallon: d.cost_per_gallon,
        total_cost: d.total_cost,
        supplier: d.supplier,
        delivery_date: d.delivery_date,
      });
    }
    for (const s of FUEL_SALES) {
      await ctx.db.insert("fuelSales", {
        tenantId,
        fuel_type: s.fuel_type,
        gallons: s.gallons,
        price_per_gallon: s.price_per_gallon,
        total: s.total,
        payment_method: s.payment_method,
        boater_id: s.boater_id ? boaterIdMap.get(s.boater_id) : undefined,
        sold_at: s.sold_at,
      });
    }

    // ── 22. Rental boats + bookings ──────────────────────────
    for (const b of RENTAL_BOATS) {
      const id = await ctx.db.insert("rentalBoats", {
        tenantId,
        name: b.name,
        type: b.type,
        status: b.status,
        hourly_rate: b.hourly_rate,
        half_day_rate: b.half_day_rate,
        full_day_rate: b.full_day_rate,
        capacity: b.capacity,
        notes: b.notes,
      });
      rentalBoatIdMap.set(b.id, id);
    }
    for (const r of BOAT_RENTALS) {
      const boatId = rentalBoatIdMap.get(r.boat_id);
      if (!boatId) continue;
      await ctx.db.insert("boatRentals", {
        tenantId,
        number: r.number,
        boat_id: boatId,
        boater_id: r.boater_id ? boaterIdMap.get(r.boater_id) : undefined,
        patron_name: r.patron_name,
        patron_email: r.patron_email,
        patron_phone: r.patron_phone,
        start_at: r.start_at,
        end_at: r.end_at,
        rate_kind: r.rate_kind,
        base_amount: r.base_amount,
        deposit_hold: r.deposit_hold,
        status: r.status,
        pickup_token: r.pickup_token,
        checkin: r.checkin,
      });
    }

    // ── 23. Communications + events + staff notes ────────────
    for (const c of COMMUNICATIONS) {
      await ctx.db.insert("communications", {
        tenantId,
        boater_id: c.boater_id ? boaterIdMap.get(c.boater_id) : undefined,
        type: c.type,
        direction: c.direction,
        subject: c.subject,
        body_preview: c.body_preview,
        sender_label: c.sender_label,
        sender_is_system: c.sender_is_system,
        recipient: c.recipient,
        sent_at: c.sent_at,
        status: c.status,
        related_entity: c.related_entity,
      });
    }
    for (const e of MARINA_EVENTS) {
      await ctx.db.insert("marinaEvents", {
        tenantId,
        title: e.title,
        type: e.type,
        description: e.description,
        start_at: e.start_at,
        end_at: e.end_at,
        location: e.location,
        attendee_count: e.attendee_count,
      });
    }
    for (const n of STAFF_NOTES) {
      const boaterId = boaterIdMap.get(n.boater_id);
      if (!boaterId) continue;
      await ctx.db.insert("staffNotes", {
        tenantId,
        boater_id: boaterId,
        author_user_id: n.author_user_id ?? "u_seed",
        author_name: n.author_name ?? "Seed",
        body: n.body,
        pinned: n.pinned,
      });
    }

    // ── 24. POS orders (refs boaters + locations + items) ────
    for (const o of POS_ORDERS) {
      const locationId = posLocationIdMap.get(o.location_id);
      if (!locationId) continue;
      await ctx.db.insert("posOrders", {
        tenantId,
        number: o.number,
        location_id: locationId,
        customer_kind: o.customer_kind,
        boater_id: o.boater_id ? boaterIdMap.get(o.boater_id) : undefined,
        patron_name: o.patron_name,
        line_items: o.line_items,
        subtotal: o.subtotal,
        tax: o.tax,
        total: o.total,
        payment_method: o.payment_method,
        status: o.status,
        closed_at: o.closed_at,
        linked_ledger_entry_id: o.linked_ledger_entry_id
          ? ledgerIdMap.get(o.linked_ledger_entry_id)
          : undefined,
        qb_sync_status: o.qb_sync_status,
        qb_ref: o.qb_ref,
      });
    }

    return {
      ok: true,
      tenantId,
      counts: {
        boaters: boaterIdMap.size,
        vessels: vesselIdMap.size,
        docks: dockIdMap.size,
        slips: slipIdMap.size,
        contracts: contractIdMap.size,
        reservations: reservationIdMap.size,
        workOrders: workOrderIdMap.size,
        ledgerEntries: ledgerIdMap.size,
        fees: feeIdMap.size,
        posItems: posItemIdMap.size,
        rentalBoats: rentalBoatIdMap.size,
      },
    };
  },
});

// ──────────────────────────────────────────────────────────────
// Wipe — clears every tenant-scoped table for one marina.
//
// Marina row itself is preserved so we don't lose the
// Clerk-org mapping. Re-running the seed re-populates everything.
// ──────────────────────────────────────────────────────────────

async function wipeTenant(
  ctx: Parameters<typeof runSeed.handler>[0],
  tenantId: Id<"marinas">,
): Promise<void> {
  const tables = [
    "boaters",
    "vessels",
    "staffNotes",
    "waitlistEntries",
    "insuranceCertificates",
    "docks",
    "slips",
    "rentalGroups",
    "rentalSpaces",
    "reservations",
    "contractTemplates",
    "contracts",
    "workOrders",
    "quotes",
    "ledgerEntries",
    "posLocations",
    "posCatalog",
    "posOrders",
    "rates",
    "additionalFees",
    "meterReadings",
    "fuelInventory",
    "fuelDeliveries",
    "fuelSales",
    "rentalBoats",
    "boatRentals",
    "communications",
    "commTemplates",
    "marinaEvents",
    "picklists",
    "auditLog",
    "rateLimits",
    "staffMembers",
    "roles",
    "providerConfigs",
  ] as const;

  for (const table of tables) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_tenant" as never, (q: { eq: (f: "tenantId", v: Id<"marinas">) => unknown }) =>
        q.eq("tenantId", tenantId),
      )
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  }
}
