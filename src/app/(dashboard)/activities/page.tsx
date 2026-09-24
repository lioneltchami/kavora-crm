import { db } from "@/db";
import { activities, KAVORA_ORG_ID } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { formatDistanceToNow } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const ACTIVITY_TYPES = [
  "call",
  "sms",
  "note",
  "email",
  "meeting",
  "stage-change",
] as const;

export default async function ActivityPage() {
  const rows = await db
    .select()
    .from(activities)
    .where(eq(activities.orgId, KAVORA_ORG_ID))
    .orderBy(desc(activities.occurredAt))
    .limit(200);

  return (
    <div>
      <PageHeader
        title="Activity"
        description={`${rows.length} events across contacts and deals.`}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((a) => (
            <li key={a.id} className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <div className="w-32 shrink-0 text-xs text-muted-foreground">
                {formatDistanceToNow(a.occurredAt)}
              </div>
              <div className="flex-1">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase">
                  {a.type}
                </span>
                <span className="ml-2">{a.summary}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {ACTIVITY_TYPES.map((t) => (
          <span key={t} className="mr-3">
            {t}: {rows.filter((r) => r.type === t).length}
          </span>
        ))}
      </p>
    </div>
  );
}
