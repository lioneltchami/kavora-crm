import { GitMerge } from "lucide-react";

interface MergeHistoryBadgeProps {
  mergedAt: Date;
  copiedEmails: number;
  copiedPhones: number;
  copiedTags: number;
  actorName?: string | null;
}

/**
 * Surfaces the most-recent merge audit entry for the winner contact on its
 * detail page. Shown only when a merge actually exists (caller decides).
 */
export function MergeHistoryBadge({
  mergedAt,
  copiedEmails,
  copiedPhones,
  copiedTags,
  actorName,
}: MergeHistoryBadgeProps) {
  const formattedDate = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(mergedAt);

  const copiedParts = [
    copiedEmails > 0 ? `${copiedEmails} email${copiedEmails === 1 ? "" : "s"}` : null,
    copiedPhones > 0 ? `${copiedPhones} phone${copiedPhones === 1 ? "" : "s"}` : null,
    copiedTags > 0 ? `${copiedTags} tag${copiedTags === 1 ? "" : "s"}` : null,
  ].filter((s): s is string => s !== null);

  return (
    <div className="flex gap-3 rounded-md border p-3 text-sm">
      <div className="mt-0.5">
        <GitMerge className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 space-y-1">
        <div>
          <span className="text-foreground">
            Merged with another contact on{" "}
            <span className="font-medium">{formattedDate}</span>
          </span>
          {actorName && <span className="text-muted-foreground"> by {actorName}</span>}
        </div>
        {copiedParts.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Copied {copiedParts.join(", ")}.
          </div>
        )}
      </div>
    </div>
  );
}