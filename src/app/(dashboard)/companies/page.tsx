import Link from "next/link";
import { db } from "@/db";
import { companies, contacts, KAVORA_ORG_ID } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewCompanyButton } from "@/components/companies/new-company-button";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      domain: companies.domain,
      industry: companies.industry,
      size: companies.size,
      updatedAt: companies.updatedAt,
      contactCount: sql<number>`COUNT(${contacts.id})::int`,
    })
    .from(companies)
    .leftJoin(contacts, eq(contacts.companyId, companies.id))
    .where(eq(companies.orgId, KAVORA_ORG_ID))
    .groupBy(companies.id)
    .orderBy(desc(companies.updatedAt));

  return (
    <div>
      <PageHeader
        title="Companies"
        description={`${rows.length} companies. Companies group contacts and deals together.`}
        actions={<NewCompanyButton />}
      />

      <div className="overflow-hidden rounded-lg border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Contacts</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No companies yet.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-b transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/companies/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.domain ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.industry ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.size ?? "—"}</td>
                  <td className="px-4 py-3">{c.contactCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
