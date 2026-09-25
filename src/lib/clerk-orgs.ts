/**
 * Clerk Organizations webhook handlers.
 *
 * The webhook route handler (`src/app/api/webhooks/clerk/route.ts`) verifies
 * the Svix signature, then dispatches the verified event to one of the four
 * helpers below. Putting the data work here keeps the route handler thin and
 * lets the integration tests target these functions directly.
 *
 * Convention:
 *   - Each handler returns when the operation is complete; failures throw so
 *     the route returns 500 (Clerk will retry).
 *   - `KAVORA_ORG_ID` is only ever used as a defensive fallback when the
 *     Clerk payload omits an organization id. We log a warning instead of
 *     throwing so a malformed event never bricks the webhook. Kept as a
 *     known DEPRECATED seam pending a redesign of the user-creation flow so
 *     placeholders are not needed.
 */

import { eq, and } from "drizzle-orm";
import { db, adminDb } from "@/db";
import { organizations, users, KAVORA_ORG_ID } from "@/db/schema";
import { logAudit } from "@/lib/audit";

export type ClerkOrgPayload = {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
};

export type ClerkOrgMembershipPayload = {
  id?: string | null;
  organization?: { id?: string | null; name?: string | null; slug?: string | null } | null;
  public_user_data?: { user_id?: string | null } | null;
};

/**
 * `organization.created` / `organization.updated` — upsert the row keyed on
 * Clerk's `id`. The schema's `organizations` table currently exposes `id`,
 * `name`, and `created_at`; we mirror those. When a `slug` column is added in
 * a future migration, extend this insert to include `slug: payload.slug ?? null`.
 *
 * Uses `db` because the `organizations` table is intentionally NOT RLS-protected
 * (see `src/db/migrations/0007_enable_rls.sql` — Builder 3 deliberately excluded
 * it so seed + webhook can upsert). If we ever enable RLS on `organizations`,
 * switch this to `adminDb`.
 */
export async function upsertOrganization(payload: ClerkOrgPayload): Promise<void> {
  const id = payload.id;
  const name = payload.name ?? "";
  if (!id) {
    console.warn("[clerk-orgs] upsertOrganization: missing id, skipping", payload);
    return;
  }
  await db
    .insert(organizations)
    .values({ id, name })
    .onConflictDoUpdate({
      target: organizations.id,
      set: { name },
    });
}

/**
 * `organization.deleted` — drop the row. Missing id → warn + no-op.
 */
export async function deleteOrganization(payload: { id?: string | null }): Promise<void> {
  const id = payload.id;
  if (!id) {
    console.warn("[clerk-orgs] deleteOrganization: missing id, skipping");
    return;
  }
  await db.delete(organizations).where(eq(organizations.id, id));
}

/**
 * `organizationMembership.created` / `.updated` — point the user's `orgId` at
 * the new organization and audit the join.
 *
 * Uses `adminDb` because the webhook has no Clerk session, so RLS would
 * silently block the `users` write and the `audit_log` insert.
 */
export async function attachMembership(payload: ClerkOrgMembershipPayload): Promise<void> {
  const userId = payload.public_user_data?.user_id;
  const orgId = payload.organization?.id;
  if (!userId) {
    console.warn("[clerk-orgs] attachMembership: missing public_user_data.user_id, skipping");
    return;
  }
  const resolvedOrgId = orgId ?? KAVORA_ORG_ID;
  if (!orgId) {
    console.warn("[clerk-orgs] attachMembership: missing organization.id, falling back to KAVORA_ORG_ID");
  }
  await adminDb.update(users).set({ orgId: resolvedOrgId }).where(eq(users.id, userId));
  await logAudit({
    orgId: resolvedOrgId,
    actorUserId: userId,
    action: "user.joined_org",
    entity: "user",
    entityId: userId,
    meta: { source: "clerk_webhook" },
  });
}

/**
 * `organizationMembership.deleted` — clear the user's `orgId` only when it
 * matches the org they were removed from, and audit the leave.
 *
 * Uses `adminDb` for the same reason as `attachMembership`.
 */
export async function detachMembership(payload: ClerkOrgMembershipPayload): Promise<void> {
  const userId = payload.public_user_data?.user_id;
  const orgId = payload.organization?.id;
  if (!userId) {
    console.warn("[clerk-orgs] detachMembership: missing public_user_data.user_id, skipping");
    return;
  }
  if (!orgId) {
    console.warn("[clerk-orgs] detachMembership: missing organization.id, skipping");
    return;
  }
  await adminDb
    .update(users)
    .set({ orgId: "" })
    .where(and(eq(users.id, userId), eq(users.orgId, orgId)));
  await logAudit({
    orgId: orgId ?? KAVORA_ORG_ID,
    actorUserId: userId,
    action: "user.left_org",
    entity: "user",
    entityId: userId,
    meta: { source: "clerk_webhook" },
  });
}
