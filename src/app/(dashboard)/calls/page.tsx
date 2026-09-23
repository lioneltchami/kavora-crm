import Link from "next/link";
import { db } from "@/db";
import { calls, contacts, KAVORA_ORG_ID } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { formatPhoneForDisplay } from "@/lib/phone";
import { RecordingPlayer } from "@/components/calls/recording-player";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const rows = await db
    .select({
      id: calls.id,
      direction: calls.direction,
      status: calls.status,
      fromNumber: calls.fromNumber,
      toNumber: calls.toNumber,
      durationSeconds: calls.durationSeconds,
      startedAt: calls.startedAt,
      createdAt: calls.createdAt,
      contactId: calls.contactId,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      recordingPath: calls.recordingPath,
    })
    .from(calls)
    .leftJoin(contacts, eq(contacts.id, calls.contactId))
    .where(eq(calls.orgId, KAVORA_ORG_ID))
    .orderBy(desc(calls.createdAt))
    .limit(100);

  return (
    <div>
      <PageHeader
        title="Calls"
        description={`${rows.length} recent calls. Click a row to play the recording and read the AI summary.`}
      />
      <div className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls yet.</p>
        ) : (
          rows.map((c) => (
            <div key={c.id} className="rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link
                    href={c.contactId ? `/contacts/${c.contactId}` : "#"}
                    className="font-medium hover:underline"
                  >
                    {[c.contactFirst, c.contactLast].filter(Boolean).join(" ") ||
                      formatPhoneForDisplay(c.direction === "inbound" ? c.fromNumber : c.toNumber)}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={c.direction === "inbound" ? "outline" : "secondary"}>
                      {c.direction}
                    </Badge>
                    <Badge>{c.status}</Badge>
                    <span>
                      {new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(
                        c.startedAt ?? c.createdAt,
                      )}
                    </span>
                    {c.durationSeconds != null && <span>{c.durationSeconds}s</span>}
                  </div>
                </div>
              </div>
              {c.recordingPath && (
                <div className="mt-3">
                  <RecordingPlayer callId={c.id} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
