import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import {
  deals,
  contacts,
  companies,
  pipelineStages,
  KAVORA_ORG_ID,
  notes,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db
    .select({
      deal: deals,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      contactId: contacts.id,
      companyName: companies.name,
      companyId: companies.id,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
    })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(and(eq(deals.id, id), eq(deals.orgId, KAVORA_ORG_ID)))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  const dealNotes = await db
    .select()
    .from(notes)
    .where(and(eq(notes.dealId, id), eq(notes.orgId, KAVORA_ORG_ID)))
    .orderBy(desc(notes.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.deal.title}
        description={`${(row.deal.valueCents / 100).toLocaleString("en-US", {
          style: "currency",
          currency: row.deal.currency,
        })} · ${row.deal.status}`}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent>
            {row.contactId ? (
              <Link href={`/contacts/${row.contactId}`} className="font-medium hover:underline">
                {[row.contactFirst, row.contactLast].filter(Boolean).join(" ")}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">No contact linked</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge style={{ background: row.stageColor ?? undefined }}>{row.stageName}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dealNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            dealNotes.map((n) => (
              <div key={n.id} className="rounded-md border p-3 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(n.createdAt)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
