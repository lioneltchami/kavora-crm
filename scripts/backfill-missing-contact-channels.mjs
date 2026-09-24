import { Client } from "pg";

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const emailCandidates = await c.query(`
  SELECT c.id, c.email
  FROM contacts c
  WHERE c.email IS NOT NULL AND c.email != ''
    AND NOT EXISTS (
      SELECT 1 FROM contact_emails ce WHERE ce.contact_id = c.id
    )
`);

const phoneCandidates = await c.query(`
  SELECT c.id, c.phone
  FROM contacts c
  WHERE c.phone IS NOT NULL AND c.phone != ''
    AND NOT EXISTS (
      SELECT 1 FROM contact_phones cp WHERE cp.contact_id = c.id
    )
`);

console.log(`emails to backfill: ${emailCandidates.rows.length}`);
for (const r of emailCandidates.rows) {
  await c.query(
    `INSERT INTO contact_emails (contact_id, email, type, is_primary)
     VALUES ($1, $2, 'work', true)`,
    [r.id, r.email],
  );
  console.log(`  + ${r.id} <${r.email}>`);
}

console.log(`phones to backfill: ${phoneCandidates.rows.length}`);
for (const r of phoneCandidates.rows) {
  await c.query(
    `INSERT INTO contact_phones (contact_id, phone_e164, type, is_primary)
     VALUES ($1, $2, 'work', true)`,
    [r.id, r.phone],
  );
  console.log(`  + ${r.id} ${r.phone}`);
}

const final = await c.query(`
  SELECT
    (SELECT count(*)::int FROM contacts WHERE email IS NOT NULL AND email != '') AS legacy_emails,
    (SELECT count(*)::int FROM contact_emails) AS new_emails,
    (SELECT count(*)::int FROM contacts WHERE phone IS NOT NULL AND phone != '') AS legacy_phones,
    (SELECT count(*)::int FROM contact_phones) AS new_phones
`);
console.log("parity check:", final.rows[0]);

await c.end();
