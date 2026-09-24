import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { companies, contacts, KAVORA_ORG_ID } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), eq(companies.orgId, KAVORA_ORG_ID)))
    .limit(1);
  const company = rows[0];
  if (!company) notFound();

  const companyContacts = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.companyId, id),
        eq(contacts.orgId, KAVORA_ORG_ID),
        isNull(contacts.deletedAt),
      ),
    );

  return (
    <div className="space-y-6">
      <PageHeader title={company.name} description={company.domain ?? undefined} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {companyContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts linked to this company yet.</p>
          ) : (
            <ul className="divide-y">
              {companyContacts.map((c) => (
                <li key={c.id} className="py-2">
                  <Link href={`/contacts/${c.id}`} className="hover:underline">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
