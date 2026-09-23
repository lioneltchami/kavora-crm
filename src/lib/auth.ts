"use server";

/**
 * Server-side auth helpers.
 *
 * Every server action / route handler that touches user-scoped data must call
 * `requireUser()` (or `requireDbUser()`) to fail closed when unauthenticated.
 */

import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, KAVORA_ORG_ID } from "@/db/schema";
import { logAudit } from "@/lib/audit";

export type AuthedContext = {
  userId: string;
  orgId: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  role: "owner" | "admin" | "member";
  phoneForRouting: string | null;
};

/**
 * Returns the authenticated user context or null. Cheap — no DB.
 */
async function getAuthedContext(): Promise<AuthedContext | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const cu = await currentUser();
  if (!cu) return null;
  return {
    userId,
    orgId: KAVORA_ORG_ID,
    email: cu.emailAddresses[0]?.emailAddress ?? "",
    name: cu.fullName ?? cu.username ?? null,
    imageUrl: cu.imageUrl,
    role: "owner",
    phoneForRouting: null,
  };
}

/**
 * Throws if not authenticated. Use in all server actions.
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
 */
export async function requireDbUser(): Promise<{
  ctx: AuthedContext;
  dbRow: typeof users.$inferSelect;
}> {
  const ctx = await requireUser();

  let row = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
  if (!row) {
    const inserted = await db
      .insert(users)
      .values({
        id: ctx.userId,
        orgId: KAVORA_ORG_ID,
        email: ctx.email,
        name: ctx.name,
        imageUrl: ctx.imageUrl,
        role: "owner",
      })
      .returning();
    row = inserted[0];
    await logAudit({
      orgId: KAVORA_ORG_ID,
      actorUserId: ctx.userId,
      action: "user.provisioned",
      entity: "user",
      entityId: ctx.userId,
    });
  }
  if (!row) throw new Error("Failed to provision user row");

  return {
    ctx: { ...ctx, phoneForRouting: row.phoneForRouting, role: row.role },
    dbRow: row,
  };
}

/**
 * Convenience: just need the orgId, fast.
 */
export async function requireOrgId(): Promise<string> {
  return (await requireUser()).orgId;
}
