"use server";

/**
 * Server-side auth helpers.
 *
 * Every server action / route handler that touches user-scoped data must call
 * `requireUser()` (or `requireDbUser()`) to fail closed when unauthenticated.
 *
 * Kavora is single-tenant per deployment. The active org id is read from
 * `currentOrgId()` (`@/lib/org`), which returns the canonical `KAVORA_ORG_ID`
 * constant. Every provisioned `users` row carries the same `orgId`.
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
   * The active Organization id. In single-tenant mode this is always equal
   * to `KAVORA_ORG_ID`; the field stays a non-empty `string` for
   * forward-compat with a future multi-tenant rollout.
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
 * `orgId` mirrors `currentOrgId()` — i.e. the canonical `KAVORA_ORG_ID`
 * constant in single-tenant mode.
 */
async function getAuthedContext(): Promise<AuthedContext | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const cu = await currentUser();
  if (!cu) return null;
  return {
    userId,
    orgId: currentOrgId(),
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
 * In single-tenant mode `ctx.orgId` is always the canonical `KAVORA_ORG_ID`
 * constant. Callers needing phone / role data from the DB must call
 * `requireDbUser()` instead.
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
 * `currentOrgId()` (always `KAVORA_ORG_ID` in single-tenant mode).
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
    const orgId = currentOrgId();
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
