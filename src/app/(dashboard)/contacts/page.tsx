import Link from "next/link";
import { db } from "@/db";
import { contacts, KAVORA_ORG_ID } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { formatPhoneForDisplay } from "@/lib/phone";
import { NewContactButton } from "@/components/contacts/new-contact-button";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, KAVORA_ORG_ID))
    .orderBy(desc(contacts.updatedAt))
    .limit(200);

  return (
    <div>
      <PageHeader
        title="Contacts"
        description={`${rows.length} contacts in your CRM. Click any row for the full timeline, AI summaries, and outreach tools.`}
        actions={<NewContactButton />}
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No contacts yet. Add your first lead to get started.
          </p>
          <div className="mt-4">
            <NewContactButton />
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/contacts/${c.id}`} className="hover:underline">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatPhoneForDisplay(c.phone)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        c.status === "customer"
                          ? "success"
                          : c.status === "active"
                            ? "default"
                            : c.status === "archived"
                              ? "secondary"
                              : "outline"
                      }
                    >
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(c.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
