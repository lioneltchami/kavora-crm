import "server-only";
import { adminDb } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditInput = {
  orgId: string;
  actorUserId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Append a row to the audit log.
 *
 * Uses `adminDb` because audit log writes are system-level — they must
 * succeed from contexts that have no Clerk session (Clerk webhooks,
 * Trigger.dev background jobs, cron). The `orgId` field on each row
 * is the explicit source-of-truth for which org the event belongs to,
 * not the JWT claim.
 *
 * Best-effort: failures should not block the user's primary action, so
 * we swallow errors and log them.
 */
export async function logAudit(input: AuditInput): Promise<void> {
  try {
    await adminDb.insert(auditLog).values({
      orgId: input.orgId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      meta: input.meta ?? {},
    });
  } catch (err) {
    console.error("[audit] failed to log", input.action, err);
  }
}
