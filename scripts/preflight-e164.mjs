import { Client } from "pg";

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const sql = `
  SELECT count(*)::int AS n
  FROM contacts
  WHERE phone IS NOT NULL
    AND phone != ''
    AND phone !~ $1
`;
const r = await c.query(sql, ["^\\+[1-9]\\d{1,14}$"]);
console.log("non-E.164 phone rows:", r.rows[0].n);

if (r.rows[0].n > 0) {
  const samples = await c.query(
    `SELECT id, phone FROM contacts
     WHERE phone IS NOT NULL AND phone != '' AND phone !~ $1
     LIMIT 10`,
    ["^\\+[1-9]\\d{1,14}$"],
  );
  console.log("samples:", JSON.stringify(samples.rows, null, 2));
}

await c.end();
