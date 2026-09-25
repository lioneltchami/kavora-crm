import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";

/**
 * The Clerk session's active Organization id, or null.
 *   - No Clerk session             → null
 *   - User has no active org       → null
 *   - User has an active org       → "org_xxxxxx"
 *
 * The *only* canonical seam for "which org is this request scoped to".
 * Server Actions, route handlers, and audit-log calls read it through here.
 */
export const currentOrgId = cache(async (): Promise<string | null> => {
  const { orgId } = await auth();
  return orgId ?? null;
});

/**
 * Throws `NO_ACTIVE_ORG` if there is no active Clerk organization for the
 * current session. Use only at boundaries where the rest of the code cannot
 * tolerate a missing orgId (e.g. writing to a table that requires `org_id`).
 */
export async function requireOrgId(): Promise<string> {
  const id = await currentOrgId();
  if (!id) throw new Error("NO_ACTIVE_ORG");
  return id;
}
