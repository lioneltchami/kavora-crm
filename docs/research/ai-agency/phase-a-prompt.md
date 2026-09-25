# Phase A — Multi-Tenant Core: Master Implementation Prompt

> **Self-contained prompt document for Kavora CRM Phase A.** Generated from
> `tests/phase-a-{spec,builders,reviewers,orchestration}.md` on 2026-09-24.
> Feed this entire document back to the parent agent (Mavis) when you're
> ready to execute Phase A.

---

## Table of Contents

- [§0 How to use this document](#how-to-use-this-document)
- [§1 Goal & Acceptance Criteria](#goal--acceptance-criteria)
- [§2 Quick reference: file allowlist per agent](#quick-reference-file-allowlist-per-agent)
- [§3 Quick reference: skills mapping](#quick-reference-skills-mapping)
- [PART 1 — Technical Specification](#part-1--technical-specification)
- [PART 2 — Builder Agent Prompts (4 parallel)](#part-2--builder-agent-prompts-4-parallel)
- [PART 3 — Blind Reviewer Prompts (4 parallel)](#part-3--blind-reviewer-prompts-4-parallel)
- [PART 4 — Master Orchestration + Skills Catalog](#part-4--master-orchestration--skills-catalog)
- [§X Caveats and Open Questions](#caveats-and-open-questions)

---

## How to use this document

This is the complete prompt that turns Kavora CRM from single-tenant into multi-tenant. It defines:

1. **What to build** (Part 1: Technical Specification)
2. **Who builds it** (Part 2: 4 parallel builder agents, file-scoped)
3. **Who verifies it** (Part 3: 4 parallel BLIND reviewers, file-scoped, test-and-fix)
4. **How to orchestrate the 8 agents** (Part 4: A.1 → A.6 sequence)
5. **What skills each agent loads** (Part 4 PART B, verified against the actual `/Users/lionel/.minimax/skills/` catalog)

When you (Lionel) feed this document back to the parent agent, the parent will:
1. Verify all §A.0 prerequisites (Clerk live keys, clean checkout, migrations applied)
2. Launch the 4 builders in parallel (Part 2) as `worker` tasks
3. Wait for all 4 builders to land on `origin/main`
4. Launch the 4 blind reviewers in parallel (Part 3) as `worker` tasks
5. Reconcile any cross-scope issues that reviewers flag
6. Run the §A.4 final smoke test
7. Refresh docs (§A.5)
8. Verify the §A.6 done-criteria checklist

---

## Goal & Acceptance Criteria

Phase A turns Kavora CRM from a single-tenant app (`KAVORA_ORG_ID = "kavora"` hardcoded at `src/db/schema.ts:813`) into a multi-tenant SaaS on a shared Postgres schema with Row-Level Security (RLS) as the ultimate isolation guarantee. Clerk Organizations becomes the source of truth for "which tenant is this request acting on behalf of," and a pgTAP test harness proves isolation so future schema changes cannot silently ship a cross-tenant leak.

**Phase A is done when every box below is true.**

1. **Org seam exists.** `KAVORA_ORG_ID` is gone from app code. A single row `(id='kavora', name='Kavora')` lives in `organizations` (`src/db/migrations/0001_init.sql:29-34`), seeded by `0006_seed_kavora_org.sql`, and resolved at request time via `currentOrgId()` reading Clerk's `org_id` JWT claim. Unit tests cover: no Clerk session → `null`; Clerk session with `org_id` → that id; no active org → `null`; `requireDbUser()` writes `orgId` from the helper, never from a fallback.
2. **RLS on every org-scoped table.** All 18 tables that carry `org_id` (`users`, `companies`, `contacts`, `pipelines`, `pipeline_stages`, `deals`, `tags`, `notes`, `phone_numbers`, `calls`, `sms_messages`, `activities`, `ai_summaries`, `ai_drafts`, `ai_styles`, `lead_scores`, `embeddings`, `audit_log`) get `ENABLE ROW LEVEL SECURITY` plus four policies each — `SELECT`/`INSERT`/`UPDATE`/`DELETE` — keyed on `(auth.jwt() ->> 'org_id')` matching `org_id`. The two child tables `contact_emails` and `contact_phones` get a deny-all policy from the app role (Phase A only reads them via joins). Migration lands as `src/db/migrations/0007_enable_rls.sql`.
3. **Connection role tightened.** `src/db/index.ts` connects via a non-superuser role (e.g. `app_user`); the elevated role (Supabase `postgres`) is reserved for `DIRECT_URL`-driven migrations only. A superuser connection silently bypasses every RLS policy.
4. **Clerk Organizations wired.** `src/app/api/webhooks/clerk/route.ts` handles `organization.created/updated/deleted` and `organizationMembership.created/deleted`. A `<OrganizationSwitcher />` from `@clerk/nextjs` renders inside `src/components/dashboard/sidebar.tsx`.
5. **pgTAP harness exists and passes.** `scripts/test-rls.sh` runs every `tests/rls/*.pgTAP.sql` file with `ON_ERROR_STOP=1` and exits non-zero on any failure. A CI job in `.github/workflows/ci.yml` runs the script on PRs against `main`.
6. **Migration runner extended.** `scripts/apply-pending-migrations.mjs` has a new entry for `0007_enable_rls.sql`. Idempotency detection switches from `pg_proc.prosrc` substring to a `pg_policies` count, since `0007` does not create a function.
7. **Docs updated.** `docs/ARCHITECTURE.md` §"Data model" stops saying "single-tenant enforced by a one-row stub." `docs/AGENTS.md` "Where to make changes" gets the new auth lib path and a rule: every new entity must include a RLS policy block.
8. **No regression.** `pnpm typecheck` and `pnpm build` pass on `origin/main`. No `KAVORA_ORG_ID` literal appears in `src/` outside the seed migration and the unit-test fixtures.

---

## Quick reference: file allowlist per agent

Every file appears in exactly ONE agent's allowlist. If a builder finds themselves needing to touch a file outside their scope, they write the requirement into `tests/phase-a-issues.md` and proceed without — the parent reconciles after all builders land.

### Builder 1 — Schema + `currentOrgId()` helper + seed

- **Allow**: `src/db/schema.ts`, `src/lib/auth.ts` (route `requireDbUser()` through `currentOrgId()`), `src/db/migrations/0006_seed_kavora_org.sql` (new), `src/lib/org/current-org-id.ts` (new), `src/lib/org/index.ts` (new barrel), `tests/unit/current-org-id.test.ts` (new), `package.json` (add `"test": "vitest run"` if missing)
- **Deny**: every other `src/**`, `scripts/**`, `tests/rls/**`, `.github/**`, `docs/**`

### Builder 2 — Clerk Organizations + UI

- **Allow**: `src/app/api/webhooks/clerk/route.ts`, `src/app/(dashboard)/layout.tsx` (only if zero-org empty-state needs layout guard), `src/components/dashboard/sidebar.tsx`, `src/components/dashboard/sidebar-brand.tsx`, `src/components/dashboard/sidebar-empty-org.tsx` (new), `src/components/ui/organization-switcher.tsx` (new thin wrapper), `tests/integration/clerk-webhook.test.ts` (new), `tests/components/organization-switcher.test.tsx` (new), `src/app/layout.tsx` (only if `ClerkProvider` needs new `appearance` props)
- **Deny**: `src/db/**`, `src/lib/auth/org/**` (Builder 1 owns the helper), `src/lib/auth.ts` (Builder 1), `scripts/**`, `tests/rls/**`

### Builder 3 — RLS migration + runner extension

- **Allow**: `src/db/migrations/0007_enable_rls.sql` (new), `scripts/apply-pending-migrations.mjs` (add ONE entry to the `checks` array; do not reorder existing entries), `tests/rls/00_setup.sql` (new), `tests/rls/contacts.pgTAP.sql` (new), `tests/rls/calls.pgTAP.sql` (new), `tests/rls/audit_log.pgTAP.sql` (new), `tests/rls/embeddings.pgTAP.sql` (new)
- **Deny**: `src/**` (no TS changes), `src/db/schema.ts` (Builder 1), `tests/rls/_harness_smoke.pgTAP.sql` (Builder 4), `tests/rls/_README.md` (Builder 4), `.github/**` (Builder 4)

### Builder 4 — Pool tightening + harness runner + CI

- **Allow**: `src/db/index.ts`, `src/lib/env.ts` (new env vars), `src/lib/db/pool.ts` (new — exports `appPool`, `adminPool`, if Builder 1 didn't already), `scripts/test-rls.sh` (new, executable), `tests/rls/_harness_smoke.pgTAP.sql` (new), `tests/rls/_README.md` (new, optional — explain how to add more pgTAP files), `.github/workflows/ci.yml` (new `rls-isolation` job), `.env.example` (document new env vars)
- **Deny**: `src/lib/auth/**`, `src/app/**`, `src/components/**`, `src/db/schema.ts`, `src/db/migrations/**`, `scripts/apply-pending-migrations.mjs` (Builder 3)

### Reviewer 1 — Schema + helper review

- **Allow**: `src/db/schema.ts`, `src/lib/auth.ts`, `src/db/migrations/0006_seed_kavora_org.sql`, `src/lib/org/**`, `tests/unit/current-org-id.test.ts`. Plus write `tests/phase-a-review-1.md`.

### Reviewer 2 — Clerk Organizations review

- **Allow**: `src/app/api/webhooks/clerk/route.ts`, `src/app/(dashboard)/layout.tsx`, `src/components/dashboard/sidebar.tsx`, `src/components/dashboard/sidebar-brand.tsx`, `src/components/dashboard/sidebar-empty-org.tsx`, `src/components/ui/organization-switcher.tsx`, `src/middleware.ts` (if touched), `src/app/layout.tsx` (if touched). Plus write `tests/phase-a-review-2.md`.

### Reviewer 3 — RLS migration review

- **Allow**: `src/db/migrations/0007_enable_rls.sql`, `scripts/apply-pending-migrations.mjs` (only the checks-array entry), `tests/rls/00_setup.sql`, `tests/rls/contacts.pgTAP.sql`, `tests/rls/calls.pgTAP.sql`, `tests/rls/audit_log.pgTAP.sql`, `tests/rls/embeddings.pgTAP.sql`. Plus write `tests/phase-a-review-3.md`.

### Reviewer 4 — Connection role + pgTAP harness review

- **Allow**: `src/db/index.ts`, `scripts/test-rls.sh`, `.github/workflows/ci.yml` (only the new RLS job step), `tests/rls/_harness_smoke.pgTAP.sql`, `tests/rls/_README.md`. Plus write `tests/phase-a-review-4.md`.

---

## Quick reference: skills mapping

Verified against `ls /Users/lionel/.minimax/skills/` on 2026-09-24 (515 skill folders). **Cells marked "not installed" are honest — no skill is fabricated.** Full mapping with paths is in [§PART 4 PART B](#part-b--skills-catalog-mapping).

| Agent | Required skills (load before starting) |
|---|---|
| Builder 1 (schema) | `implement-spec`, `tdd`, `code-structure`, `git-guardrails-claude-code` |
| Builder 2 (Clerk UI) | `implement-spec`, `code-structure`, `new-feature` |
| Builder 3 (RLS migration) | `implement-spec`, `tdd`, `code-structure`, `git-guardrails-claude-code` |
| Builder 4 (pgTAP harness) | `implement-spec`, `tdd`, `code-structure`, `git-guardrails-claude-code` |
| Reviewer 1 (schema review) | `code-review`, `evidence-driven-testing`, `git-commits` |
| Reviewer 2 (Clerk review) | `code-review`, `evidence-driven-testing`, `git-commits` |
| Reviewer 3 (RLS review) | `code-review`, `evidence-driven-testing`, `axiom-analyze-test-failures`, `git-commits` |
| Reviewer 4 (pgTAP harness review) | `code-review`, `evidence-driven-testing`, `axiom-analyze-test-failures`, `git-commits` |

**Not installed** (builders/reviewers compensate inline): `react`, `nextjs`, `clerk`, `clerk-organizations`, `@clerk/nextjs`, `supabase`, `supabase-rls`, `supabase-postgres-best-practices`, `pgtap`, `twilio`, `twilio-subaccounts`, `twilio-webhooks`. Closest substitute for `git-commits` is `git-guardrails-claude-code`.

---

# PART 1 — Technical Specification

> Source: `tests/phase-a-spec.md` (3,260 words). Consumers: 4 parallel builders, 4 blind reviewers. Every Phase A code change must be traceable to a section below.

## 1.1 Pre-conditions (already in place)

- **`org_id` on every business table.** `src/db/migrations/0001_init.sql` defines `org_id` in every `CREATE TABLE` except `organizations`, `contact_tags`, `contact_emails`, `contact_phones`. This pre-wiring makes RLS a one-migration job rather than a schema-redesign job.
- **Clerk webhook already syncs `users`.** `src/app/api/webhooks/clerk/route.ts` handles `user.created/updated/deleted`. Phase A extends, does not rewrite.
- **`organizations` table already exists as a one-row stub.** `src/db/migrations/0001_init.sql:29-34` defines `organizations(id varchar(64) PK, name text, created_at)`. The seed migration inserts the `kavora` row into this existing table.
- **`DIRECT_URL` already plumbed.** `src/db/index.ts:14` reads `env.DATABASE_URL ?? "postgresql://localhost:5432/kavora_crm"` and `env.DIRECT_URL` is the migration path. The Phase A two-pool design re-uses that separation.
- **pgTAP available on Supabase.** Per the Supabase pgTAP guide, `CREATE EXTENSION pgtap WITH SCHEMA extensions` is sufficient. We bundle that into `0007_enable_rls.sql` so the migration is self-contained.
- **`pgcrypto` + `vector` already loaded.** `src/db/migrations/0001_init.sql:1-2` enables both.

## 1.2 Schema Changes — Drizzle + SQL Diffs

### 1.2.1 Drop `KAVORA_ORG_ID`

```diff
- // src/db/schema.ts
- export const KAVORA_ORG_ID = "kavora";
```

After Builder 1 lands, `grep -rn "KAVORA_ORG_ID" src/` returns zero hits (or hits only in deprecated re-exports). The literal `"kavora"` survives only in the seed migration and the unit-test fixture.

### 1.2.2 Seed migration — `src/db/migrations/0006_seed_kavora_org.sql`

```sql
INSERT INTO "organizations" ("id", "name")
VALUES ('kavora', 'Kavora')
ON CONFLICT ("id") DO NOTHING;
```

Idempotent, runs once.

### 1.2.3 `currentOrgId()` helper — new `src/lib/org/current-org-id.ts`

```ts
import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";

/**
 * The Clerk session's active Organization id, or null.
 *   - No Clerk session             → null
 *   - User has no active org       → null
 *   - User has an active org       → "org_xxxxxx"
 *
 * The *only* canonical seam for "which org is this request scoped to".
 * Server Actions, route handlers, and audit-log calls read it through here.
 */
export const currentOrgId = cache(async (): Promise<string | null> => {
  const { orgId } = await auth();
  return orgId ?? null;
});
```

`src/lib/auth.ts` updates `requireDbUser()` so the auto-provisioned `users` row's `orgId` comes from `currentOrgId()`, never from a fallback. If `currentOrgId()` returns `null` and the user has no `users` row, `requireDbUser()` throws `400 "No active organization"` — it must NOT fall back to `"kavora"`.

## 1.3 Clerk Organizations Integration

### 1.3.1 Webhook — extend `src/app/api/webhooks/clerk/route.ts`

Add five event types. Pseudocode for the new branches:

```ts
if (evt.type === "organization.created" || evt.type === "organization.updated") {
  const { id, name, slug } = evt.data;
  await db.insert(organizations).values({ id, name, slug: slug ?? null })
    .onConflictDoUpdate({ target: organizations.id, set: { name, slug: slug ?? null } });
}
if (evt.type === "organization.deleted") {
  if (evt.data.id) await db.delete(organizations).where(eq(organizations.id, evt.data.id));
}
if (evt.type === "organizationMembership.created" || evt.type === "organizationMembership.updated") {
  const { organization, public_user_data } = evt.data;
  await db.update(users).set({ orgId: organization.id })
    .where(eq(users.id, public_user_data.user_id));
}
if (evt.type === "organizationMembership.deleted") {
  const { organization, public_user_data } = evt.data;
  await db.update(users).set({ orgId: "" })
    .where(and(eq(users.id, public_user_data.user_id), eq(users.orgId, organization.id)));
}
```

Signature verification (`svix` + `CLERK_WEBHOOK_SECRET`) stays unchanged. Returns: 200 fast on success, 401 on bad signature, 500 on missing secret.

### 1.3.2 Active-org claim

`@clerk/nextjs/server`'s `auth()` returns `{ orgId, userId, … }`. The `orgId` field is the active Clerk Organization id (e.g. `"org_2x…"`); our `currentOrgId()` helper is `(await auth()).orgId` memoized — no JWT decoding, no DB call.

### 1.3.3 `<OrganizationSwitcher />` in the sidebar

`src/components/dashboard/sidebar-brand.tsx` already renders the brand block at the top of `src/components/dashboard/sidebar.tsx`. Add the switcher directly under it:

```tsx
import { OrganizationSwitcher } from "@clerk/nextjs";
// inside SidebarBrand, just below the Link to /dashboard:
<div className="px-2 pb-2">
  <OrganizationSwitcher
    hidePersonal
    afterSelectOrganizationUrl="/dashboard"
    organizationProfileMode="modal"
  />
</div>
```

`hidePersonal` is `true` because Kavora CRM is pure B2B.

### 1.3.4 Zero-orgs empty state

If the signed-in user has no Organization membership, the sidebar must show a "Create or join an organization" empty state. The dashboard layout must NOT redirect-loop to `/sign-in` when `currentOrgId()` returns `null`; render the empty-state chrome and let the user pick an org first.

### 1.3.5 Middleware

`src/middleware.ts` does not need to change for Phase A — it already gates everything except public routes through `auth.protect()`.

## 1.4 RLS Migration Design

### 1.4.1 The migration — `src/db/migrations/0007_enable_rls.sql`

Self-contained: loads pgTAP, creates one predicate function, enables RLS on every org-scoped table, and emits 4 policies × 18 tables = 72 policies (plus 2 deny-all on the child tables). Idempotent (every `CREATE POLICY` is preceded by `DROP POLICY IF EXISTS`).

```sql
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- Short, stable predicate. auth.jwt() is a Supabase built-in.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'org_id'
$$;

DO $$
DECLARE t text;
  tables text[] := ARRAY[
    'users','companies','contacts','pipelines','pipeline_stages','deals',
    'tags','notes','phone_numbers','calls','sms_messages','activities',
    'ai_summaries','ai_drafts','ai_styles','lead_scores','embeddings','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_org_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT TO public
      USING (org_id = public.current_org_id())$p$, t || '_org_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_org_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT TO public
      WITH CHECK (org_id = public.current_org_id())$p$, t || '_org_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_org_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE TO public
      USING (org_id = public.current_org_id())
      WITH CHECK (org_id = public.current_org_id())$p$, t || '_org_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_org_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE TO public
      USING (org_id = public.current_org_id())$p$, t || '_org_delete', t);
  END LOOP;
END $$;

-- Child tables (no direct org_id; reached via FK to contacts).
-- Deny all from the app role; SECURITY DEFINER RPCs (future work) for
-- any cross-table ops Phase A actually needs.
ALTER TABLE contact_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_emails_app_deny ON contact_emails;
CREATE POLICY contact_emails_app_deny ON contact_emails
  FOR ALL TO public USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS contact_phones_app_deny ON contact_phones;
CREATE POLICY contact_phones_app_deny ON contact_phones
  FOR ALL TO public USING (false) WITH CHECK (false);
```

### 1.4.2 Per-table policy summary

All 18 org-scoped tables get the same four-policy shape — `SELECT USING`, `INSERT WITH CHECK`, `UPDATE USING + WITH CHECK`, `DELETE USING`, all keyed on `org_id = public.current_org_id()`. The two child tables get `FOR ALL USING (false) WITH CHECK (false)`.

## 1.5 Connection Role Tightening

`src/db/index.ts` currently connects with `env.DATABASE_URL ?? "postgresql://localhost:5432/kavora_crm"`. That role is `postgres` on Supabase, which **bypasses RLS by design** (per Supabase RLS docs: "Superusers and roles with the `BYPASSRLS` attribute always bypass RLS"). Every read/write from the Drizzle pool currently escapes the policies.

### 1.5.1 New env vars (`src/lib/env.ts`)

```ts
DATABASE_URL:               z.string().url(),    // existing — should be non-superuser role
DATABASE_URL_ADMIN:         z.string().url().optional(), // existing DIRECT_URL alias, used by migrations
DATABASE_APP_ROLE:          z.string().default("app_user"),
DATABASE_APP_ROLE_PASSWORD: z.string().min(16).optional(),
DATABASE_URL_TEST:          z.string().url().optional(),  // pgTAP harness
```

### 1.5.2 Two-pool design (`src/db/index.ts`)

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "@/lib/env";

const appPool = new Pool({
  connectionString: env.DATABASE_URL, // app_user — RLS fires here
  ssl: env.DATABASE_URL.includes("supabase") ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});
const adminPool = new Pool({
  connectionString: env.DATABASE_URL_ADMIN ?? env.DATABASE_URL,
  ssl: env.DATABASE_URL_ADMIN?.includes("supabase") ? { rejectUnauthorized: false } : false,
  max: 2,
});
export const db = drizzle(appPool, { schema, logger: false });
export const adminDb = drizzle(adminPool, { schema, logger: false }); // migrations only
export { schema };
```

`adminDb` is exported so `scripts/apply-pending-migrations.mjs` can import it for RLS-escaping migrations. Application code (route handlers, server actions, queue workers, trigger.dev jobs) **must only import `db`**.

## 1.6 pgTAP Harness

### 1.6.1 Layout

```
tests/rls/
├── _harness_smoke.pgTAP.sql   # asserts is_superuser=off for the connected role
├── 00_setup.sql               # two-org seed for the suite
├── contacts.pgTAP.sql         # isolation suite for contacts
├── calls.pgTAP.sql
├── audit_log.pgTAP.sql
└── embeddings.pgTAP.sql
```

### 1.6.2 Runner — `scripts/test-rls.sh` (executable)

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL_TEST:?DATABASE_URL_TEST must be set — point at a throwaway DB}"
for f in tests/rls/*.pgTAP.sql; do
  echo "── running $f"
  psql "$DATABASE_URL_TEST" -v ON_ERROR_STOP=1 -X --quiet -f "$f"
done
echo "all pgTAP plans passed"
```

### 1.6.3 Sample pgTAP test — `tests/rls/contacts.pgTAP.sql`

```sql
BEGIN;
SELECT plan(8);

INSERT INTO organizations (id, name)
  VALUES ('org_kavora_test','Kavora Test'), ('org_acme_test','Acme Test')
  ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM contacts)::int, 0::int,
  'no JWT → zero rows visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
INSERT INTO contacts (org_id, first_name)
  VALUES ('org_kavora_test','Alice'), ('org_acme_test','Bob');
SELECT is((SELECT count(*) FROM contacts)::int, 1::int,
  'kavora JWT → only 1 row visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT is((SELECT count(*) FROM contacts)::int, 1::int,
  'acme JWT → only 1 row visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT throws_ok(
  $$INSERT INTO contacts (org_id, first_name) VALUES ('org_acme_test','Mallory')$$,
  '42501', null, 'kavora JWT cannot insert acme row');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT results_eq(
  $$UPDATE contacts SET first_name='X' WHERE first_name='Alice' RETURNING first_name$$,
  $$VALUES ('Alice'::text)$$, 'cross-tenant UPDATE no-ops');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT lives_ok($$DELETE FROM contacts WHERE first_name='Alice'$$);
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT is((SELECT count(*) FROM contacts WHERE first_name='Alice')::int, 1::int,
  'Alice still present after cross-tenant DELETE attempt');

SELECT * FROM finish();
ROLLBACK;
```

### 1.6.4 CI integration

`.github/workflows/ci.yml` gets a new job `rls-isolation` that: (1) provisions a Postgres 16 service container; (2) applies all `src/db/migrations/*.sql` in order; (3) runs `bash scripts/test-rls.sh` with `DATABASE_URL_TEST` pointing at the container; (4) fails the PR check on non-zero exit.

## 1.7 Migration Ordering & Runner Compatibility

The runner currently detects prior application via unique signals (function source substring, column existence, view existence — see `scripts/apply-pending-migrations.mjs:34`). `0007_enable_rls.sql` creates no function it owns. Switch to a `pg_policies` check for that entry:

```js
{
  name: "0007_enable_rls",
  file: "src/db/migrations/0007_enable_rls.sql",
  existsQuery: "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND policyname='contacts_org_select') AS e",
},
```

Order in the runner's `checks` array is `0006_seed_kavora_org → 0007_enable_rls` so the `kavora` row exists when RLS is enabled. Re-running `0006` is safe (`ON CONFLICT DO NOTHING`). Re-running `0007` is safe (every `CREATE POLICY` is preceded by `DROP POLICY IF EXISTS`).

## 1.8 Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Missing `WITH CHECK` on INSERT/UPDATE lets a malicious payload set `org_id='kavora'` and smuggle into the most-trusted tenant. | Medium | **Critical** | Migration includes both `USING` and `WITH CHECK` on INSERT and UPDATE. pgTAP `contacts.pgTAP.sql` step 4 asserts the spoof fails. |
| R2 | `contact_emails` / `contact_phones` deny-all policy means a future Server Action that touches them directly returns zero rows. | High | Medium | Phase A only reads them via joins; deny-all is correct. Future follow-up adds SECURITY DEFINER RPCs if direct reads become needed. |
| R3 | `db` pool still uses `postgres` (superuser) — RLS silently bypasses. | **Critical** if not fixed | **Critical** | New two-pool design. `tests/rls/_harness_smoke.pgTAP.sql` asserts `current_setting('is_superuser')='off'`. Reviewer 4 verifies via smoke test. |
| R4 | `auth.jwt()` returns NULL when the JWT claim is missing — fail-closed. | High | Low | `currentOrgId()` returns `null`; `requireDbUser()` throws "No active organization"; UI shows empty state. |
| R5 | Webhook redelivery from Svix double-inserts / double-deletes. | Medium | Medium | All Clerk-event branches use `ON CONFLICT` or scoped UPDATEs; `DELETE` is naturally idempotent. |
| R6 | `<OrganizationSwitcher />` causes stale `currentOrgId()` to read the previous org until revalidate runs. | Medium | Low — one frame of cross-tenant flash | Hook `router.refresh()` in a `useEffect` on `organization.changed`. |
| R7 | pgTAP extension creation needs superuser; if `0007` runs under `app_user`, it fails. | Medium | Medium | Migration runner uses `DIRECT_URL` (superuser). Document in `scripts/apply-pending-migrations.mjs` header. |
| R8 | Runner's `pg_proc.prosrc` substring detection doesn't detect `0007` because it creates no function. | High | Medium | Add a `pg_policies`-based check entry. |
| R9 | A future schema migration adds a new table but forgets RLS — silent leak. | High | Critical | CI job `rls-isolation` includes `tests/rls/_schema_audit.pgTAP.sql` (out of scope for Phase A but documented). |
| R10 | `0006` seed runs after `0007` because the runner's array is ordered by hand. | Low | Low | Explicitly orders `0006` before `0007`. |

## 1.9 Out of Scope (Explicit Non-Goals for Phase A)

These are documented in `docs/research/ai-agency/research-multi-tenant-architecture.md` as Phase 3 or later; **not part of Phase A**, and any builder who touches them is in scope violation.

- **Per-tenant Twilio subaccounts** — Phase A keeps Twilio on a single account.
- **White-label / per-tenant theming** — `theme` jsonb on `organizations`, custom domains, branded emails.
- **Billing & invoicing** — Stripe per-tenant subscriptions, plan limits, metering.
- **Service catalog / marketplace** — public-facing catalog, vendor onboarding.
- **Per-tenant webhook URLs with HMAC signing** — every outbound webhook keeps one signing key.
- **Schema-per-tenant migration** — shared-schema RLS only.
- **Audit log archival / export** — `audit_log` becomes tenant-isolated but is not exported, paginated, or retained differently per tenant.
- **Per-tenant encryption keys** (Supabase Vault, pgcrypto envelopes) — `audit_log` and AI tables are not field-level encrypted.
- **Cross-tenant analytics** — a "platform admin" view across all orgs requires a `PLATFORM_ADMIN` role with `BYPASSRLS`; deferred.
- **AI-agent multi-tenant state** — `src/trigger/inbound-sms.ts` and `ai_*` tables get RLS, but per-tenant model selection, cost attribution, rate limits are later.

---

# PART 2 — Builder Agent Prompts (4 parallel)

> Source: `tests/phase-a-builders.md` (3,774 words). Each prompt drives one bounded slice. Builders run **in parallel** and must not touch each other's files.

## 2.0 Common preamble (paste before each builder-specific body)

```
You are one of 4 parallel builders for Kavora CRM Phase A. Your scope is
the file list below — do not edit anything outside it, even if you spot
smells. Cross-cutting changes go in tests/phase-a-issues.md and proceed
without them.

Conventions (see docs/AGENTS.md, docs/SETUP.md):
- Each commit: run `pnpm typecheck && pnpm build` before pushing.
- Commit per logical unit; push to origin/main.
- Tag commit messages `[phase-a/<builder-name>]`.
- DO NOT touch .env.local; do NOT run `vercel env pull` into the workspace
  (see AGENTS.md don'ts).
- NO Co-Authored-By trailer; NO Generated-by footer.
- NO code comments inside TS files (only top-of-file module docblocks OK).

After every commit, report:
  { sha, branch, files_touched, typecheck_status, build_status, smoke_status }

Final summary: list all commit SHAs pushed, any changes to
scripts/apply-pending-migrations.mjs (migrations always need a check entry),
and any deviations from the spec.

Your scope (from tests/phase-a-prompt.md):
```

Then paste the builder-specific body from §2.1, §2.2, §2.3, or §2.4.

## 2.1 Builder 1 — Schema + `currentOrgId()` helper

### Title and goal

**Phase A · Builder 1 — Refactor `KAVORA_ORG_ID` into a real row and ship a `currentOrgId()` seam that reads the Clerk session JWT.**

### Scope

In scope:
- Refactor the `KAVORA_ORG_ID` constant at `src/db/schema.ts:813` so it is no longer the single source of truth — it stays exported only as a back-compat alias marked `@deprecated`.
- Seed `('kavora', 'Kavora')` into the `organizations` table via a new idempotent migration `0006_seed_kavora_org.sql`.
- Ship a new server-only helper at `src/lib/org/current-org-id.ts` exporting `currentOrgId()` (memoized with `React.cache`) and `requireOrgId()` (throws on null) that read the active organization from the Clerk session (`auth().orgId`).
- Update `src/lib/auth.ts` so `requireDbUser()` writes the auto-provisioned `users` row's `orgId` from `currentOrgId()`, never from a fallback. If `currentOrgId()` returns `null` and the user has no `users` row, `requireDbUser()` throws `400 "No active organization"`.
- Ship `src/db/seed-organization.ts` — a one-shot `tsx` script that runs `0006_seed_kavora_org.sql` against `DIRECT_URL` for local backfills where the auto-applied migration may not have caught up.
- Ship `tests/unit/current-org-id.test.ts` covering: (a) no Clerk session → null, (b) Clerk session with `org_id` → that id, (c) Clerk session with `null` org_id → null, (d) `requireDbUser` provisions row under the right org, (e) `requireDbUser` does NOT auto-provision when `orgId` is null.
- If `vitest` is not yet wired in the repo, add `vitest.config.ts` + a `"test": "vitest run"` script to `package.json` and commit it as part of this scope.

Out of scope (do NOT touch):
- The Clerk webhook at `src/app/api/webhooks/clerk/route.ts` — Builder 2 owns it.
- Any RLS work — Builder 3 owns `0007_enable_rls.sql`.
- Any connection-role work — Builder 4 owns `src/db/index.ts`.

### File allowlist

- **Allowlist**: `src/db/schema.ts`, `src/lib/auth.ts`, `src/lib/org/current-org-id.ts` (new), `src/lib/org/index.ts` (new barrel), `src/db/seed-organization.ts` (new), `src/db/migrations/0006_seed_kavora_org.sql` (new), `tests/unit/current-org-id.test.ts` (new), `vitest.config.ts` (new if needed), `package.json` (add `"test"` script only).
- **Deny-list (explicit)**: every other file under `src/`, every file under `scripts/`, every file under `tests/rls/`, every file under `.github/`, every file under `docs/`, plus `pnpm-lock.yaml` and `tsconfig.json`.

### Skills to load (mandatory)

- `implement-spec` — pattern for "implement the work described in the spec", commits per logical unit, runs typecheck between, calls code-review at the end
- `tdd` — unit tests are part of your scope
- `code-structure` — separates the auth seam from the DB seam
- `git-guardrails-claude-code` — schema refactor is sensitive
- (`react`, `supabase-postgres-best-practices`) — would be ideal but are **not installed**

### Implementation steps

1. **Migration**: write `src/db/migrations/0006_seed_kavora_org.sql`. Single statement: `INSERT INTO "organizations" ("id", "name") VALUES ('kavora', 'Kavora') ON CONFLICT ("id") DO NOTHING;`. Add a top-of-file header comment matching the style of `0003_soft_delete_contacts.sql`.
2. **Seed script**: create `src/db/seed-organization.ts` that reads `DIRECT_URL` from `src/lib/env`, opens a `pg.Client`, executes the migration file with `\set ON_ERROR_STOP on`, and exits non-zero on failure. Do NOT use the Drizzle pool — direct connection only.
3. **Schema refactor**: in `src/db/schema.ts`, replace the block at line 813. Keep `KAVORA_ORG_ID = "kavora"` exported only as a back-compat alias with a JSDoc `@deprecated use currentOrgId() instead` marker.
4. **Helper**: create `src/lib/org/current-org-id.ts`. It must:
   - Start with `"server-only"` import and module docblock.
   - Export `async function currentOrgId(): Promise<string | null>` that calls `auth()` from `@clerk/nextjs/server` and returns `(await auth()).orgId ?? null`. If `orgId` is `null` (single-tenant / Clerk Organizations not yet enabled), return `null` — do NOT fall back to `KAVORA_ORG_ID`.
   - Export `async function requireOrgId(): Promise<string>` that throws `Error("NO_ACTIVE_ORG")` when `currentOrgId()` returns `null`.
   - Wrap the read in `React.cache` so repeated calls in the same RSC render do not double-fetch Clerk.
5. **Barrel**: create `src/lib/org/index.ts` re-exporting `currentOrgId`, `requireOrgId`.
6. **requireDbUser update**: in `src/lib/auth.ts`, change `requireDbUser()` so the auto-provisioned `users` row's `orgId` comes from `currentOrgId()`. If `currentOrgId()` returns `null` and the user has no `users` row, throw `400 "No active organization"`. **Must NOT fall back to `"kavora"`.**
7. **Unit tests**: `tests/unit/current-org-id.test.ts` with `vi.mock("@clerk/nextjs/server")` and `vi.mock("@/db")` to cover the five cases above.
8. **Validate**: run `pnpm typecheck` — must be clean. Run `pnpm test tests/unit/current-org-id.test.ts` — must be green. Run `node scripts/apply-pending-migrations.mjs` against a local Postgres if available; the new migration must apply idempotently.

### Commit message template

```
<type>(<scope>): <subject>

[phase-a/builder-1]
```

Recommended commits in order:
1. `feat(db): seed kavora organization row idempotently (0006)`
2. `feat(schema): keep KAVORA_ORG_ID as back-compat alias, route requireDbUser through currentOrgId`
3. `feat(auth): currentOrgId() / requireOrgId() helper reading Clerk session`
4. `chore(seed): standalone seed-organization script for DIRECT_URL backfill`
5. `test(org): unit tests for currentOrgId edge cases`

### Validation criteria

- `pnpm typecheck` clean.
- `pnpm build` clean.
- `pnpm test tests/unit/current-org-id.test.ts` green.
- The new migration applies idempotently: run `node scripts/apply-pending-migrations.mjs` twice in a row, the second run must log `[skip] 0006_seed_kavora_org — already applied`.
- `grep -r "currentOrgId\|requireOrgId" src/` returns at least the new file (this is the seam the next builder imports).
- `grep -r "KAVORA_ORG_ID" src/db/schema.ts` still matches — the deprecated export remains for now.

### Push instructions

Push to `origin/main` directly when green (matches the v1.8 pattern — see `git log` showing direct merges on `main`):

```
git fetch origin
git rebase origin/main   # resolve any conflicts locally before push
git push origin HEAD:main
```

If a conflict surfaces on `src/db/schema.ts`, abort the rebase (`git rebase --abort`) and report the conflicting commit SHA back to the parent — do NOT force-push.

### What to deliver back

- Commit SHAs for all commits above.
- Final `origin/main` SHA your branch sits at.
- One-line note: whether `pnpm typecheck` + `pnpm build` + `pnpm test` all passed, and whether you were able to run the migration locally (if no local DB, say so explicitly).

---

## 2.2 Builder 2 — Clerk Organizations integration

### Title and goal

**Phase A · Builder 2 — Wire Clerk Organizations events into the webhook and render `<OrganizationSwitcher />` in the dashboard sidebar.**

### Scope

In scope:
- Extend the existing Clerk webhook at `src/app/api/webhooks/clerk/route.ts` to handle `organization.created`, `organization.updated`, `organization.deleted`, `organizationMembership.created`, and `organizationMembership.deleted`. Map Clerk user → local `users.orgId` on membership upsert; upsert `organizations` on org upsert.
- Render Clerk's `<OrganizationSwitcher />` in `src/components/dashboard/sidebar.tsx` (slot it next to or below `SidebarBrand`).
- Create a sidebar empty-state component (`src/components/dashboard/sidebar-empty-org.tsx` or similar) that handles the zero-orgs case (signed-in user with no membership → render a "Create or join an organization" link to Clerk's hosted create-org flow).
- If `src/app/(dashboard)/layout.tsx` redirects on null `currentOrgId()`, change it to render the empty-state chrome instead.
- Integration test in `tests/integration/clerk-webhook.test.ts` that POSTs synthetic `organization.created`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.deleted` payloads (signed with a test `CLERK_WEBHOOK_SECRET`) and asserts the local rows. A 4th test asserts an unsigned payload returns 401.
- Render test (React Testing Library) at `tests/components/organization-switcher.test.tsx` that mounts `<OrganizationSwitcher />` with a Clerk `useOrganization()` mock returning `memberships: []` and asserts the empty state is visible; a second render mounts with two memberships and asserts the active org is highlighted.

Out of scope:
- `src/db/**` (Builder 1 owns schema.ts, Builder 3 owns migrations).
- `src/lib/org/current-org-id.ts` (Builder 1's helper). You IMPORT it — you do not edit it.
- `scripts/**` and `tests/rls/**`.

### File allowlist

- **Allowlist**: `src/app/api/webhooks/clerk/route.ts`, `src/app/(dashboard)/layout.tsx`, `src/components/dashboard/sidebar.tsx`, `src/components/dashboard/sidebar-brand.tsx`, `src/components/dashboard/sidebar-empty-org.tsx` (new), `src/components/ui/organization-switcher.tsx` (new thin wrapper), `src/app/layout.tsx` (only if `ClerkProvider` needs new `appearance` props), `src/middleware.ts` (only if a real change is required), `tests/integration/clerk-webhook.test.ts` (new), `tests/components/organization-switcher.test.tsx` (new).
- **Deny-list (explicit)**: every file under `src/db/`, `src/lib/org/**` except to import, every file under `scripts/`, every file under `tests/rls/`, every other file under `src/app/`, every file under `src/components/` other than the four listed, every file under `docs/`, plus `package.json`, `pnpm-lock.yaml`, and `tsconfig.json`.

### Skills to load (mandatory)

- `implement-spec` — multi-file TS work; same discipline as Builder 1
- `code-structure` — keeps auth + policy in actions, pushes SDK mechanics into `src/components/dashboard/sidebar-*.tsx`
- `new-feature` — worktree per task so Builder 2's edits never collide with Builder 1's
- (`react`, `clerk`, `nextjs`) — would tailor UI work to Next 15 App Router but are **not installed**

### Implementation steps

1. **Webhook — organization events**: extend `src/app/api/webhooks/clerk/route.ts`. Add a new `ClerkOrgEvent` union type. Inside the existing `POST` handler, after the signature verification block, branch on the new event types:
   - `organization.created` / `organization.updated` → `db.insert(organizations).values(mapClerkOrganizationToRow(evt.data)).onConflictDoUpdate({ target: organizations.id, set: { name: evt.data.name } })`.
   - `organization.deleted` → `db.delete(organizations).where(eq(organizations.id, evt.data.id!))`.
   - `organizationMembership.created` → `db.update(users).set({ orgId: evt.data.organization.id }).where(eq(users.id, evt.data.public_user_data.user_id))`. Use the existing `logAudit` from `@/lib/audit` with `action: "user.joined_org"`.
   - `organizationMembership.deleted` → `db.update(users).set({ orgId: "" }).where(...)` and log `action: "user.left_org"`.
   - Reuse the existing `KAVORA_ORG_ID` constant only inside `organizationMembership.created` as a fallback when `evt.data.organization.id` is missing — log a warning, do not throw. Keep the existing `user.created`/`user.updated` branches untouched.
2. **Sidebar wiring**: in `src/components/dashboard/sidebar.tsx`, import the new empty-org component and `<OrganizationSwitcher />` (or your wrapper) and render it inside `SidebarBrand` (top group, below the existing brand Link).
3. **Empty-org component**: `src/components/dashboard/sidebar-empty-org.tsx` (new). `"use client"`. Uses `@clerk/nextjs`'s `useOrganization()` + `useOrganizationList()`. Renders Clerk's `<OrganizationSwitcher />` when `memberships.length > 0`. When memberships are empty, renders a fallback `<Link href="https://accounts.kavora.systems/create-organization" target="_blank">` styled with the project's existing dropdown-menu tokens from `src/components/ui/dropdown-menu.tsx`. Keep the wrapper under 80 lines.
4. **Layout**: in `src/app/(dashboard)/layout.tsx`, if it currently redirects on null `currentOrgId()`, change it to render the empty-state chrome instead.
5. **Validate**: `pnpm typecheck`, `pnpm build`, `pnpm test` (the new integration + render tests must pass).

### Commit message template

```
<type>(<scope>): <subject>

[phase-a/builder-2]
```

Recommended commits in order:
1. `feat(webhooks): handle Clerk organization.created/updated/deleted events`
2. `feat(webhooks): handle Clerk organizationMembership.created/deleted (user.orgId sync)`
3. `feat(dashboard): <OrganizationSwitcher /> in sidebar with zero-orgs empty state`
4. `test(webhooks): integration tests for Clerk organization event types`
5. `test(ui): render test for organization switcher empty-state and active-org highlight`

### Validation criteria

- `pnpm typecheck` clean.
- `pnpm build` clean.
- `pnpm test` green (new integration + render tests pass).
- The new event types appear in the existing `ClerkWebhookEvent` union, and `grep -n "organizationMembership" src/app/api/webhooks/clerk/route.ts` returns ≥ 2 lines.
- `<OrganizationSwitcher />` is keyboard-accessible: focusable, `aria-label`, Escape closes, Enter activates (Clerk's built-in handles this; your wrapper does not regress it).
- `import { currentOrgId } from "@/lib/org"` is used wherever a server component needs the active org id; otherwise rely on Clerk's `useOrganization()` client hook and document the seam in a top-of-file JSDoc block.

### Push instructions

Same as Builder 1: rebase onto `origin/main`, resolve conflicts locally if any, push to `origin/main`. If a conflict appears inside `src/app/api/webhooks/clerk/route.ts`, it likely means Builder 1 (very unlikely — different file) or another writer touched it; abort and report back to the parent.

### What to deliver back

- Commit SHAs (5 commits).
- `origin/main` SHA your branch sits at.
- Confirmation that `pnpm typecheck` + `pnpm build` + `pnpm test` all passed.
- Note any Clerk dashboard configuration that needs to be flipped on (e.g., "Organizations must be enabled in the Clerk dashboard before this webhook branch fires").

---

## 2.3 Builder 3 — RLS migration (`0007_enable_rls.sql`)

### Title and goal

**Phase A · Builder 3 — Enable Row-Level Security on every org-scoped table with full SELECT/INSERT/UPDATE/DELETE policies, write pgTAP isolation tests, and register the migration with the auto-apply runner.**

### Scope

In scope:
- Hand-write `src/db/migrations/0007_enable_rls.sql` enabling RLS on every org-scoped table with policies that gate rows by `org_id = public.current_org_id()`. Tables (from `0001_init.sql` + `0005_contact_emails_phones.sql`):
  `users`, `companies`, `contacts`, `pipelines`, `pipeline_stages`, `deals`, `tags`, `contact_tags`, `notes`, `phone_numbers`, `calls`, `sms_messages`, `activities`, `ai_summaries`, `ai_drafts`, `ai_styles`, `lead_scores`, `embeddings`, `audit_log`, `contact_emails`, `contact_phones`. (21 tables total.)
- Define the helper SQL function `public.current_org_id()` in the same migration — it reads from the Clerk JWT claim via `auth.jwt() ->> 'org_id'`. Mark it `STABLE`. Use the Supabase-recommended pattern: `USING (org_id = (select public.current_org_id()))` (subquery for plan caching).
- Write pgTAP isolation test files: `tests/rls/00_setup.sql`, `tests/rls/contacts.pgTAP.sql`, `tests/rls/calls.pgTAP.sql`, `tests/rls/audit_log.pgTAP.sql`, `tests/rls/embeddings.pgTAP.sql`. Each pgTAP test covers: with `org_id=A` in JWT, SELECT returns only A's rows; with `org_id=B`, SELECT returns only B's rows; with no `org_id` claim, SELECT returns zero rows; INSERT with `org_id=A` succeeds; INSERT with `org_id=B` in JWT but `org_id=A` in payload FAILS (the policy must reject the spoof).
- Extend the `checks` array in `scripts/apply-pending-migrations.mjs` so the GH Actions auto-apply job picks up `0007` based on the existence of at least one row in `pg_policies` for the `contacts` table.

Out of scope:
- `src/` — do NOT touch any TS source. RLS is enforced at the DB layer; TS code does not need to change for policies to start firing.
- `src/db/schema.ts` — Builder 1 owns it.
- `tests/rls/_harness_smoke.pgTAP.sql` — Builder 4 owns it.
- `.github/**`.

### File allowlist

- **Allowlist**: `src/db/migrations/0007_enable_rls.sql` (new), `scripts/apply-pending-migrations.mjs` (add ONE entry to the `checks` array; do not reorder existing entries), `tests/rls/00_setup.sql` (new), `tests/rls/contacts.pgTAP.sql` (new), `tests/rls/calls.pgTAP.sql` (new), `tests/rls/audit_log.pgTAP.sql` (new), `tests/rls/embeddings.pgTAP.sql` (new).
- **Deny-list (explicit)**: every file under `src/`, `tests/rls/_harness_smoke.pgTAP.sql`, `tests/rls/_README.md`, every file under `.github/`, every file under `docs/`, plus `package.json`, `pnpm-lock.yaml`, `drizzle.config.ts`, and `tsconfig.json`.

### Skills to load (mandatory)

- `implement-spec` — pattern for implementing a DB migration spec
- `tdd` — pgTAP tests are TDD for the migration
- `code-structure` — keeps the migration self-contained (extension + function + policies in one file)
- `git-guardrails-claude-code` — migration files are sensitive
- (`pgtap`, `supabase-rls`, `postgres-best-practices`) — would be ideal but are **not installed**

### Implementation steps

1. **Header**: top-of-file comment matching the style of `0004_summary_views.sql` (1-paragraph summary of intent + bullet list of policy naming pattern).
2. **pgTAP extension**: `CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;` at the top.
3. **Helper function**: `CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'org_id' $$;`.
4. **Enable RLS**: one `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` per table (21 statements). Include `organizations` only if you want to prevent app-role reads of foreign orgs — leave it OUT for now so Builder 1's seed migration and Builder 2's webhook can still upsert; flag this in the commit body.
5. **Policies**: for each enabled table, four policies named `<table>_org_select`, `<table>_org_insert`, `<table>_org_update`, `<table>_org_delete`. Use the Supabase-recommended pattern with subquery for plan caching: `USING (org_id = (select public.current_org_id()))`. For INSERT/UPDATE, mirror with `WITH CHECK (org_id = (select public.current_org_id()))`. Wrap in `DO $$ ... $$` blocks with `IF NOT EXISTS` checks against `pg_policies` for portability across PG 15/16.
6. **Indirect tables (`contact_emails`, `contact_phones`)**: these have no `org_id` column. Add SELECT policies that resolve via EXISTS to the parent `contacts` row: `USING (EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND c.org_id = (select public.current_org_id())))`. Do the same for INSERT/UPDATE/DELETE with `WITH CHECK`.
7. **pgTAP tests**: write `tests/rls/00_setup.sql` (creates two test orgs), `tests/rls/contacts.pgTAP.sql`, `tests/rls/calls.pgTAP.sql`, `tests/rls/audit_log.pgTAP.sql`, `tests/rls/embeddings.pgTAP.sql`. Each file follows the pattern from §1.6.3 above.
8. **Runner check**: append to the `checks` array in `scripts/apply-pending-migrations.mjs`:
   ```js
   {
     name: "0007_enable_rls",
     file: "src/db/migrations/0007_enable_rls.sql",
     existsQuery: "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND policyname='contacts_org_select') AS e",
   },
   ```
   Place this entry LAST in the array — RLS depends on the `organizations` table existing (0001) and the `contact_emails` / `contact_phones` tables existing (0005).
9. **Validate**: if a local Postgres is reachable, `node scripts/apply-pending-migrations.mjs` should apply `0007` once and skip it thereafter. Then `bash scripts/test-rls.sh` (or `psql -f tests/rls/contacts.pgTAP.sql` if the runner doesn't exist yet) must pass.

### Commit message template

```
<type>(<scope>): <subject>

[phase-a/builder-3]
```

Recommended commits in order:
1. `feat(db): enable RLS on all 21 org-scoped tables (0007)`
2. `feat(scripts): register 0007_enable_rls with the migration runner`
3. `test(rls): pgTAP isolation tests for contacts / calls / audit_log / embeddings`

### Validation criteria

- `pnpm typecheck` clean (no TS touched, but the harness runs tsc — verify nothing else broke).
- `pnpm build` clean.
- The migration SQL is parseable (no syntax errors). If a Postgres instance is reachable, apply + re-apply: the second run must log `[skip] 0007_enable_rls — already applied`.
- `grep -c "_org_select" src/db/migrations/0007_enable_rls.sql` returns ≥ 19 (one per table — 18 org-scoped + 1 for `organizations` if you enabled it, or 18 if you skipped).
- `grep -c "_org_insert" src/db/migrations/0007_enable_rls.sql` returns ≥ 19.
- `grep -c "_org_update" src/db/migrations/0007_enable_rls.sql` returns ≥ 19.
- `grep -c "_org_delete" src/db/migrations/0007_enable_rls.sql` returns ≥ 19.
- `public.current_org_id()` function exists in the migration.
- `scripts/apply-pending-migrations.mjs` still applies 0001–0005 correctly (regression check: the `checks` array order is unchanged for the existing entries).
- pgTAP tests pass: `psql "$DATABASE_URL_TEST" -f tests/rls/contacts.pgTAP.sql` exits 0.

### Push instructions

Same as Builders 1 + 2. If a conflict surfaces on `scripts/apply-pending-migrations.mjs` (only possible if another builder also edited the array), abort the rebase and report back to the parent.

### What to deliver back

- 3 commit SHAs.
- `origin/main` SHA.
- Table-count proof: `grep -c "_org_select" ... | _org_insert | _org_update | _org_delete` all ≥ 19.
- pgTAP test output (or note that local Postgres was unavailable).

---

## 2.4 Builder 4 — Connection role + pgTAP harness + CI

### Title and goal

**Phase A · Builder 4 — Tighten the Drizzle pool to a non-superuser role so RLS policies actually fire, ship a `tests/rls/_harness_smoke.pgTAP.sql`, and wire a `rls-isolation` job into `.github/workflows/ci.yml`.**

### Scope

In scope:
- Edit `src/db/index.ts` to parse a new `DATABASE_APP_ROLE` + `DATABASE_APP_ROLE_PASSWORD` pair from `src/lib/env.ts` (extend the zod schema) and connect the runtime pool using those credentials. Keep `DATABASE_URL` (superuser) as the fallback for local dev, but log a warning when the fallback path is in use.
- If `src/lib/db/pool.ts` does not yet exist, create it exporting `appPool`, `adminPool`. Builder 1 may also touch this file — coordinate via `tests/phase-a-issues.md` if you find Builder 1 already created it.
- Create `scripts/test-rls.sh` — executable, `set -euo pipefail`, reads `DATABASE_URL_TEST` from env, runs every `tests/rls/*.pgTAP.sql` with `psql -v ON_ERROR_STOP=1`, exits non-zero on first failure.
- Create `tests/rls/_harness_smoke.pgTAP.sql` — 4–6 lines, asserts `current_setting('is_superuser', true)` is `off` for the connected role.
- (Optional) Create `tests/rls/_README.md` explaining how to add more pgTAP files.
- Add a new `rls` job (or step inside the existing `build` job) in `.github/workflows/ci.yml` that spins up a Postgres service container, applies migrations, and runs `bash scripts/test-rls.sh`. Use `DATABASE_URL_TEST` repo secret (the parent will create it).

Out of scope:
- `src/lib/auth/**` — Builder 1 + Builder 2 own that.
- `src/app/**`, `src/components/**` — none of your business.
- `src/db/schema.ts`, `src/db/migrations/**` — Builder 1 + Builder 3 own those.

### File allowlist

- **Allowlist**: `src/db/index.ts`, `src/lib/env.ts` (only to add the two new optional env vars), `src/lib/db/pool.ts` (new — exports `appPool`, `adminPool`, if Builder 1 didn't already), `scripts/test-rls.sh` (new), `tests/rls/_harness_smoke.pgTAP.sql` (new), `tests/rls/_README.md` (new, optional), `.github/workflows/ci.yml` (only the new RLS job / step), `.env.example` (document new env vars).
- **Deny-list (explicit)**: every file under `src/lib/auth/`, every file under `src/app/`, every file under `src/components/`, `src/db/schema.ts`, every file under `src/db/migrations/`, `scripts/apply-pending-migrations.mjs`, every file under `docs/`, plus `package.json`, `pnpm-lock.yaml`, `drizzle.config.ts`, `tsconfig.json`.

### Skills to load (mandatory)

- `implement-spec` — multi-file work (env + pool + script + CI)
- `tdd` — the harness smoke test is your test suite entry point
- `code-structure` — keeps env parsing and pool wiring separate from RLS specifics
- `git-guardrails-claude-code` — CI workflow file is sensitive
- (`pgtap`, `postgres-best-practices`) — would be ideal but are **not installed**

### Implementation steps

1. **Env extension**: in `src/lib/env.ts`, add two optional zod entries inside the existing schema: `DATABASE_APP_ROLE: z.string().optional()` and `DATABASE_APP_ROLE_PASSWORD: z.string().optional()`. Place them directly under the existing `DIRECT_URL` entry.
2. **Pool tightening**: in `src/db/index.ts`, when `env.DATABASE_APP_ROLE` and `env.DATABASE_APP_ROLE_PASSWORD` are both set, build the connection string as `postgresql://${role}:${password}@<host>/<db>` parsed from `env.DATABASE_URL`. When unset, log a `console.warn("[db] running as superuser — RLS policies will be bypassed; set DATABASE_APP_ROLE + DATABASE_APP_ROLE_PASSWORD")` once per process and fall back to `env.DATABASE_URL`. Use `globalThis.__pgPool` memoization as today.
3. **Harness runner**: create `scripts/test-rls.sh`:
   ```sh
   #!/usr/bin/env bash
   set -euo pipefail
   : "${DATABASE_URL_TEST:?DATABASE_URL_TEST must be set}"
   shopt -s nullglob
   for f in tests/rls/*.pgTAP.sql; do
     echo "[rls] running $f"
     psql "$DATABASE_URL_TEST" -v ON_ERROR_STOP=1 -f "$f"
   done
   echo "[rls] all tests passed"
   ```
   `chmod +x scripts/test-rls.sh` and commit the executable bit.
4. **Smoke test**: create `tests/rls/_harness_smoke.pgTAP.sql`:
   ```sql
   BEGIN;
   SELECT plan(1);
   SELECT is(
     current_setting('is_superuser', true),
     'off',
     'app role is not superuser so RLS fires'
   );
   SELECT * FROM finish();
   ROLLBACK;
   ```
5. **CI**: in `.github/workflows/ci.yml`, add a new `rls` job under the existing `jobs:` block:
   ```yaml
   rls:
     runs-on: ubuntu-latest
     services:
       postgres:
         image: postgres:16
         env:
           POSTGRES_PASSWORD: test
           POSTGRES_DB: kavora_test
         ports: ["5432:5432"]
         options: >-
           --health-cmd pg_isready
           --health-interval 10s
           --health-timeout 5s
           --health-retries 5
     steps:
       - uses: actions/checkout@v4
       - uses: pnpm/action-setup@v4
         with: { version: 9 }
       - uses: actions/setup-node@v4
         with: { node-version: 20, cache: pnpm }
       - run: pnpm install --frozen-lockfile
       - name: Install pgTAP
         run: sudo apt-get update && sudo apt-get install -y postgresql-16-pgtap
       - name: Apply migrations
         env:
           DATABASE_URL: postgresql://postgres:test@localhost:5432/kavora_test
         run: node scripts/apply-pending-migrations.mjs
       - name: Run RLS tests
         env:
           DATABASE_URL_TEST: postgresql://postgres:test@localhost:5432/kavora_test
         run: bash scripts/test-rls.sh
   ```
6. **Validate**: `pnpm typecheck` and `pnpm build` must stay clean. If Docker is available locally, `bash scripts/test-rls.sh` against a throwaway Postgres should pass the smoke test.

### Commit message template

```
<type>(<scope>): <subject>

[phase-a/builder-4]
```

Recommended commits in order:
1. `feat(env): DATABASE_APP_ROLE + DATABASE_APP_ROLE_PASSWORD optional env vars`
2. `feat(db): connect via DATABASE_APP_ROLE so RLS policies fire`
3. `test(rls): pgTAP smoke test + executable harness runner`
4. `ci(rls): add rls job to ci.yml with Postgres service container`

### Validation criteria

- `pnpm typecheck` clean.
- `pnpm build` clean.
- `grep -n "DATABASE_APP_ROLE" src/db/index.ts` returns ≥ 1 (the new role is honored).
- `bash -n scripts/test-rls.sh` exits 0 (shell syntax valid).
- `ls -l scripts/test-rls.sh` shows executable bit.
- `tests/rls/_harness_smoke.pgTAP.sql` exists and is syntactically valid SQL.
- `.github/workflows/ci.yml` is still valid YAML.

### Push instructions

Same as the others: rebase, resolve, push to `origin/main`. If a conflict appears on `.github/workflows/ci.yml` (only possible if another builder edited the file — your scope is bounded to the new RLS job, so this should not happen), abort and report back to the parent.

### What to deliver back

- 4 commit SHAs.
- `origin/main` SHA.
- Confirmation that `pnpm typecheck` + `pnpm build` both passed.
- Note whether you ran the harness locally end-to-end (yes / no / partial) and the result.
- The exact lines you added to `.github/workflows/ci.yml` so the parent can spot-check that the existing `build` job was untouched.

---

## 2.5 Critical constraints — apply to ALL builders

- **No co-author trailer.** Do not add `Co-Authored-By: Claude …` or `Generated-By: …` footers.
- **No code comments.** No inline `//` or `/* */` comments inside TS files. Top-of-file module docblocks are fine (the existing `src/lib/auth.ts` and `src/db/schema.ts` show the pattern). Same for SQL: header comments are fine, inline comments inside migration bodies should be avoided unless they disambiguate non-obvious DDL.
- **NEVER run `vercel env pull`** into a git-tracked directory. If env inspection is needed, use `vercel env ls production --scope apotitechs-projects` for inline reads, or pull to `/tmp/`.
- **Each builder commits + pushes its own work.** Do not wait for the other three. Push to `origin/main` directly when your scope is green.
- **Audit log on every mutation.** Server Actions you author must end with `logAudit({ orgId: <resolved from currentOrgId()>, actorUserId, action, entity, entityId, meta })` from `@/lib/audit`.
- **`requireDbUser()` at the top of every Server Action** (matches `src/actions/*.ts` existing convention; do not bypass with raw `auth()`).

---

# PART 3 — Blind Reviewer Prompts (4 parallel)

> Source: `tests/phase-a-reviewers.md` (2,310 words). Each reviewer is **BLIND** to builder planning — they see only the resulting diff against `tests/phase-a-spec.md`.

## 3.0 Common preamble (paste before each reviewer-specific body)

```
You are one of 4 BLIND reviewers for Kavora CRM Phase A. You did NOT write
the code under review; treat every commit as suspect. Your scope is your
dimension across ALL Builder commits that landed on origin/main during
Phase A.1 (use `git log origin/main` and the commit-message tags
`[phase-a/<builder-name>]`).

- Read tests/phase-a-spec.md to know the right answer.
- Diff each commit in your dimension against the spec.
- Run the verification commands listed in your reviewer prompt.
- DO NOT touch unrelated code. If you find a real bug, fix it on a branch,
  commit + push, and report the fix SHA.
- DO NOT comment on style nits or pre-existing smells outside scope.

Output to tests/phase-a-review-<N>.md:
  - PASS / FAIL verdict per Builder commit (1–4).
  - For each FAIL: severity (blocker / major / minor), reproduction, fix
    SHA if you fixed it, one-line rationale.
  - Sign-off at the bottom.

Be skeptical. One verifier command beats ten prose paragraphs.
```

Then paste the reviewer-specific body from §3.1, §3.2, §3.3, or §3.4.

## 3.1 Reviewer 1 — Schema + `currentOrgId()` helper review

**Goal:** Verify the schema + server-side `currentOrgId()` helper correctly resolve the active organization from the Clerk session JWT and seed the `kavora` row, so every downstream Server Action can stop hardcoding `KAVORA_ORG_ID`.

**BLIND REVIEW.** Do NOT look at the builder's prompt or planning artifacts. You see only the resulting diff against `tests/phase-a-spec.md`. Imagine you are a new engineer reviewing this PR with no context beyond the diff and the spec.

**File scope (yours only):** `src/db/schema.ts`, `src/lib/auth.ts`, `src/db/migrations/0006_seed_kavora_org.sql`, any new helper files under `src/lib/org/`. Touch nothing outside this scope; flag cross-scope issues in the report.

**What to review:**
1. Does the migration insert `('kavora', 'Kavora')` exactly once, is it idempotent (`ON CONFLICT DO NOTHING`), and does it match the row the rest of the codebase already treats as canonical?
2. Does `currentOrgId()` return the Clerk session's active `org_id` claim when present, and `null` when the user is not in an org (NOT `KAVORA_ORG_ID` as a fallback — single-tenant fallback is the *seam*, not the default)?
3. Does `requireDbUser()` now scope the auto-provisioned `users` row to the resolved `orgId`, not to `KAVORA_ORG_ID`? Are `logAudit` and downstream callers updated to use the resolved `orgId`?
4. Is `KAVORA_ORG_ID` still exported for backward compatibility (seed + tests), or removed? If removed, is every import updated? Run `grep -r "KAVORA_ORG_ID" src/` and confirm no app-code callers remain.
5. Is the helper cheap (no DB call on the hot path)? Does it tolerate `auth()` returning no user without throwing? Does it cache per-request via `React.cache` so it doesn't hit Clerk twice on the same render?
6. Does the helper handle Clerk's single-tenant fallback mode (when Organizations is disabled in the Clerk dashboard, `auth().orgId` is `null`) by returning `null` — not silently returning `KAVORA_ORG_ID`?
7. Are there unit tests in `tests/unit/current-org-id.test.ts` covering: (a) no Clerk session → null, (b) Clerk session with `org_id` → that id, (c) Clerk session with `null` org_id → null, (d) `requireDbUser` provisions row under the right org, (e) `requireDbUser` does NOT auto-provision when `orgId` is null?

**What tests to write:** `pnpm test tests/unit/current-org-id.test.ts` — vitest with a mocked `@clerk/nextjs/server`. Cover the five cases above plus one asserting that `requireDbUser()` writes the user row's `orgId` from the helper, not from `KAVORA_ORG_ID`. Use `vi.mock("@clerk/nextjs/server", ...)` and `vi.mock("@/db", ...)` so no real network is hit.

**How to run:** `pnpm typecheck && pnpm test tests/unit/current-org-id.test.ts`. If vitest is not yet wired, add the minimal `vitest.config.ts` + a `"test": "vitest run"` script to `package.json` and commit it as part of your fix.

**Fix-it loop:** If any check fails or any test fails, write the smallest fix that satisfies the spec, commit with `pnpm typecheck` passing, push the branch, re-run the tests. Do not report until green.

**Skills to load (mandatory):** `code-review`, `evidence-driven-testing`, `git-commits`.

**Pass/fail criteria:**
- CLEAN: spec checklist passes, unit tests added and green, `pnpm typecheck` clean, diff is the smallest coherent change.
- FIXED: same as CLEAN, plus list each fix commit SHA and one-line summary.

**Output:** Write the report to `tests/phase-a-review-1.md` with status (PASS/FAIL), fixes applied (commit SHAs), and any cross-scope issues that need parent attention.

---

## 3.2 Reviewer 2 — Clerk Organizations integration review

**Goal:** Verify the Clerk webhook correctly syncs organizations and that the dashboard chrome exposes `<OrganizationSwitcher />` so users can pick the active org.

**BLIND REVIEW.** Do NOT look at the builder's prompt or planning artifacts. You see only the resulting diff against `tests/phase-a-spec.md`. Imagine you are a new engineer reviewing this PR with no context beyond the diff and the spec.

**File scope (yours only):** `src/app/api/webhooks/clerk/route.ts`, `src/app/(dashboard)/layout.tsx`, `src/components/dashboard/sidebar.tsx`, `src/components/dashboard/sidebar-brand.tsx`, any new org-switcher / empty-org component under `src/components/`, `src/middleware.ts` if touched, `src/app/layout.tsx` if touched. Touch nothing outside this scope; flag cross-scope issues in the report.

**What to review:**
1. Webhook: handles `organization.created`, `organization.updated`, `organization.deleted`, and `organizationMembership.created` / `deleted`. Does it upsert on `organization.updated` and delete on `organization.deleted`? Does membership upsert map Clerk user → local `users.orgId`? Idempotent on retry (Svix may redeliver)?
2. Webhook signature verification is unchanged (still `svix` + `CLERK_WEBHOOK_SECRET`). Returns 200 fast on success, 401 on bad signature, 500 on missing secret.
3. `<OrganizationSwitcher />` renders inside the dashboard chrome (sidebar brand area or top bar). Keyboard-navigable: focusable, `aria-label`, Escape closes the menu, Enter activates items, arrow keys move between items.
4. Zero-orgs edge case: a signed-in user with no org membership must see a "Create or join an organization" empty state, not a blank sidebar or a crash. The `requireDbUser()` fallback path must not loop forever, and the dashboard layout must not redirect-loop to `/sign-in`.
5. The active org id is the one `currentOrgId()` (Reviewer 1's helper) reads — confirm there's no second source of truth.
6. Middleware (`src/middleware.ts`): if touched, does it still call `auth()` server-side and not bypass Clerk? Is the public-route list still correct?
7. The `ClerkProvider` in the root layout is configured with `appearance` props that make the switcher readable on the existing shadcn sidebar.
8. Tests: integration test in `tests/integration/clerk-webhook.test.ts` that POSTs synthetic payloads (signed with a test `CLERK_WEBHOOK_SECRET`) for `organization.created`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.deleted`, and asserts local rows. A 5th test asserts an unsigned payload returns 401. Render tests in `tests/components/organization-switcher.test.tsx` for the zero-memberships and two-memberships cases.

**What tests to write:** Vitest integration tests using a synthetic `svix` signing helper. Plus a render test (React Testing Library) for the empty-state case and the two-membership case.

**How to run:** `pnpm typecheck && pnpm test tests/integration/clerk-webhook.test.ts && pnpm test tests/components/organization-switcher.test.tsx`.

**Fix-it loop:** On failure, fix in your scope, commit, push, re-run until green.

**Skills to load (mandatory):** `code-review`, `evidence-driven-testing`, `git-commits`, `react`.

**Pass/fail criteria:**
- CLEAN: webhook handles all 5 event types correctly, switcher is keyboard-accessible, zero-orgs empty state works, integration + render tests green, `pnpm typecheck` clean.
- FIXED: list each fix commit SHA + one-line summary.

**Output:** `tests/phase-a-review-2.md` with status, fixes applied (commit SHAs), and cross-scope issues.

---

## 3.3 Reviewer 3 — RLS migration review

**Goal:** Verify every org-scoped table has RLS enabled with complete SELECT/INSERT/UPDATE/DELETE policies, pgTAP isolation tests are correct, and the migration runner will apply this one-shot enablement idempotently.

**BLIND REVIEW.** Do NOT look at the builder's prompt or planning artifacts. You see only the resulting diff against `tests/phase-a-spec.md`. Imagine you are a new engineer reviewing this PR with no context beyond the diff and the spec.

**File scope (yours only):** `src/db/migrations/0007_enable_rls.sql`, `scripts/apply-pending-migrations.mjs` (only the checks-array entry the builder added), `tests/rls/00_setup.sql`, `tests/rls/contacts.pgTAP.sql`, `tests/rls/calls.pgTAP.sql`, `tests/rls/audit_log.pgTAP.sql`, `tests/rls/embeddings.pgTAP.sql`. Touch nothing outside this scope; flag cross-scope issues.

**What to review:**
1. Every table that has `orgId` in `src/db/schema.ts` has `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in the migration. From the schema: `users`, `companies`, `contacts`, `pipelines`, `pipeline_stages`, `deals`, `tags`, `contact_tags`, `notes`, `phone_numbers`, `calls`, `sms_messages`, `activities`, `ai_summaries`, `ai_drafts`, `ai_styles`, `lead_scores`, `embeddings`, `audit_log` — all 19.
2. Every enabled table has policies for **all four** of SELECT / INSERT / UPDATE / DELETE (a partial policy set is worse than no policies because it gives a false sense of safety).
3. Policy names are consistent: e.g. `<table>_org_select`, `<table>_org_insert`, etc. — grep the migration and confirm a single naming pattern.
4. The policy expression reads `org_id = (select public.current_org_id())` or equivalent. The function `public.current_org_id()` is defined in this migration and reads from the Clerk JWT claim.
5. The migration is idempotent: re-running it must not error. Use `CREATE POLICY IF NOT EXISTS` (PG 15+) or wrap in `DO $$ ... $$` with existence checks. Confirm the runner script's check-array entry will detect prior state and skip cleanly.
6. The runner correctly treats this as a one-shot enablement (not a `CREATE OR REPLACE FUNCTION`) — the checks array entry should detect by `EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts')` or similar.
7. `contact_emails` and `contact_phones` (no direct `orgId`, reached via `contact_id`) need policies that resolve the parent contact's org — confirm the migration handles this either by joining to `contacts` or by denying all access from the app role.
8. pgTAP test files pass when run against a fresh DB with the migration applied. Each test covers: (a) JWT with org_id=A → SELECT returns only A's rows; (b) JWT with org_id=B → only B's rows; (c) no JWT → zero rows; (d) INSERT with matching org_id succeeds; (e) INSERT with mismatched org_id **FAILS**.

**What tests to write:** `tests/rls/contacts.pgTAP.sql` and similar — pragmatic, <200 lines per file. Required cases per table: JWT=A → only A rows; JWT=B → only B rows; no JWT → zero rows; INSERT with matching org_id succeeds; INSERT with spoofed org_id FAILS.

**How to run:** `bash scripts/test-rls.sh` (Reviewer 4 wires this up). If the script doesn't exist yet, write a minimal one (`psql "$DATABASE_URL_TEST" -v ON_ERROR_STOP=1 -f tests/rls/contacts.pgTAP.sql`) and commit it as part of your fix.

**Fix-it loop:** On any failure or missing table/policy, fix the migration (or the test if the test is wrong), commit, push, re-run until green.

**Skills to load (mandatory):** `code-review`, `evidence-driven-testing`, `git-commits`, `axiom-analyze-test-failures`.

**Pass/fail criteria:**
- CLEAN: 19 tables enabled with full 4-policy coverage, idempotent, runner-aware, pgTAP green, runner-script exits non-zero on failure.
- FIXED: list each fix commit SHA + one-line summary.

**Output:** `tests/phase-a-review-3.md` with status, fixes applied (commit SHAs), and cross-scope issues.

---

## 3.4 Reviewer 4 — Connection role + pgTAP harness review

**Goal:** Verify the Drizzle pool connects as a non-superuser role by default (so RLS policies actually fire) and that the pgTAP harness runs in CI.

**BLIND REVIEW.** Do NOT look at the builder's prompt or planning artifacts. You see only the resulting diff against `tests/phase-a-spec.md`. Imagine you are a new engineer reviewing this PR with no context beyond the diff and the spec.

**File scope (yours only):** `src/db/index.ts`, `src/lib/env.ts`, `src/lib/db/pool.ts` (if created), `scripts/test-rls.sh`, `.github/workflows/ci.yml` (only the new RLS job step), `tests/rls/_harness_smoke.pgTAP.sql`, `tests/rls/_README.md`. Touch nothing outside this scope; flag cross-scope issues.

**What to review:**
1. `src/db/index.ts`: the `Pool` connects as a role that is NOT `postgres` / NOT a superuser. Confirm by parsing the new `DATABASE_APP_ROLE` / `DATABASE_APP_ROLE_PASSWORD` pair from `env.ts` and using them in the connection string. The Drizzle pool must not silently keep using the superuser path.
2. Migrations still run via `DIRECT_URL` (the elevated path) — confirm the migration runner doesn't share the app pool.
3. `scripts/test-rls.sh` exists, is executable (`chmod +x`), accepts a `DATABASE_URL_TEST` env var, sets `ON_ERROR_STOP=1`, runs every `tests/rls/*.pgTAP.sql` file, and **exits non-zero on any failure**.
4. CI workflow has a new job (or step) that runs the script on PRs against `main`. It should provision a fresh test DB (or use a service container) and apply all migrations before running pgTAP.
5. A `tests/rls/_harness_smoke.pgTAP.sql` exists that asserts `current_setting('is_superuser')` is `off` for the connected role.
6. `pnpm typecheck` is still green after your changes.

**What tests to write:** `tests/rls/_harness_smoke.pgTAP.sql` (4–6 lines: `SELECT plan(1); SELECT is(current_setting('is_superuser', true), 'off', 'app role is not superuser'); SELECT * FROM finish();`). Plus confirm Reviewer 3's pgTAP files pass under the harness — run it end-to-end.

**How to run:** `bash scripts/test-rls.sh` locally with `DATABASE_URL_TEST` pointing at a test DB. In CI: push to a branch and confirm the `ci.yml` RLS job runs and is required.

**Fix-it loop:** On failure, fix in your scope (script, CI step, connection config), commit, push, re-run locally AND confirm CI job definition is valid.

**Skills to load (mandatory):** `code-review`, `evidence-driven-testing`, `git-commits`, `axiom-analyze-test-failures`.

**Pass/fail criteria:**
- CLEAN: app pool connects as non-superuser, migrations still use `DIRECT_URL`, `scripts/test-rls.sh` runs all pgTAP files and exits non-zero on failure, CI job runs on PRs, harness smoke test proves non-superuser, `pnpm typecheck` clean.
- FIXED: list each fix commit SHA + one-line summary.

**Output:** `tests/phase-a-review-4.md` with status, fixes applied (commit SHAs), and cross-scope issues.

---

## 3.5 Cross-reviewer notes (for the parent only — not for the reviewers)

- Reviewer 3 and Reviewer 4 share the pgTAP file format. The reviewer who writes the file first (Reviewer 3) should keep it under `tests/rls/`. Reviewer 4 owns the runner script and the smoke test, not the cross-tenant isolation tests.
- Reviewer 1 and Reviewer 2 share the `currentOrgId()` seam. Reviewer 1 owns the helper; Reviewer 2 must not reimplement it. If Reviewer 2 finds the helper wrong for the switcher use case, they report it as a cross-scope issue in `tests/phase-a-review-2.md` rather than fixing it themselves.
- All four reviewers report into the parent session, not into each other. The parent reconciles cross-scope issues, orders any second-round fixes, and only then declares Phase A complete.

---

# PART 4 — Master Orchestration + Skills Catalog

> Source: `tests/phase-a-orchestration.md` (2,374 words). PART A is the
> step-by-step orchestration the parent agent (Mavis) executes when Lionel feeds
> it the consolidated Phase A prompt. PART B maps each agent (4 builders + 4
> reviewers) to the **real** skills on this computer.

## PART A — Master Orchestration Prompt

### Context

Kavora CRM is single-tenant. Every business table already carries `orgId`
(always `"kavora"`), the Clerk webhook already syncs `users`, and the schema
was pre-wired for multi-tenant (see `docs/ARCHITECTURE.md` §"Data model").
Phase A flips the switch: enable Clerk Organizations, enable Row-Level
Security on all 18 tables, add a pgTAP harness at `tests/rls/`, migrate the
Drizzle pool to a non-superuser role. Reference: `docs/research/ai-agency/
research-multi-tenant-architecture.md` §5.

### Prerequisites — verify before launching

Every box must be checked before Phase A.1.

- [ ] Working directory is the `kavora-crm` repo.
- [ ] `git fetch origin main && git status` — tree clean on `origin/main`.
- [ ] `pnpm install` finished without error.
- [ ] `pnpm typecheck` passes on a fresh clone.
- [ ] `pnpm build` passes on a fresh clone.
- [ ] `.env.local` (or Vercel env) carries `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
      and `CLERK_SECRET_KEY`. **Live keys (`pk_live_*` / `sk_live_*`) must be
      swapped in before the Clerk builder runs** — confirm with Lionel.
- [ ] `DATABASE_URL` and `DIRECT_URL` point at a writable Postgres. Run
      `node scripts/apply-pending-migrations.mjs` once; it should report
      "all caught up".
- [ ] This document exists at `docs/research/ai-agency/phase-a-prompt.md`.
- [ ] `git remote -v` returns the Kavora-Systems GitHub remote, and the
      target branches each builder pushes to are reachable.

If any prerequisite fails, **stop and report** the failing command and its
output. Do not start builders on a broken checkout.

### Phase A.1 — Launch 4 parallel builders

Launch all 4 in **one assistant turn** with `run_in_background: true` so they
truly run concurrently. Each builder is a `worker` session.

**Common prompt preamble** — paste before the builder-specific body (§2.0):

```
You are one of 4 parallel builders for Kavora CRM Phase A. Your scope is
the file list below — do not edit anything outside it, even if you spot
smells. Cross-cutting changes go in tests/phase-a-issues.md and proceed
without them.

Conventions (see docs/AGENTS.md, docs/SETUP.md):
- Each commit: run `pnpm typecheck && pnpm build` before pushing.
- Commit per logical unit; push to origin/main.
- Tag commit messages `[phase-a/<builder-name>]`.
- DO NOT touch .env.local; do NOT run `vercel env pull` into the workspace
  (see AGENTS.md don'ts).
- NO Co-Authored-By trailer; NO Generated-by footer.
- NO code comments inside TS files (only top-of-file module docblocks OK).

After every commit, report:
  { sha, branch, files_touched, typecheck_status, build_status, smoke_status }

Final summary: list all commit SHAs pushed, any changes to
scripts/apply-pending-migrations.mjs (migrations always need a check entry),
and any deviations from the spec.

Your scope (from docs/research/ai-agency/phase-a-prompt.md):
```

Then paste the builder-specific body from §2.1, §2.2, §2.3, or §2.4. Wait for all 4 completions.

**Failure handling**

For small fixes (missing import, undeclared env, single broken test): parent
fixes directly via `--amend` or a follow-up commit. For larger fixes
(missing prerequisite, scope creep): spin up a focused follow-up builder
with a one-paragraph description of the failure. **Do NOT proceed to
Phase A.2 until all 4 builders are green** — RLS mistakes are silent, the
only signal we have is a fully green Phase A.1 + Phase A.3.

### Phase A.2 — Integration commit (parent)

1. `git fetch origin main && git pull --rebase origin main`.
2. `git log --oneline origin/main -20`; identify cross-cutting seams
   (barrel files, `src/lib/org.ts`, `src/lib/db.ts`, sidebar imports, the
   migration runner checks array). Resolve conflicts in favour of the most
   conservative change — lowest privilege, smallest public surface.
3. `pnpm install && pnpm typecheck && pnpm build`.
4. `node scripts/apply-pending-migrations.mjs` against `DIRECT_URL` —
   must report "all caught up" with new migrations included.
5. Add an **integration commit** `[phase-a/integration]` if there is any
   rebase drift or doc fix; if clean, this commit *is* the docs commit from
   Phase A.5.

### Phase A.3 — Launch 4 parallel blind reviewers

Mirror Phase A.1's launch shape. Prompts come from §3.1, §3.2, §3.3, §3.4. Each reviewer is a fresh `worker` session, all 4 in one turn, `run_in_background: true`.

**Common reviewer preamble** — paste before the reviewer-specific body (§3.0):

```
You are one of 4 BLIND reviewers for Kavora CRM Phase A. You did NOT write
the code under review; treat every commit as suspect. Your scope is your
dimension across ALL Builder commits that landed on origin/main during
Phase A.1 (use `git log origin/main` and the commit-message tags
`[phase-a/<builder-name>]`).

- Read tests/phase-a-spec.md to know the right answer.
- Diff each commit in your dimension against the spec.
- Run the verification commands listed in your reviewer prompt.
- DO NOT touch unrelated code. If you find a real bug, fix it on a branch,
  commit + push, and report the fix SHA.
- DO NOT comment on style nits or pre-existing smells outside scope.

Output to tests/phase-a-review-<N>.md:
  - PASS / FAIL verdict per Builder commit (1–4).
  - For each FAIL: severity (blocker / major / minor), reproduction, fix
    SHA if you fixed it, one-line rationale.
  - Sign-off at the bottom.

Be skeptical. One verifier command beats ten prose paragraphs.
```

Wait for all 4 completions. A blocker or major FAIL gates Phase A.4 until
fixed and re-checked. Minor findings roll into Phase A.5 docs.

### Phase A.4 — Final smoke test

Run in order; each must succeed before the next.

1. **Fresh-DB RLS smoke** (on a throwaway DB, not production):
   ```bash
   bash scripts/test-rls.sh
   ```
   (Or `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/*.pgTAP.sql` if the script doesn't exist yet.)
2. **Type/lint**: `pnpm typecheck && pnpm build && pnpm lint`.
3. **Vercel preview** — confirm latest `origin/main` built (check via
   `vercel inspect <preview-url>` or the dashboard; never paste tokens).
4. **Clerk org switcher round-trip** — log in as a user in 2 test orgs,
   switch `<OrganizationSwitcher />`, confirm the dashboard re-fetches and
   the JWT `org_id` claim matches.
5. **Settings → Integrations** — confirm per-tenant Twilio subaccount
   status rows surface where appropriate. (N/A for Phase A — Twilio is still single-account; leave the check as a placeholder.)

### Phase A.5 — Docs refresh + commit

One commit `[phase-a/docs]`:

- `docs/ARCHITECTURE.md` §"Data model" — remove the single-tenant stub
  sentence; document the new RLS posture and link to `tests/rls/`.
- `docs/SETUP.md` — new env vars (Clerk Organizations webhook events; any
  per-tenant Twilio env vars) and the new smoke commands.
- `docs/research/ai-agency/README.md` — one-paragraph Phase A outcome
  with links to the four review reports.
- `docs/AGENTS.md` "Where to make changes" — `src/lib/org.ts` is now the
  canonical helper; any new entity must include a RLS policy block.

Commit, push, verify Vercel preview deploys again.

### Phase A.6 — Done criteria (all must be true)

- [ ] `pnpm typecheck` passes on `origin/main`.
- [ ] `pnpm build` passes on `origin/main`.
- [ ] `pnpm lint` passes (or a disabled-rule is documented).
- [ ] `tests/rls/*.sql` (or `scripts/test-rls.sh`) exists and exits 0 on
      a throwaway DB — cross-tenant SELECT, INSERT, UPDATE, DELETE each
      rejected for the wrong `orgId`.
- [ ] Clerk Organizations live: `<OrganizationSwitcher />` renders, switch
      reloads dashboard with new org's data, JWT `org_id` claim matches.
- [ ] All 4 builders' commits and all 4 reviewers' reports are on
      `origin/main` (reports in `tests/`).
- [ ] `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `docs/AGENTS.md` updated
      and committed.
- [ ] Vercel production deploy succeeded; manual check for Sentry
      regressions 24 h post-deploy (flagged for Lionel).
- [ ] Every reviewer-reported blocker / major has a fix SHA referenced
      from `tests/phase-a-review-{N}.md`.

When all boxes are true:

```
Phase A — DONE.

Builders: 4/4 green on origin/main
Reviewers: 4/4 reports filed; 0 blockers, <N> majors, <M> minors
RLS pgTAP: tests/rls/ — passes on fresh DB
Clerk Orgs: <OrganizationSwitcher /> round-trip verified
Vercel: production deploy succeeded
Docs: ARCHITECTURE.md / SETUP.md / AGENTS.md updated
```

## PART B — Skills Catalog Mapping

Verified against `ls /Users/lionel/.minimax/skills/` on 2026-09-24 (515 skill folders). Each `SKILL.md` path below was opened and its front-matter cross-checked. Cells marked **not installed** are honest — no skill is fabricated.

> **Note:** Scout 4 originally mapped skills to Builders 3 & 4 as "Per-tenant Twilio subaccounts" and "Onboarding" (which is Phase B, not Phase A). The skills themselves are still real; the labels below are remapped to match the actual Phase A builders.

### Builders

| Agent | Required skills | SKILL.md path | Status |
|---|---|---|---|
| **Builder 1 — DB schema + currentOrgId() + seed** (drops `KAVORA_ORG_ID`, ships `src/lib/org/current-org-id.ts`, seeds `organizations` via 0006, unit tests for the helper) | `implement-spec` — pattern for "implement the work described in the spec", commits per logical unit, runs typecheck between, calls code-review at the end | `/Users/lionel/.minimax/skills/implement-spec/SKILL.md` | verified |
| | `tdd` — unit tests are part of Builder 1's scope (the orgId helper) | `/Users/lionel/.minimax/skills/tdd/SKILL.md` | verified |
| | `code-structure` — keeps the auth seam (`src/lib/org/`) separate from the DB seam (`src/db/`) | `/Users/lionel/.minimax/skills/code-structure/SKILL.md` | verified |
| | `git-guardrails-claude-code` — schema refactor is sensitive | `/Users/lionel/.minimax/skills/git-guardrails-claude-code/SKILL.md` | verified |
| | (`react`, `supabase-postgres-best-practices`) — would be ideal | — | **not installed** |
| **Builder 2 — Clerk Organizations + UI** (`src/app/api/webhooks/clerk/route.ts`, `<OrganizationSwitcher />`, zero-orgs empty state, integration + render tests) | `implement-spec` — multi-file TS work | `/Users/lionel/.minimax/skills/implement-spec/SKILL.md` | verified |
| | `code-structure` — keeps auth + policy in actions, pushes SDK mechanics into `src/components/dashboard/sidebar-*.tsx` | `/Users/lionel/.minimax/skills/code-structure/SKILL.md` | verified |
| | `new-feature` — worktree per task so Builder 2's edits never collide with Builder 1's | `/Users/lionel/.minimax/skills/new-feature/SKILL.md` | verified |
| | (`react`, `clerk`, `nextjs`) — would tailor UI work to Next 15 App Router | — | **not installed** |
| **Builder 3 — RLS migration + pgTAP isolation tests** (`0007_enable_rls.sql`, `scripts/apply-pending-migrations.mjs` runner entry, `tests/rls/*.pgTAP.sql`) | `implement-spec` — pattern for implementing a DB migration spec | `/Users/lionel/.minimax/skills/implement-spec/SKILL.md` | verified |
| | `tdd` — pgTAP tests are TDD for the migration | `/Users/lionel/.minimax/skills/tdd/SKILL.md` | verified |
| | `code-structure` — keeps the migration self-contained (extension + function + policies in one file) | `/Users/lionel/.minimax/skills/code-structure/SKILL.md` | verified |
| | `git-guardrails-claude-code` — migration files are sensitive | `/Users/lionel/.minimax/skills/git-guardrails-claude-code/SKILL.md` | verified |
| | (`pgtap`, `supabase-rls`, `postgres-best-practices`) — would be ideal | — | **not installed** |
| **Builder 4 — Connection role + pgTAP harness + CI** (`src/db/index.ts` two-pool design, `scripts/test-rls.sh`, `tests/rls/_harness_smoke.pgTAP.sql`, `.github/workflows/ci.yml` rls job) | `implement-spec` — multi-file work (env + pool + script + CI) | `/Users/lionel/.minimax/skills/implement-spec/SKILL.md` | verified |
| | `tdd` — the harness smoke test is your test suite entry point | `/Users/lionel/.minimax/skills/tdd/SKILL.md` | verified |
| | `code-structure` — keeps env parsing and pool wiring separate from RLS specifics | `/Users/lionel/.minimax/skills/code-structure/SKILL.md` | verified |
| | `git-guardrails-claude-code` — CI workflow file is sensitive | `/Users/lionel/.minimax/skills/git-guardrails-claude-code/SKILL.md` | verified |
| | (`pgtap`, `postgres-best-practices`) — would be ideal | — | **not installed** |

### Blind reviewers

| Agent | Required skills | SKILL.md path | Status |
|---|---|---|---|
| **Reviewer 1 — Schema + currentOrgId() review** (walks every commit Builder 1 pushed; verifies `KAVORA_ORG_ID` constant is gone; confirms `currentOrgId()` returns null in single-tenant fallback mode) | `code-review` — file-scoped checklist walk | `/Users/lionel/.minimax/skills/code-review/SKILL.md` | verified |
| | `evidence-driven-testing` — vitest unit tests as the headless evidence path | `/Users/lionel/.minimax/skills/evidence-driven-testing/SKILL.md` | verified |
| | `git-commits` — verify commit-message convention (no coauthor trailer) | (not installed; closest is `git-guardrails-claude-code`) | not installed |
| **Reviewer 2 — Clerk Organizations review** (walks every Clerk-touching file Builder 2 pushed; asserts `org_id` is propagated; smoke-tests `<OrganizationSwitcher />` on the preview deploy) | `code-review` — same walk-the-files discipline; reviewers flag, don't write code | `/Users/lionel/.minimax/skills/code-review/SKILL.md` | verified |
| | `evidence-driven-testing` — captures an annotated screen recording of the org-switcher round-trip (GUI path of this skill) | `/Users/lionel/.minimax/skills/evidence-driven-testing/SKILL.md` | verified |
| | `git-commits` — verify commit-message convention | — | not installed |
| | (`react`) — would help with render test composition | — | **not installed** |
| **Reviewer 3 — RLS migration review** (walks Builder 3's policies against `src/db/schema.ts`; runs pgTAP on a fresh DB; verifies 4-policy coverage on every org-scoped table; checks runner entry is idempotent) | `code-review` — walks each migration file with the structured checklist | `/Users/lionel/.minimax/skills/code-review/SKILL.md` | verified |
| | `evidence-driven-testing` — pgTAP plans are the canonical "API / performance" evidence: measured counts + before/after pairs | `/Users/lionel/.minimax/skills/evidence-driven-testing/SKILL.md` | verified |
| | `axiom-analyze-test-failures` — if pgTAP fails, classify *why* (policy gap vs. fixture issue vs. runner ordering) | `/Users/lionel/.minimax/skills/axiom-analyze-test-failures/SKILL.md` | verified |
| | `git-commits` | — | not installed |
| **Reviewer 4 — pgTAP harness + CI review** (walks Builder 4's pool + script + CI job; runs `scripts/test-rls.sh` end-to-end against a throwaway DB; verifies CI yaml is valid and the smoke test passes) | `code-review` — walks the test scaffolding files Builder 4 produced | `/Users/lionel/.minimax/skills/code-review/SKILL.md` | verified |
| | `evidence-driven-testing` — `bash scripts/test-rls.sh` output is the canonical smoke-test evidence | `/Users/lionel/.minimax/skills/evidence-driven-testing/SKILL.md` | verified |
| | `axiom-analyze-test-failures` — flaky or passing-only-locally pgTAP | `/Users/lionel/.minimax/skills/axiom-analyze-test-failures/SKILL.md` | verified |
| | `git-commits` | — | not installed |

### Honest accounting — skills we would have loved but don't exist

The following are commonly reached for in a Next 15 / Clerk / Supabase /
pgTAP / Twilio project and are **not present** on this computer. Treat the
absence as a coordination cost — the builders and reviewers compensate
inline.

- `react`, `nextjs`, `next-js-app-router`, `nextjs-best-practices`
- `clerk`, `clerk-organizations`, `@clerk/nextjs`
- `supabase`, `supabase-rls`, `supabase-postgres-best-practices`,
  `supabase-vault`
- `pgtap`, `pgTAP`, `postgres-best-practices`, `drizzle-best-practices`
- `twilio`, `twilio-subaccounts`, `twilio-webhooks`
- `git-commits` — closest installed skill is `git-guardrails-claude-code`,
  which targets Claude Code hooks, not commit-message conventions. Reviewers
  rely on the explicit "NO Co-Authored-By trailer; NO Generated-by footer"
  constraint in the builder prompts instead.
- `release`, `gate-and-ship`, `ship`, `ship-ci-review-loop` — `launch`
  exists but it is the marketing-launch skill, not a code-release skill

If any become critical for a future phase, ask Lionel to install them
before launching the next phase.

---

## Caveats and Open Questions

1. **`tests/phase-a-spec.md` was written before the builder/reviewer prompts**, but the prompts were derived from the same research doc + schema inspection, so the allowlists are consistent. The spec is the canonical source of truth for "what Phase A means" — builders and reviewers should defer to it if there's any conflict.

2. **Scout 4's PART B originally had the wrong builder scopes** — it listed Builders 3 and 4 as "Per-tenant Twilio subaccounts" and "Onboarding" (which is Phase B, not Phase A). The skills themselves are still real; this consolidated doc remaps them to match the actual Phase A builders (RLS migration + pgTAP harness).

3. **`KAVORA_ORG_ID` deprecation vs removal**: the spec keeps the constant as a `@deprecated` re-export for back-compat (seed + tests), but every reviewer must check `grep -r "KAVORA_ORG_ID" src/` returns zero non-deprecation hits. If you want full removal instead, update §1.2.1 to delete the line entirely — but this requires touching more files outside Builder 1's scope.

4. **`organizations` table RLS**: the spec leaves `organizations` out of the 18 enabled tables so Builder 1's seed and Builder 2's webhook can still upsert. If you want app-role reads of foreign orgs blocked, enable RLS on `organizations` too — but that requires a SECURITY DEFINER RPC path for the webhook, which is out of scope for Phase A.

5. **pgTAP extension privilege**: `CREATE EXTENSION pgtap` needs superuser. The migration runner uses `DIRECT_URL` (which is the superuser path in the two-pool design), so this works. If the runner is ever migrated to use the app pool, the extension creation needs to be split into a separate admin-only step.

6. **Reviewer 3 / Reviewer 4 split on pgTAP**: Reviewer 3 owns the cross-tenant isolation tests (`tests/rls/contacts.pgTAP.sql` etc.); Reviewer 4 owns the runner (`scripts/test-rls.sh`) and the smoke test (`tests/rls/_harness_smoke.pgTAP.sql`). If a pgTAP test fails, Reviewer 3 fixes the test or the migration; if the runner script fails, Reviewer 4 fixes it. Cross-scope ownership is documented in §3.5.

7. **Builder 1 / Builder 4 overlap on `src/lib/db/pool.ts`**: Builder 4 may need to create this file; Builder 1 may also touch it via `src/db/index.ts`. If both end up creating it, the parent integration commit resolves the conflict. The simplest split is: Builder 1 owns the pool file, Builder 4 owns the env wiring.

8. **`vitest` not yet wired**: if `pnpm test` doesn't exist yet, Builder 1 (and Reviewer 1) needs to add `vitest.config.ts` + a `"test": "vitest run"` script to `package.json`. The deny-list allows this — `package.json` is in Builder 1's allowlist for this specific change.

9. **Live Clerk keys prerequisite**: Phase A.0 prereqs require `pk_live_*` / `sk_live_*` swapped in before Builder 2 runs. The cron reminder `ba2a9344-64b3-43b7-8ae9-1a960224e2f8` fires Sat Sep 27 ~16:08 MDT. Confirm with Lionel before Phase A.1.

10. **Skill `git-commits` not installed**: reviewers can't load it. They compensate by enforcing the explicit "no coauthor trailer" + "no generated-by footer" constraint from each builder prompt directly. If you want them to use a skill instead, install it before Phase A.3.

---

*End of Phase A master prompt. Total: ~13,000 words. To execute, paste this entire document (or its path) back to the parent agent (Mavis) along with the message: "Execute Phase A."*
