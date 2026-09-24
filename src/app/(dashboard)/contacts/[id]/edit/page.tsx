import { notFound } from "next/navigation";
import { getContact } from "@/actions/contacts";
import { listCompanies } from "@/actions/companies";
import { EditContactSheet } from "@/components/contacts/edit-contact-sheet";

export const dynamic = "force-dynamic";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [contact, companies] = await Promise.all([getContact(id), listCompanies({ limit: 200 })]);
  if (!contact) notFound();

  return (
    <EditContactSheet
      contact={contact}
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
