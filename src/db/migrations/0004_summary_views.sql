-- Kavora CRM — summary views for list screens
-- Read-time aggregates for the contacts and companies list/detail pages, so the
-- app layer never has to N+1 a deals/calls/sms/activities count from Drizzle.
-- Pattern lifted from atomic-crm's 03_views.sql (see docs/research/atomic-crm
-- §5 / §13 item 5 and apply-to-kavora T2-2). `count(distinct ...)` over a
-- LEFT JOIN keeps the per-row fan-out under control, and the view itself hides
-- soft-deleted contacts (`contacts.deleted_at` was added in 0003).
--
-- Assumed schema (verified against 0001_init.sql / 0003_soft_delete_contacts.sql):
--   contacts      : deleted_at          (added in 0003)
--   companies     : NO deleted_at column — no soft-delete filter needed
--   deals         : NO deleted_at column — count all deals (no soft-delete filter)
--   calls         : contact_id, org_id, created_at
--   sms_messages  : contact_id, org_id, created_at
--   activities    : contact_id, org_id, occurred_at  (NOT created_at)
--
-- Out of scope (YAGNI):
--   - activity_log UNION ALL view  → T3-1 introduces a real event store first.
--   - security_invoker             → PG version is not pinned in the repo.

-- ─── contacts_summary ──────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.contacts_summary AS
SELECT
  c.id,
  c.org_id,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.status,
  c.company_id,
  c.created_at,
  c.updated_at,
  c.deleted_at,
  count(DISTINCT d.id)  FILTER (WHERE d.id  IS NOT NULL)::int        AS nb_deals,
  count(DISTINCT ca.id) FILTER (WHERE ca.id IS NOT NULL)::int        AS nb_calls,
  count(DISTINCT sm.id) FILTER (WHERE sm.id IS NOT NULL)::int        AS nb_sms,
  GREATEST(
    max(a.occurred_at),
    max(ca.created_at),
    max(sm.created_at)
  ) AS last_activity_at
FROM "contacts" c
LEFT JOIN "deals"         d  ON d."contact_id"  = c."id" AND d."org_id"  = c."org_id"
LEFT JOIN "calls"         ca ON ca."contact_id" = c."id" AND ca."org_id" = c."org_id"
LEFT JOIN "sms_messages"  sm ON sm."contact_id" = c."id" AND sm."org_id" = c."org_id"
LEFT JOIN "activities"    a  ON a."contact_id"  = c."id" AND a."org_id"  = c."org_id"
WHERE c."deleted_at" IS NULL
GROUP BY c."id";

-- ─── companies_summary ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.companies_summary AS
SELECT
  co.id,
  co.org_id,
  co.name,
  co.domain,
  co.industry,
  co.size,
  co.created_at,
  co.updated_at,
  count(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL)::int            AS nb_contacts,
  count(DISTINCT d.id) FILTER (WHERE d.id IS NOT NULL)::int            AS nb_deals,
  count(DISTINCT d.id) FILTER (WHERE d.id IS NOT NULL AND d."status" = 'open')::int AS nb_open_deals
FROM "companies" co
LEFT JOIN "contacts" c ON c."company_id" = co."id" AND c."org_id" = co."org_id" AND c."deleted_at" IS NULL
LEFT JOIN "deals"    d ON d."company_id" = co."id" AND d."org_id" = co."org_id"
GROUP BY co."id";
