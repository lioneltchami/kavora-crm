#!/usr/bin/env tsx
/**
 * Seed the canonical Kavora organization row idempotently.
 *
 * Runs `src/db/migrations/0006_seed_kavora_org.sql` against DIRECT_URL.
 * Use this for backfills against an existing database (e.g. live prod
 * created before 0006 existed) where the migration runner cannot register
 * 0006 because Builder 3 owns the runner extension.
 *
 * Direct connection only — bypasses the Drizzle pool / RLS context so the
 * row can be inserted regardless of the active Clerk session.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { env } from "@/lib/env";

const MIGRATION_PATH = "src/db/migrations/0006_seed_kavora_org.sql";

async function main(): Promise<void> {
  const url = env.DIRECT_URL;
  if (!url) {
    console.error("[seed-organization] DIRECT_URL is not set");
    process.exit(1);
  }

  const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), "utf8");
  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query<{ id: string; name: string }>(
      'SELECT "id", "name" FROM "organizations" WHERE "id" = $1',
      ["kavora"],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("Seed INSERT succeeded but kavora row not found");
    }
    console.log(
      `[seed-organization] ok — organizations(id=${row.id}, name=${row.name})`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error("[seed-organization] failed", err);
  process.exit(1);
});
