/**
 * Database client — Drizzle over node-postgres.
 *
 * Two connection modes are supported:
 *  - `DATABASE_URL`  → transactional pooler (Supabase "Transaction" mode)
 *  - `DIRECT_URL`    → direct connection, used by migrations
 *
 * For local dev, point `DATABASE_URL` at a local Postgres instance.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "@/lib/env";

const connectionString = env.DATABASE_URL ?? "postgresql://localhost:5432/kavora_crm";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool =
  globalThis.__pgPool ??
  new Pool({
    connectionString,
    ssl: connectionString.includes("supabase")
      ? { rejectUnauthorized: false }
      : false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__pgPool = pool;
}

export const db = drizzle(pool, { schema, logger: false });

export { schema };
