/**
 * Database client — Drizzle over node-postgres.
 *
 * Two connection pools are exposed:
 *  - `db`      — RLS-firing pool. Connects as `DATABASE_APP_ROLE` if set, else
 *               falls back to whatever `DATABASE_URL` says (typically the
 *               Supabase `postgres` superuser; logs a one-shot warning).
 *               Use this from app code (Server Actions, route handlers that
 *               have a Clerk session, query helpers).
 *  - `adminDb` — connection pool that bypasses RLS by connecting as the
 *               underlying superuser from `DIRECT_URL` (or `DATABASE_URL`
 *               if no direct URL is set). Use this only from contexts with no
 *               Clerk session — Clerk webhooks, Trigger.dev background jobs,
 *               the migration runner. NEVER use this from user-facing code:
 *               it silently bypasses the multi-tenant isolation guarantee.
 *
 * Migrations always go through the migration runner script, which uses its
 * own dedicated connection.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __pgAdminPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __dbWarnedSuperuser: boolean | undefined;
}

const fallbackUrl = "postgresql://localhost:5432/kavora_crm";

function isSupabaseUrl(url: string): boolean {
  return url.includes("supabase");
}

function applyRoleOverride(baseUrl: string): string {
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

const appConnectionString = applyRoleOverride(env.DATABASE_URL ?? fallbackUrl);
const adminConnectionString = env.DIRECT_URL ?? env.DATABASE_URL ?? fallbackUrl;

export const pool =
  globalThis.__pgPool ??
  new Pool({
    connectionString: appConnectionString,
    ssl: isSupabaseUrl(appConnectionString) ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });

export const adminPool =
  globalThis.__pgAdminPool ??
  new Pool({
    connectionString: adminConnectionString,
    ssl: isSupabaseUrl(adminConnectionString) ? { rejectUnauthorized: false } : false,
    max: 2,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__pgPool = pool;
  globalThis.__pgAdminPool = adminPool;
}

export const db = drizzle(pool, { schema, logger: false });
export const adminDb = drizzle(adminPool, { schema, logger: false });

export { schema };
