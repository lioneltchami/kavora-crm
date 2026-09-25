/**
 * Database client — Drizzle over node-postgres.
 *
 * Two connection modes are supported:
 *  - `DATABASE_URL`  → transactional pooler (Supabase "Transaction" mode)
 *  - `DIRECT_URL`    → direct connection, used by migrations
 *
 * RLS posture:
 *  - When `DATABASE_APP_ROLE` + `DATABASE_APP_ROLE_PASSWORD` are both set, the
 *    Drizzle pool connects as that role (typically a non-superuser such as
 *    `app_user`), so Row-Level Security policies actually fire.
 *  - When those env vars are missing the pool falls back to whatever
 *    `DATABASE_URL` says. Supabase's `postgres` role is a superuser and
 *    silently bypasses every RLS policy — we emit a one-shot warning so that
 *    misconfiguration is loud in dev/test logs.
 *
 * For local dev, point `DATABASE_URL` at a local Postgres instance and create
 * a non-superuser role there.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __dbWarnedSuperuser: boolean | undefined;
}

const fallbackUrl = "postgresql://localhost:5432/kavora_crm";

function resolveConnectionString(): string {
  const baseUrl = env.DATABASE_URL ?? fallbackUrl;
  const role = env.DATABASE_APP_ROLE;
  const password = env.DATABASE_APP_ROLE_PASSWORD;
  if (!role || !password) {
    if (!globalThis.__dbWarnedSuperuser) {
      console.warn(
        "[db] running as superuser — RLS policies will be bypassed; set DATABASE_APP_ROLE + DATABASE_APP_ROLE_PASSWORD",
      );
      globalThis.__dbWarnedSuperuser = true;
    }
    return baseUrl;
  }
  try {
    const parsed = new URL(baseUrl);
    parsed.username = role;
    parsed.password = password;
    return parsed.toString();
  } catch {
    return baseUrl;
  }
}

const connectionString = resolveConnectionString();

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