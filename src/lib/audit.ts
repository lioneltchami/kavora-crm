import "server-only";
import { db } from "@/db";
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
 * Append a row to the audit log. Best-effort; failures should not block
 * the user's primary action, so we swallow errors and log them.
 */
export async function logAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
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
