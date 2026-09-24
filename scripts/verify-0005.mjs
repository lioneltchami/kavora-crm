import { Client } from "pg";

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const tables = await c.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN ('contact_emails', 'contact_phones')
   ORDER BY table_name`,
);
console.log("tables present:", tables.rows.map((r) => r.table_name));

const enums = await c.query(
  `SELECT typname FROM pg_type WHERE typname = 'contact_channel_type'`,
);
console.log("enum present:", enums.rows.length === 1);

const indexes = await c.query(
  `SELECT indexname FROM pg_indexes
   WHERE schemaname = 'public' AND tablename IN ('contact_emails', 'contact_phones')
   ORDER BY indexname`,
);
console.log("indexes:", indexes.rows.map((r) => r.indexname));

const counts = await c.query(
  `SELECT
     (SELECT count(*)::int FROM contact_emails) AS emails,
     (SELECT count(*)::int FROM contact_phones) AS phones,
     (SELECT count(*)::int FROM contacts WHERE email IS NOT NULL AND email != '') AS legacy_emails,
     (SELECT count(*)::int FROM contacts WHERE phone IS NOT NULL AND phone != '') AS legacy_phones`,
);
const r = counts.rows[0];
console.log("row counts:", r);
console.log(
  `backfill parity: emails ${r.emails === r.legacy_emails ? "✓" : "✗"} (${r.emails}/${r.legacy_emails}), phones ${r.phones === r.legacy_phones ? "✓" : "✗"} (${r.phones}/${r.legacy_phones})`,
);

await c.end();
