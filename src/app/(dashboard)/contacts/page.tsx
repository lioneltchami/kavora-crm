import { listContacts } from "@/actions/contacts";
import { ContactList } from "@/components/contacts/contact-list";

export const dynamic = "force-dynamic";

const CONTACT_STATUSES = ["lead", "active", "customer", "archived"] as const;
type ContactStatus = (typeof CONTACT_STATUSES)[number];

function parseStatus(raw?: string): ContactStatus | undefined {
  return CONTACT_STATUSES.includes(raw as ContactStatus) ? (raw as ContactStatus) : undefined;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const status = parseStatus(sp.status);
  const rows = await listContacts({ q: sp.q, status, limit: 200 });
  return <ContactList rows={rows} q={sp.q} status={status} />;
}
