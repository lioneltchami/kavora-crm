import { listCompanies } from "@/actions/companies";
import { CompanyList } from "@/components/companies/company-list";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const rows = await listCompanies({ q: sp.q });
  return <CompanyList rows={rows} />;
}
