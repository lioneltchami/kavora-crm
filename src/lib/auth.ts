"use server";

/**
 * Server-side auth helpers.
 *
 * Every server action / route handler that touches user-scoped data must call
 * `requireUser()` (or `requireDbUser()`) to fail closed when unauthenticated.
 *
 * The active org id is **always** read from the Clerk session via
 * `currentOrgId()` (`@/lib/org`). There is no constant fallback — when the
 * session has no active Clerk Organization we expose `""` (an empty-string
 * sentinel) on `AuthedContext.orgId`. Code that needs a guaranteed non-null
 * orgId must go through `requireDbUser()` (which sources it from the
 * provisioned `users` row, throwing if no row exists and no Clerk org is
 * active) or the `requireOrgId()` helper from `@/lib/org`.
 */

import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currentOrgId } from "@/lib/org";
import { logAudit } from "@/lib/audit";

export type AuthedContext = {
  userId: string;
  /**
   * The Clerk session's active Organization id, or `""` when the user has
   * no active org. Empty-string is an honest sentinel — code that needs a
   * guaranteed non-null orgId must go through `requireDbUser()` or
   * `requireOrgId()` (`@/lib/org`). Kept non-null in the type for backward
   * compatibility with the dozens of `eq(contacts.orgId, ctx.orgId)` call
   * sites that previously assumed a hard-coded "kavora" string.
   */
  orgId: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  role: "owner" | "admin" | "member";
  phoneForRouting: string | null;
};

/**
 * Returns the authenticated user context or null. Cheap — no DB.
 *
 * `orgId` mirrors the Clerk session. When the session has no active Clerk
 * Organization we expose `""` (empty-string sentinel). Callers that cannot
 * tolerate a missing org must call `requireDbUser()` instead.
 */
async function getAuthedContext(): Promise<AuthedContext | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const cu = await currentUser();
  if (!cu) return null;
  return {
    userId,
    orgId: (await currentOrgId()) ?? "",
    email: cu.emailAddresses[0]?.emailAddress ?? "",
    name: cu.fullName ?? cu.username ?? null,
    imageUrl: cu.imageUrl,
    role: "owner",
    phoneForRouting: null,
  };
}

/**
 * Throws if not authenticated. Use in all server actions.
 *
 * Note: `ctx.orgId` may be `""` for users who have no active Clerk
 * Organization. Code that needs a guaranteed orgId must call
 * `requireDbUser()` (which routes through `currentOrgId()` for the
 * auto-provision path) or `requireOrgId()` from `@/lib/org`.
 */
export async function requireUser(): Promise<AuthedContext> {
  const ctx = await getAuthedContext();
  if (!ctx) throw new Error("UNAUTHORIZED");
  return ctx;
}

/**
 * Loads the local user row (auto-provisions if missing — covers cold starts
 * where the Clerk webhook hasn't fired yet). Use this when you need phone /
 * role data that lives in our DB.
 *
 * On the auto-provision path the new `users` row's `orgId` is sourced from
 * `currentOrgId()` — never from a hardcoded fallback. If `currentOrgId()`
 * is null and the user has no DB row yet, we throw rather than silently
 * inventing an org context.
 *
 * The returned `ctx.orgId` always reflects the DB row's orgId (a real,
 * non-empty string), which is what callers downstream rely on.
 */
export async function requireDbUser(): Promise<{
  ctx: AuthedContext;
  dbRow: typeof users.$inferSelect;
}> {
  const ctx = await requireUser();

  let row = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
  if (!row) {
    const orgId = await currentOrgId();
    if (!orgId) {
      throw new Error("No active organization");
    }
    const inserted = await db
      .insert(users)
      .values({
        id: ctx.userId,
        orgId,
        email: ctx.email,
        name: ctx.name,
        imageUrl: ctx.imageUrl,
        role: "owner",
      })
      .returning();
    row = inserted[0];
    if (row) {
      await logAudit({
        orgId,
        actorUserId: ctx.userId,
        action: "user.provisioned",
        entity: "user",
        entityId: ctx.userId,
      });
    }
  }
  if (!row) throw new Error("Failed to provision user row");

  return {
    ctx: {
      ...ctx,
      orgId: row.orgId,
      phoneForRouting: row.phoneForRouting,
      role: row.role,
    },
    dbRow: row,
  };
}
