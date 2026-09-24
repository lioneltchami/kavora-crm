import { listContacts } from "@/actions/contacts";
import { ContactList } from "@/components/contacts/contact-list";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status as "lead" | "active" | "customer" | "archived" | undefined;
  const rows = await listContacts({ q: sp.q, status, limit: 200 });
  return <ContactList rows={rows} q={sp.q} status={sp.status} />;
}
