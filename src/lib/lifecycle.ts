import "server-only";
import { revalidatePath } from "next/cache";
import type { AuthedContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

/**
 * Options for `withLifecycleCallbacks`.
 *
 * `ctx` is the pre-resolved auth context from `requireDbUser()`. The wrapper
 * does not call `requireDbUser()` itself — the caller picks the resolution
 * strategy (`requireUser` for cheap reads, `requireDbUser` when you need the
 * provisioned row).
 */
export interface LifecycleCallbacks<TReturn> {
  ctx: AuthedContext;
  action: string;
  entity: string;
  entityId: string;
  meta?: Record<string, unknown>;
  revalidate?: readonly string[];
  onSuccess?: (result: TReturn) => void;
}

/**
 * Run a server-action mutation and, on success, centralize the audit +
 * revalidate boilerplate that every mutation currently ends with.
 *
 * Behavior:
 * 1. `perform(ctx)` runs the actual mutation. If it throws, the wrapper
 *    does not catch — errors propagate, no audit row is written.
 * 2. If `perform` returns a falsy value (e.g. `undefined` for a no-op update
 *    that affected zero rows), the wrapper skips audit + revalidate. This
 *    preserves the existing "nothing changed → nothing logged" pattern.
 * 3. Otherwise the wrapper writes the audit row, revalidates every listed
 *    path, and invokes `onSuccess` for caller-side concerns (toasts, etc.).
 *
 * Scope is intentionally narrow: audit + revalidate + a success hook. No
 * error wrapping, no rollback, no toast logic — caller composes those if
 * needed (mirrors the layering in `lib/undoable.ts`).
 */
export async function withLifecycleCallbacks<TReturn>(
  callbacks: LifecycleCallbacks<TReturn>,
  perform: (ctx: AuthedContext) => Promise<TReturn | undefined | void>,
): Promise<TReturn | undefined | void> {
  const result = await perform(callbacks.ctx);
  if (!result) return result;

  await logAudit({
    orgId: callbacks.ctx.orgId,
    actorUserId: callbacks.ctx.userId,
    action: callbacks.action,
    entity: callbacks.entity,
    entityId: callbacks.entityId,
    meta: callbacks.meta,
  });

  for (const path of callbacks.revalidate ?? []) {
    revalidatePath(path);
  }

  callbacks.onSuccess?.(result);
  return result;
}
