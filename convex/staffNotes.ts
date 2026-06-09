import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  requireTenant,
  requireTenantAndUser,
} from "./_helpers";

export const listForBoater = query({
  args: { boaterId: v.id("boaters") },
  handler: async (ctx, { boaterId }) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("staffNotes")
      .withIndex("by_tenant_boater", (q) =>
        q.eq("tenantId", tenantId).eq("boater_id", boaterId),
      )
      .collect();
  },
});

export const add = mutation({
  args: { boater_id: v.id("boaters"), body: v.string(), pinned: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { tenantId, userId, userLabel } = await requireTenantAndUser(ctx);
    const id = await ctx.db.insert("staffNotes", {
      tenantId,
      boater_id: args.boater_id,
      author_user_id: userId,
      author_name: userLabel,
      body: args.body,
      pinned: args.pinned ?? false,
    });
    await logAudit(ctx, {
      action_type: "staff_note.create",
      target_entity: "staffNotes",
      target_id: id,
    });
    return id;
  },
});

export const togglePinned = mutation({
  args: { id: v.id("staffNotes") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { pinned: !before.pinned });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("staffNotes") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "staff_note.delete",
      target_entity: "staffNotes",
      target_id: id,
    });
    return id;
  },
});
