import { toast } from "sonner";

/**
 * Run a destructive mutation, then surface a Sonner toast with an "Undo"
 * action that runs the inverse mutation if the user clicks it before the
 * toast dismisses.
 *
 * Behavior:
 * 1. `perform()` runs first; if it throws, we toast the error and rethrow —
 *    no Undo toast for failed mutations.
 * 2. If the user clicks "Undo" before the toast dismisses, `undo()` runs.
 * 3. If the toast auto-dismisses (or the user manually closes it), the
 *    change is treated as committed and `wasUndone` resolves to `false`.
 * 4. While the toast is open, a `beforeunload` guard prevents accidental
 *    navigation away (set `guardNavigation: false` to opt out).
 *
 * Reuses Sonner's built-in `duration`, `action`, `onDismiss`, and
 * `onAutoClose` options. The only state owned by this helper is a single
 * deferred for `wasUndone` plus the `beforeunload` listener — no queue,
 * context provider, or undo stack.
 */

export interface UndoableOptions<T> {
  /** Toast body, e.g. "Contact deleted". */
  message: string;
  /** The destructive mutation. Run first; if it throws, no Undo toast appears. */
  perform: () => Promise<T>;
  /** The inverse mutation. Only runs if the user clicks "Undo" in time. */
  undo: () => Promise<void>;
  /** How long the toast stays visible. Default 5000 ms. `Infinity` requires explicit dismissal. */
  durationMs?: number;
  /** Prevent navigation away while the toast is open. Default `true`. */
  guardNavigation?: boolean;
  /** Toast variant. Default `"success"`. */
  type?: "success" | "error" | "info" | "warning";
}

export interface UndoableResult<T> {
  /** The resolved value of `perform()`. */
  result: T;
  /** Resolves `true` if the user clicked "Undo", `false` if the toast dismissed. */
  wasUndone: Promise<boolean>;
}

const BEFOREUNLOAD_MESSAGE =
  "Your last change has not been undone yet. Leave anyway?";

export async function undoable<T>(
  opts: UndoableOptions<T>,
): Promise<UndoableResult<T>> {
  // 1. Run the destructive mutation first. If it fails, surface an error toast
  //    and rethrow — there is nothing to undo at that point.
  let result: T;
  try {
    result = await opts.perform();
  } catch (err) {
    const description = err instanceof Error ? err.message : String(err);
    toast.error(opts.message, { description });
    throw err;
  }

  // 2. Build a deferred the caller can await to know whether the user undid.
  let resolveWasUndone!: (undone: boolean) => void;
  const wasUndone = new Promise<boolean>((resolve) => {
    resolveWasUndone = resolve;
  });
  // Sonner can fire both `onAutoClose` and `onDismiss` for the same toast; the
  // settled flag makes the resolution idempotent.
  let settled = false;
  const settle = (undone: boolean) => {
    if (settled) return;
    settled = true;
    resolveWasUndone(undone);
  };

  const isBrowser = typeof window !== "undefined";
  const guardNavigation = opts.guardNavigation !== false;

  // 3. Optional `beforeunload` guard — installed only after `perform()`
  //    resolves, so the user is not blocked during the mutation itself.
  const beforeUnload = guardNavigation && isBrowser
    ? (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = BEFOREUNLOAD_MESSAGE;
        return BEFOREUNLOAD_MESSAGE;
      }
    : null;

  const removeGuard = () => {
    if (beforeUnload && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", beforeUnload);
    }
  };

  const handleSettled = () => {
    removeGuard();
    settle(false);
  };

  const handleUndo = () => {
    // Mark the user's intent synchronously, before any awaits. Otherwise
    // Sonner's auto-dismiss can race ahead of an in-flight `undo()` and
    // resolve `wasUndone` to `false` even though the user did click Undo.
    removeGuard();
    settle(true);
    void (async () => {
      try {
        await opts.undo();
      } catch (err) {
        console.error("[undoable] undo failed", err);
        toast.error("Failed to undo the last action.");
      } finally {
        toast.dismiss(toastId);
      }
    })();
  };

  // 4. Show the toast. Sonner's queue handles stacking, positioning, etc.
  const toastId = toast[opts.type ?? "success"](opts.message, {
    duration: opts.durationMs ?? 5000,
    action: {
      label: "Undo",
      onClick: () => {
        void handleUndo();
      },
    },
    onDismiss: handleSettled,
    onAutoClose: handleSettled,
  });

  if (beforeUnload && typeof window !== "undefined") {
    window.addEventListener("beforeunload", beforeUnload);
  }

  return { result, wasUndone };
}
