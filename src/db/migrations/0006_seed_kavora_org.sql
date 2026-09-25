-- Kavora CRM — seed the canonical Kavora organization row
-- Inserts the singleton row that every other table's `org_id` references.
-- Idempotent: a re-run against an existing DB is a no-op (`ON CONFLICT DO NOTHING`).
-- Companion seed script: `src/db/seed-organization.ts` (standalone DIRECT_URL backfill).

INSERT INTO "organizations" ("id", "name")
VALUES ('kavora', 'Kavora')
ON CONFLICT ("id") DO NOTHING;
