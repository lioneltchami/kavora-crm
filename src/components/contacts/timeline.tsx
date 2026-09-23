import { Phone, MessageSquare, FileText, ArrowRightCircle } from "lucide-react";
import type { Activity, Call, SmsMessage, AiSummary } from "@/db/schema";

export function Timeline({
  activities,
  calls,
  sms,
  summaries,
}: {
  activities: Activity[];
  calls: Call[];
  sms: SmsMessage[];
  /** Keyed by `activities.id` (the activity row, not the call/sms itself). */
  summaries: AiSummary[];
}) {
  const summaryByActivity = new Map(summaries.map((s) => [s.activityId, s]));

  if (activities.length === 0 && calls.length === 0 && sms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No activity yet. Once you call, text, or take notes, they'll appear here.
      </p>
    );
  }

  // Build a unified list, then dedupe: each call/sms ALSO has an activity row
  // (created in `actions/communications.ts` + `actions/notes.ts`). We render
  // the polymorphic activity as the timeline entry, and join the AI summary
  // via the activity id. Pre-existing call/sms rows without an activity row
  // are shown as legacy entries.
  const items: Array<{
    key: string;
    kind: "call" | "sms" | "note" | "stage-change" | "email" | "meeting";
    date: Date;
    summary: AiSummary | undefined;
    payload:
      | { kind: "activity"; activity: Activity }
      | { kind: "legacy-call"; call: Call }
      | { kind: "legacy-sms"; sms: SmsMessage };
  }> = [];

  for (const a of activities) {
    items.push({
      key: `activity-${a.id}`,
      kind: a.type,
      date: a.occurredAt,
      summary: summaryByActivity.get(a.id),
      payload: { kind: "activity", activity: a },
    });
  }

  // Surface call/sms rows that DON'T have an activity row yet (legacy / mid-pipeline).
  const activityCallSids = new Set(
    activities.filter((a) => a.type === "call").map((a) => a.refId),
  );
  const activitySmsSids = new Set(
    activities.filter((a) => a.type === "sms").map((a) => a.refId),
  );
  for (const c of calls) {
    if (activityCallSids.has(c.id)) continue;
    items.push({
      key: `legacy-call-${c.id}`,
      kind: "call",
      date: c.createdAt,
      summary: undefined,
      payload: { kind: "legacy-call", call: c },
    });
  }
  for (const s of sms) {
    if (activitySmsSids.has(s.id)) continue;
    items.push({
      key: `legacy-sms-${s.id}`,
      kind: "sms",
      date: s.createdAt,
      summary: undefined,
      payload: { kind: "legacy-sms", sms: s },
    });
  }

  items.sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <ol className="space-y-3">
      {items.map((item) => {
        const Icon =
          item.kind === "call"
            ? Phone
            : item.kind === "sms"
              ? MessageSquare
              : item.kind === "stage-change"
                ? ArrowRightCircle
                : FileText;

        return (
          <li key={item.key} className="flex gap-3 rounded-md border p-3">
            <div className="mt-0.5">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium uppercase">{item.kind}</span>
                <span>
                  {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
                    item.date,
                  )}
                </span>
              </div>
              {item.payload.kind === "activity" && item.payload.activity.type === "note" && (
                <p className="whitespace-pre-wrap text-sm">{item.payload.activity.summary}</p>
              )}
              {item.payload.kind === "legacy-call" && (
                <p className="text-sm">
                  {item.payload.call.direction} call · {item.payload.call.status}
                  {item.payload.call.durationSeconds
                    ? ` · ${item.payload.call.durationSeconds}s`
                    : ""}
                </p>
              )}
              {item.payload.kind === "legacy-sms" && (
                <p className="text-sm">{item.payload.sms.body}</p>
              )}
              {item.summary && (
                <div className="rounded-md bg-muted p-2 text-xs">
                  <p className="font-medium">AI summary</p>
                  <p className="text-muted-foreground">{item.summary.summary}</p>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
