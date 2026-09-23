import { Phone, MessageSquare, FileText, ArrowRightCircle } from "lucide-react";
import type { Activity, Call, SmsMessage, AiSummary } from "@/db/schema";
import { RecordingPlayer } from "@/components/calls/recording-player";

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
  const summaryByCallId = new Map(
    activities
      .filter((a) => a.type === "call")
      .map((a) => [a.refId, summaryByActivity.get(a.id)]),
  );

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
      | { kind: "activity"; activity: Activity; call?: Call }
      | { kind: "legacy-call"; call: Call }
      | { kind: "legacy-sms"; sms: SmsMessage };
  }> = [];

  for (const a of activities) {
    // If this activity references a call, attach the Call row so we can render
    // the recording player + call metadata alongside the AI summary.
    const linkedCall =
      a.type === "call" && a.refId
        ? calls.find((c) => c.id === a.refId)
        : undefined;
    items.push({
      key: `activity-${a.id}`,
      kind: a.type,
      date: a.occurredAt,
      summary: summaryByActivity.get(a.id),
      payload: { kind: "activity", activity: a, call: linkedCall },
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

        const callRow =
          item.payload.kind === "activity"
            ? item.payload.call
            : item.payload.kind === "legacy-call"
              ? item.payload.call
              : undefined;
        const summary =
          item.payload.kind === "activity"
            ? item.summary ?? (callRow ? summaryByCallId.get(callRow.id) : undefined)
            : item.summary;

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
              {callRow && (
                <p className="text-sm">
                  {callRow.direction} call · {callRow.status}
                  {callRow.durationSeconds ? ` · ${callRow.durationSeconds}s` : ""}
                </p>
              )}
              {callRow?.recordingPath && (
                <div className="pt-1">
                  <RecordingPlayer callId={callRow.id} />
                </div>
              )}
              {item.payload.kind === "legacy-sms" && (
                <p className="text-sm">{item.payload.sms.body}</p>
              )}
              {summary && (
                <div className="rounded-md bg-muted p-2 text-xs">
                  <p className="font-medium">AI summary</p>
                  <p className="text-muted-foreground">{summary.summary}</p>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
