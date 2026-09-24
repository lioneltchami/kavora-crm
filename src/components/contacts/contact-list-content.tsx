"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewContactButton } from "@/components/contacts/new-contact-button";
import { formatPhoneForDisplay } from "@/lib/phone";
import type { ContactSummary } from "@/db/views";

export function ContactListContent({
  rows,
  hasFilters,
}: {
  rows: ContactSummary[];
  hasFilters?: boolean;
}) {
  const router = useRouter();

  if (rows.length === 0) {
    if (hasFilters) {
      return (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">No contacts match your filters.</p>
          <Button variant="link" onClick={() => router.replace("/contacts")}>
            Clear filters
          </Button>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="mb-4 text-sm text-muted-foreground">
          No contacts yet. Add your first lead to get started.
        </p>
        <NewContactButton />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Deals</th>
            <th className="px-4 py-3">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const initials = `${c.first_name?.[0] ?? ""}${c.last_name?.[0] ?? ""}`.toUpperCase() || "?";
            return (
              <tr key={c.id} className="border-b transition-colors hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/contacts/${c.id}`} className="flex items-center gap-3 hover:underline">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <span>{[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatPhoneForDisplay(c.phone)}</td>
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
                <td className="px-4 py-3 text-xs text-muted-foreground">{c.nb_deals}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(c.updated_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
