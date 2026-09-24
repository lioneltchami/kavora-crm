"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewContactButton } from "@/components/contacts/new-contact-button";
import { formatPhoneForDisplay } from "@/lib/phone";
import type { ContactSummary } from "@/db/views";

export function ContactListContentMobile({
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
    <div className="space-y-2">
      {rows.map((c) => {
        const initials = `${c.first_name?.[0] ?? ""}${c.last_name?.[0] ?? ""}`.toUpperCase() || "?";
        return (
          <Link
            key={c.id}
            href={`/contacts/${c.id}`}
            className="flex items-center gap-3 rounded-lg border bg-background p-3 hover:bg-muted/30"
          >
            <Avatar className="h-10 w-10">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {c.email ?? formatPhoneForDisplay(c.phone)}
              </div>
              {c.nb_deals > 0 ? (
                <div className="mt-1 text-xs text-muted-foreground">{c.nb_deals} deal{c.nb_deals === 1 ? "" : "s"}</div>
              ) : null}
            </div>
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
          </Link>
        );
      })}
    </div>
  );
}
