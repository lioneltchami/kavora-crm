"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewCompanyButton } from "@/components/companies/new-company-button";
import type { CompanySummary } from "@/db/views";

export function CompanyListContent({
  rows,
  hasFilters,
  onClearFilters,
}: {
  rows: CompanySummary[];
  hasFilters?: boolean;
  onClearFilters?: () => void;
}) {
  if (rows.length === 0) {
    if (hasFilters && onClearFilters) {
      return (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">No companies match your filters.</p>
          <Button variant="link" onClick={onClearFilters}>
            Clear filters
          </Button>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="mb-4 text-sm text-muted-foreground">
          No companies yet. Add your first one to get started.
        </p>
        <NewCompanyButton />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {rows.map((c) => (
        <Link key={c.id} href={`/companies/${c.id}`} className="block">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardContent className="p-4">
              <div className="truncate font-semibold">{c.name}</div>
              {c.domain ? (
                <div className="truncate text-xs text-muted-foreground">{c.domain}</div>
              ) : null}
              <div className="mt-2 flex gap-2">
                {c.nb_contacts > 0 ? (
                  <Badge variant="secondary">{c.nb_contacts} contacts</Badge>
                ) : null}
                {c.nb_open_deals > 0 ? <Badge>{c.nb_open_deals} open deals</Badge> : null}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
