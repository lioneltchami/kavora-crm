"use client";

import { useEffect, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { GitMerge, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { listContacts } from "@/actions/contacts";
import { mergeContact, type MergeContactResult } from "@/actions/merge-contacts";
import { formatPhoneForDisplay } from "@/lib/phone";
import type { ContactSummary } from "@/db/views";

interface MergeContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  winner: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
  onMerged?: (result: { copiedEmails: number; copiedPhones: number }) => void;
}

function displayName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ") || "—";
}

export function MergeContactDialog({
  open,
  onOpenChange,
  winner,
  onMerged,
}: MergeContactDialogProps) {
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickedLoser, setPickedLoser] = useState<ContactSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const winnerName = displayName(winner.firstName, winner.lastName);

  // Reset internal state whenever the dialog is closed.
  useEffect(() => {
    if (open) return;
    setStep("pick");
    setQuery("");
    setResults([]);
    setPickedLoser(null);
    setSubmitting(false);
  }, [open]);

  // Debounced search: listContacts already filters out soft-deleted rows.
  useEffect(() => {
    if (!open || step !== "pick") return;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await listContacts({
          q: query.trim() || undefined,
          limit: 10,
        });
        // Winner is excluded — you can't merge a contact into itself.
        setResults(rows.filter((r) => r.id !== winner.id));
      } catch {
        // Keep the previous results so the user doesn't lose context on a
        // transient network blip; toast is intentionally omitted to avoid spam.
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open, step, winner.id]);

  async function onConfirm() {
    if (!pickedLoser) return;
    setSubmitting(true);
    try {
      // mergeContact currently returns void and redirects server-side; the cast
      // keeps us forward-compatible if/when it starts returning
      // MergeContactResult instead of navigating.
      const result = (await mergeContact({
        winnerId: winner.id,
        loserId: pickedLoser.id,
      })) as unknown as MergeContactResult | undefined;
      const copiedEmails = result?.copiedEmails ?? 0;
      const copiedPhones = result?.copiedPhones ?? 0;
      toast.success(
        `Merged. Copied ${copiedEmails} email(s) and ${copiedPhones} phone(s).`,
      );
      onMerged?.({ copiedEmails, copiedPhones });
      onOpenChange(false);
    } catch (err) {
      // Let Next.js handle redirects, not-found, etc. without an error toast.
      unstable_rethrow(err);
      toast.error(err instanceof Error ? err.message : "Could not merge contacts");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4" /> Merge contacts
          </DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? `Pick the duplicate to merge into ${winnerName}.`
              : `Confirm the merge. The loser will be deleted.`}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search by name, email, or phone…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              {results.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {searching ? "Searching…" : "No matching contacts."}
                </p>
              ) : (
                <ul className="divide-y">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPickedLoser(c);
                          setStep("confirm");
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {displayName(c.first_name, c.last_name)}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {c.email ?? "—"} · {formatPhoneForDisplay(c.phone)}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          <span>{c.nb_deals}d</span>
                          <span>{c.nb_calls}c</span>
                          <span>{c.nb_sms}s</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          pickedLoser && (
            <div className="space-y-4">
              <p className="text-sm">
                Merge{" "}
                <span className="font-semibold">
                  {displayName(pickedLoser.first_name, pickedLoser.last_name)}
                </span>{" "}
                into <span className="font-semibold">{winnerName}</span>?
              </p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border p-3">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Winner
                  </div>
                  <div className="text-sm font-medium">{winnerName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {winner.email ?? "—"}
                  </div>
                  <div className="flex gap-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>keeps own emails & phones</span>
                  </div>
                </div>
                <GitMerge className="h-4 w-4 text-muted-foreground" />
                <div className="space-y-1 text-right">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Loser
                  </div>
                  <div className="text-sm font-medium">
                    {displayName(pickedLoser.first_name, pickedLoser.last_name)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {pickedLoser.email ?? "—"}
                  </div>
                  <div className="flex justify-end gap-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>{pickedLoser.nb_deals}d</span>
                    <span>{pickedLoser.nb_calls}c</span>
                    <span>{pickedLoser.nb_sms}s</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Activities on the loser (notes, deals, calls, SMS, AI drafts) are
                reassigned to the winner. Duplicate emails and phones are skipped.
              </p>
            </div>
          )
        )}

        <DialogFooter>
          {step === "pick" ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("pick")}
                disabled={submitting}
              >
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => void onConfirm()}
                disabled={submitting}
              >
                {submitting ? "Merging…" : "Confirm merge"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
