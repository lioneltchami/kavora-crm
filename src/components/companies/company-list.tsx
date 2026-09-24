"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Search } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewCompanyButton } from "@/components/companies/new-company-button";
import { Input } from "@/components/ui/input";
import { CompanyListContent } from "./company-list-content";
import { CompanyListContentMobile } from "./company-list-content-mobile";
import type { CompanySummary } from "@/db/views";

export function CompanyList({ rows }: { rows: CompanySummary[] }) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const q = params.get("q") ?? "";
  const hasFilters = q.length > 0;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = String(fd.get("q") ?? "").trim();
    const sp = new URLSearchParams(params.toString());
    if (next) sp.set("q", next);
    else sp.delete("q");
    startTransition(() => {
      router.replace(sp.toString() ? `/companies?${sp.toString()}` : "/companies");
    });
  }

  function onClearFilters() {
    startTransition(() => {
      router.replace("/companies");
    });
  }

  return (
    <div>
      <PageHeader
        title="Companies"
        description={`${rows.length} companies. Companies group contacts and deals together.`}
        actions={<NewCompanyButton />}
      />
      <form onSubmit={onSubmit} className="mb-4 relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search name, domain, industry…"
          className="pl-9"
        />
      </form>
      {isMobile ? (
        <CompanyListContentMobile
          rows={rows}
          hasFilters={hasFilters}
          onClearFilters={onClearFilters}
        />
      ) : (
        <CompanyListContent
          rows={rows}
          hasFilters={hasFilters}
          onClearFilters={onClearFilters}
        />
      )}
    </div>
  );
}
