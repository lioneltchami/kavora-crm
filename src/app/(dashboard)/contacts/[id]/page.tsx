import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contacts,
  calls,
  smsMessages,
  notes,
  activities,
  aiSummaries,
  contactEmails,
  contactPhones,
  aiDrafts,
  deals,
  auditLog,
  users,
  KAVORA_ORG_ID,
} from "@/db/schema";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContactTabs, TabsList, TabsTrigger, TabsContent } from "@/components/contacts/contact-tabs";
import { Badge } from "@/components/ui/badge";
import { formatPhoneForDisplay } from "@/lib/phone";
import { ContactActions } from "@/components/contacts/contact-actions";
import { SmsComposer } from "@/components/inbox/sms-composer";
import { NoteComposer } from "@/components/contacts/note-composer";
import { Timeline } from "@/components/contacts/timeline";
import { DraftOutreachButton } from "@/components/contacts/draft-outreach-button";
import { MergeHistoryBadge } from "@/components/contacts/merge-history";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const initialTab = sp.tab ?? "timeline";

  const contactRows = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, id),
        eq(contacts.orgId, KAVORA_ORG_ID),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  const contact = contactRows[0];
  if (!contact) notFound();

  // Most recent merge where this contact was the winner (audit log records the
  // loser as `entity_id`, so we look up via the `meta->>'winnerId'` JSONB key).
  const lastMergeRows = await db
    .select({
      createdAt: auditLog.createdAt,
      actorName: users.name,
      meta: auditLog.meta,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        eq(auditLog.action, "contact.merged"),
        sql`${auditLog.meta}->>'winnerId' = ${id}`,
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  const lastMerge = lastMergeRows[0];
  const mergeMeta = (lastMerge?.meta ?? {}) as Record<string, unknown>;
  const numFromMeta = (key: string): number =>
    typeof mergeMeta[key] === "number" ? (mergeMeta[key] as number) : 0;

  const [emails, phones] = await Promise.all([
    db
      .select()
      .from(contactEmails)
      .where(eq(contactEmails.contactId, id))
      .orderBy(desc(contactEmails.isPrimary), asc(contactEmails.createdAt)),
    db
      .select()
      .from(contactPhones)
      .where(eq(contactPhones.contactId, id))
      .orderBy(desc(contactPhones.isPrimary), asc(contactPhones.createdAt)),
  ]);
  const primaryEmail = emails.find((e) => e.isPrimary) ?? emails[0] ?? null;
  const primaryPhone = phones.find((p) => p.isPrimary) ?? phones[0] ?? null;

  // Fetch activity rows for this contact. The AI summaries FK is `activity_id`,
  // so we look them up via the activity ids (NOT call/sms ids — see Phase 1 review).
  const [contactActivities, contactCalls, contactSms, contactNotes, contactDeals, contactDrafts] =
    await Promise.all([
      db
        .select()
        .from(activities)
        .where(eq(activities.contactId, id))
        .orderBy(desc(activities.occurredAt))
        .limit(50),
      db
        .select()
        .from(calls)
        .where(and(eq(calls.contactId, id), eq(calls.orgId, KAVORA_ORG_ID)))
        .orderBy(desc(calls.createdAt))
        .limit(20),
      db
        .select()
        .from(smsMessages)
        .where(and(eq(smsMessages.contactId, id), eq(smsMessages.orgId, KAVORA_ORG_ID)))
        .orderBy(desc(smsMessages.createdAt))
        .limit(50),
      db
        .select()
        .from(notes)
        .where(and(eq(notes.contactId, id), eq(notes.orgId, KAVORA_ORG_ID)))
        .orderBy(desc(notes.createdAt))
        .limit(20),
      db
        .select()
        .from(deals)
        .where(and(eq(deals.contactId, id), eq(deals.orgId, KAVORA_ORG_ID)))
        .orderBy(desc(deals.updatedAt))
        .limit(20),
      db
        .select()
        .from(aiDrafts)
        .where(and(eq(aiDrafts.contactId, id), eq(aiDrafts.orgId, KAVORA_ORG_ID)))
        .orderBy(desc(aiDrafts.createdAt))
        .limit(10),
    ]);

  // Pull AI summaries by activity id (the FK target).
  const activityIds = contactActivities.map((a) => a.id);
  const summaries = activityIds.length
    ? await db
        .select()
        .from(aiSummaries)
        .where(inArray(aiSummaries.activityId, activityIds))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown contact"}
        description={primaryEmail?.email ?? undefined}
        actions={
          <ContactActions
            contactId={contact.id}
            phone={primaryPhone?.phoneE164 ?? contact.phone}
            firstName={contact.firstName}
            lastName={contact.lastName}
            email={primaryEmail?.email ?? null}
          />
        }
      />

      {lastMerge && (
        <MergeHistoryBadge
          mergedAt={lastMerge.createdAt}
          copiedEmails={numFromMeta("copiedEmails")}
          copiedPhones={numFromMeta("copiedPhones")}
          copiedTags={numFromMeta("copiedTags")}
          actorName={lastMerge.actorName}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Phone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {phones.length === 0 ? (
              <p className="text-sm text-muted-foreground">No phone on file.</p>
            ) : (
              phones.map((p) => (
                <div key={p.id} className="flex items-center justify-between">
                  <span className="font-mono text-lg">{formatPhoneForDisplay(p.phoneE164)}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{p.type}</Badge>
                    {p.isPrimary && <Badge>Primary</Badge>}
                  </div>
                </div>
              ))
            )}
            <div className="pt-2">
              <Badge variant="outline">{contact.status}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Emails</CardTitle>
          </CardHeader>
          <CardContent>
            {emails.length === 0 ? (
              <p className="text-sm text-muted-foreground">No email on file.</p>
            ) : (
              <div className="space-y-2">
                {emails.map((e) => (
                  <div key={e.id} className="flex items-center justify-between">
                    <a
                      href={`mailto:${e.email}`}
                      className="text-sm text-foreground hover:underline"
                    >
                      {e.email}
                    </a>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{e.type}</Badge>
                      {e.isPrimary && <Badge>Primary</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI panel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Generate an outreach draft using RAG over past conversations and your voice style.
            </p>
            <DraftOutreachButton contactId={contact.id} />
            {contactDrafts.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent drafts
                </div>
                {contactDrafts.slice(0, 2).map((d) => (
                  <div key={d.id} className="rounded-md border p-2 text-xs">
                    <Badge variant="outline" className="mb-1">
                      {d.channel}
                    </Badge>
                    <p className="text-muted-foreground">{d.draftBody.slice(0, 200)}…</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ContactTabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="sms">SMS</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="deals">Deals</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <Timeline
            activities={contactActivities}
            calls={contactCalls}
            sms={contactSms}
            summaries={summaries}
          />
        </TabsContent>

        <TabsContent value="sms" className="space-y-4">
          <SmsComposer contactId={contact.id} />
          <div className="space-y-2">
            {contactSms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No SMS yet.</p>
            ) : (
              contactSms.map((s) => (
                <div
                  key={s.id}
                  className={`flex ${s.direction === "outbound" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 text-sm ${
                      s.direction === "outbound"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p>{s.body}</p>
                    <p className="mt-1 text-xs opacity-70">
                      {new Intl.DateTimeFormat("en", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(s.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <NoteComposer contactId={contact.id} />
          <div className="space-y-2">
            {contactNotes.map((n) => (
              <div key={n.id} className="rounded-md border p-3 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(n.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="deals" className="space-y-2">
          {contactDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals yet for this contact.</p>
          ) : (
            contactDeals.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {(d.valueCents / 100).toLocaleString("en-US", {
                      style: "currency",
                      currency: d.currency,
                    })}
                  </div>
                </div>
                <Badge>{d.status}</Badge>
              </div>
            ))
          )}
        </TabsContent>
      </ContactTabs>
    </div>
  );
}
