import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const statusV = v.union(
  v.literal("invited"),
  v.literal("active"),
  v.literal("suspended"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("staffMembers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const invite = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    role_id: v.id("roles"),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const role = await ctx.db.get(args.role_id);
    assertOwnedByTenant(role, tenantId);
    const id = await ctx.db.insert("staffMembers", {
      tenantId,
      name: args.name,
      email: args.email,
      phone: args.phone,
      role_id: args.role_id,
      status: "invited",
      mfa_enabled: false,
    });
    await logAudit(ctx, {
      action_type: "staff.invite",
      target_entity: "staffMembers",
      target_id: id,
      payload_delta: { name: args.name, role: role.name },
    });
    return id;
  },
});

/**
 * Create a staff record outright (no invite token). Used by the Staff
 * Roster's "New staff" sheet — the operator fills in the full wage
 * profile up front. `status` defaults to "invited" so the Clerk invite
 * flow can still attach later.
 */
export const create = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    role_id: v.optional(v.id("roles")),
    status: v.optional(statusV),
    mfa_enabled: v.optional(v.boolean()),
    default_position: v.optional(v.string()),
    employment_type: v.optional(v.string()),
    hourly_rate: v.optional(v.number()),
    salary_annual: v.optional(v.number()),
    mobile_clock_pin: v.optional(v.string()),
    pto_hours_balance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    // role_id is optional from the page sheet ("No app access" path); if
    // present we cross-tenant guard it.
    if (args.role_id) {
      const role = await ctx.db.get(args.role_id);
      assertOwnedByTenant(role, tenantId);
    }
    // The schema currently requires role_id. We accept undefined from
    // the page when the operator picks "— No app access —", but Convex
    // needs *something* — pick the first role for the tenant as a
    // placeholder. The page UI still shows the role select empty until
    // an explicit choice is made.
    let roleId = args.role_id;
    if (!roleId) {
      const firstRole = await ctx.db
        .query("roles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .first();
      if (!firstRole) {
        throw new Error("Cannot create staff — tenant has no roles yet");
      }
      roleId = firstRole._id;
    }
    const id = await ctx.db.insert("staffMembers", {
      tenantId,
      name: args.name,
      email: args.email,
      phone: args.phone,
      role_id: roleId,
      status: args.status ?? "invited",
      mfa_enabled: args.mfa_enabled ?? false,
      default_position: args.default_position,
      employment_type: args.employment_type,
      hourly_rate: args.hourly_rate,
      salary_annual: args.salary_annual,
      mobile_clock_pin: args.mobile_clock_pin,
      pto_hours_balance: args.pto_hours_balance,
    });
    await logAudit(ctx, {
      action_type: "staff.create",
      target_entity: "staffMembers",
      target_id: id,
      payload_delta: { name: args.name, position: args.default_position },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("staffMembers"),
    patch: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      role_id: v.optional(v.id("roles")),
      status: v.optional(statusV),
      mfa_enabled: v.optional(v.boolean()),
      default_position: v.optional(v.string()),
      employment_type: v.optional(v.string()),
      hourly_rate: v.optional(v.number()),
      salary_annual: v.optional(v.number()),
      mobile_clock_pin: v.optional(v.string()),
      pto_hours_balance: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (patch.role_id) {
      const role = await ctx.db.get(patch.role_id);
      assertOwnedByTenant(role, tenantId);
    }
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "staff.update",
      target_entity: "staffMembers",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

export const suspend = mutation({
  args: { id: v.id("staffMembers") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { status: "suspended" });
    await logAudit(ctx, {
      action_type: "staff.suspend",
      target_entity: "staffMembers",
      target_id: id,
    });
    return id;
  },
});

/**
 * Hard-delete a staff member. Matches the mock-store
 * `deleteStaffMember` semantics (Roster page's edit sheet has no
 * dedicated delete, but the agent + future UI surfaces need this).
 * Audit row preserves the name so reporting can still resolve the
 * actor history.
 */
export const remove = mutation({
  args: { id: v.id("staffMembers") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "staff.delete",
      target_entity: "staffMembers",
      target_id: id,
      payload_delta: { name: before.name, email: before.email },
    });
    return id;
  },
});
