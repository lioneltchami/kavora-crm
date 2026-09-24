import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const checks = [
  {
    name: "0002_merge_contacts",
    file: "src/db/migrations/0002_merge_contacts.sql",
    existsQuery: "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'merge_contacts') AS e",
  },
  {
    name: "0003_soft_delete_contacts",
    file: "src/db/migrations/0003_soft_delete_contacts.sql",
    existsQuery: "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contacts' AND column_name='deleted_at') AS e",
  },
  {
    name: "0004_summary_views",
    file: "src/db/migrations/0004_summary_views.sql",
    existsQuery: "SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='contacts_summary') AS e",
  },
  {
    name: "0005_contact_emails_phones",
    file: "src/db/migrations/0005_contact_emails_phones.sql",
    existsQuery: "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contact_emails') AS e",
  },
];

for (const { name, file, existsQuery } of checks) {
  const { rows } = await client.query(existsQuery);
  const exists = rows[0].e;
  if (exists) {
    console.log(`[skip] ${name} — already applied`);
    continue;
  }
  const sql = readFileSync(resolve(process.cwd(), file), "utf8");
  console.log(`[apply] ${name} (${sql.length} bytes)`);
  await client.query(sql);
  console.log(`[ok] ${name}`);
}

await client.end();
console.log("done");
