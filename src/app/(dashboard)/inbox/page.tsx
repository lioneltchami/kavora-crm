import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { smsMessages, contacts, KAVORA_ORG_ID } from "@/db/schema";
import { PageHeader } from "@/components/dashboard/page-header";
import { formatPhoneForDisplay } from "@/lib/phone";
import { SmsComposer } from "@/components/inbox/sms-composer";

export const dynamic = "force-dynamic";

/**
 * Threaded inbox: one row per contact that has any inbound SMS.
 * Click a thread to expand the full conversation and reply.
 */
export default async function InboxPage() {
  // Latest inbound per contact + total message count.
  const threads = await db
    .select({
      contactId: smsMessages.contactId,
      lastBody: smsMessages.body,
      lastAt: smsMessages.createdAt,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      contactPhone: contacts.phone,
      total: sql<number>`COUNT(*)::int`,
    })
    .from(smsMessages)
    .leftJoin(contacts, eq(contacts.id, smsMessages.contactId))
    .where(eq(smsMessages.orgId, KAVORA_ORG_ID))
    .groupBy(smsMessages.contactId, contacts.firstName, contacts.lastName, contacts.phone)
    .orderBy(desc(smsMessages.createdAt))
    .limit(50);

  return (
    <div>
      <PageHeader
        title="Inbox"
        description={`${threads.length} conversations. Click a thread to expand and reply.`}
      />
      <div className="divide-y rounded-lg border bg-background">
        {threads.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No SMS yet. Once your Twilio number receives a message, it'll appear here.
          </p>
        ) : (
          threads.map((t) => (
            <details key={t.contactId ?? "unknown"} className="group p-3">
              <summary className="flex cursor-pointer items-start gap-3">
                <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <Link
                      href={t.contactId ? `/contacts/${t.contactId}` : "#"}
                      className="font-medium hover:underline"
                    >
                      {[t.contactFirst, t.contactLast].filter(Boolean).join(" ") ||
                        formatPhoneForDisplay(t.contactPhone)}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(
                        t.lastAt,
                      )}
                      {" · "}
                      {t.total} message{t.total === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="line-clamp-1 text-sm text-muted-foreground">{t.lastBody}</p>
                </div>
              </summary>
              {t.contactId && (
                <div className="mt-3 space-y-3 border-t pt-3">
                  <ThreadMessages contactId={t.contactId} />
                  <SmsComposer contactId={t.contactId} />
                </div>
              )}
            </details>
          ))
        )}
      </div>
    </div>
  );
}

async function ThreadMessages({ contactId }: { contactId: string }) {
  const msgs = await db
    .select({
      id: smsMessages.id,
      body: smsMessages.body,
      direction: smsMessages.direction,
      createdAt: smsMessages.createdAt,
    })
    .from(smsMessages)
    .where(and(eq(smsMessages.contactId, contactId), eq(smsMessages.orgId, KAVORA_ORG_ID)))
    .orderBy(desc(smsMessages.createdAt))
    .limit(50);

  return (
    <div className="max-h-96 space-y-2 overflow-y-auto">
      {msgs.map((s) => (
        <div
          key={s.id}
          className={`flex ${s.direction === "outbound" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-lg p-2 text-sm ${
              s.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            <p className="whitespace-pre-wrap">{s.body}</p>
            <p className="mt-1 text-xs opacity-70">
              {new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(
                s.createdAt,
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
