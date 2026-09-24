"use client";

import { PageHeader } from "@/components/dashboard/page-header";
import { NewContactButton } from "@/components/contacts/new-contact-button";
import { ContactListContent } from "@/components/contacts/contact-list-content";
import { ContactListContentMobile } from "@/components/contacts/contact-list-content-mobile";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ContactSummary } from "@/db/views";

export function ContactList({
  rows,
  q,
  status,
}: {
  rows: ContactSummary[];
  q?: string;
  status?: string;
}) {
  const isMobile = useIsMobile();
  const hasFilters = Boolean(q?.trim() || status);

  return (
    <div>
      <PageHeader
        title="Contacts"
        description={`${rows.length} contact${rows.length === 1 ? "" : "s"} in your CRM. Click any row for the full timeline, AI summaries, and outreach tools.`}
        actions={<NewContactButton />}
      />
      {isMobile ? (
        <ContactListContentMobile rows={rows} hasFilters={hasFilters} />
      ) : (
        <ContactListContent rows={rows} hasFilters={hasFilters} />
      )}
    </div>
  );
}
