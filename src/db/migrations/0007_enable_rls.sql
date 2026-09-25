-- Kavora CRM — enable Row-Level Security on every org-scoped table
-- Multi-tenant isolation is the canonical guarantee that a request scoped to
-- Clerk Organization `org_xxx` cannot read or mutate rows tagged with a
-- different `org_id`. This migration is the keystone of the Phase A multi-tenant
-- migration (see docs/research/ai-agency/phase-a-prompt.md §1.4).
--
-- Design notes:
--   * `auth.jwt()` is a Supabase built-in — returns the current request's JWT
--     claims as jsonb. Our `current_org_id()` helper reads the `org_id` claim
--     and returns it as text (NULL when the claim is missing → fail-closed).
--   * Every org-scoped table gets four policies (SELECT USING / INSERT WITH
--     CHECK / UPDATE USING+WITH CHECK / DELETE USING), all keyed on
--     `org_id = public.current_org_id()`. WITH CHECK on INSERT/UPDATE blocks
--     the cross-tenant smuggling class of bugs (R1 in the risk register).
--   * Migration creates NO data — it only adds policies. Re-running is safe:
--     every CREATE POLICY is preceded by DROP POLICY IF EXISTS, and ALTER
--     TABLE … ENABLE ROW LEVEL SECURITY is idempotent.
--   * Two child tables (`contact_emails`, `contact_phones`) carry no `org_id`
--     of their own; the app joins them via `contacts`. Until a SECURITY
--     DEFINER RPC exists, deny-all on the app role is correct: read paths
--     should never touch them directly. Phase A follow-up adds RPCs as needed.
--   * `CREATE EXTENSION pgtap` is bundled here so the migration is self-
--     contained and the pgTAP harness (`tests/rls/*.pgTAP.sql`) can resolve
--     `pgtap` regardless of who applied the migration. R7: this requires a
--     superuser / CREATE EXTENSION privilege — the runner uses DIRECT_URL,
--     which is the Supabase `postgres` role, so this is fine.
--   * Idempotency detection for this entry lives in
--     `scripts/apply-pending-migrations.mjs` (uses pg_policies, not
--     pg_proc.prosrc, because no function is created here — R8).
--
-- Scope:
--   18 org-scoped tables get full SELECT/INSERT/UPDATE/DELETE policies:
--     users, companies, contacts, pipelines, pipeline_stages, deals,
--     tags, notes, phone_numbers, calls, sms_messages, activities,
--     ai_summaries, ai_drafts, ai_styles, lead_scores, embeddings, audit_log
--   2 child tables (`contact_emails`, `contact_phones`) get a deny-all policy
--   so Phase A's read-time joins remain the only authorized access path.
--
-- Out of scope:
--   * per-org RLS for `organizations` — left out so Builder 1's seed
--     (`0006_seed_kavora_org.sql`) and Builder 2's Clerk webhook (which
--     upserts/deletes the `organizations` row) can run without tripping
--     their own policies. Webhook runs through the migration-time admin pool.
--   * `contact_tags` join table — no org_id column by design; isolation
--     inherited via its FKs to contacts/tags. No policy needed.
--   * `pgcrypto` / `vector` are already installed by `0001_init.sql`.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'org_id'
$$;

-- ─── users ────────────────────────────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_org_select ON users;
CREATE POLICY users_org_select ON users FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS users_org_insert ON users;
CREATE POLICY users_org_insert ON users FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS users_org_update ON users;
CREATE POLICY users_org_update ON users FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS users_org_delete ON users;
CREATE POLICY users_org_delete ON users FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── companies ────────────────────────────────────────────────────────────────

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_org_select ON companies;
CREATE POLICY companies_org_select ON companies FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS companies_org_insert ON companies;
CREATE POLICY companies_org_insert ON companies FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS companies_org_update ON companies;
CREATE POLICY companies_org_update ON companies FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS companies_org_delete ON companies;
CREATE POLICY companies_org_delete ON companies FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── contacts ────────────────────────────────────────────────────────────────

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_org_select ON contacts;
CREATE POLICY contacts_org_select ON contacts FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS contacts_org_insert ON contacts;
CREATE POLICY contacts_org_insert ON contacts FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS contacts_org_update ON contacts;
CREATE POLICY contacts_org_update ON contacts FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS contacts_org_delete ON contacts;
CREATE POLICY contacts_org_delete ON contacts FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── pipelines ───────────────────────────────────────────────────────────────

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipelines_org_select ON pipelines;
CREATE POLICY pipelines_org_select ON pipelines FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS pipelines_org_insert ON pipelines;
CREATE POLICY pipelines_org_insert ON pipelines FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS pipelines_org_update ON pipelines;
CREATE POLICY pipelines_org_update ON pipelines FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS pipelines_org_delete ON pipelines;
CREATE POLICY pipelines_org_delete ON pipelines FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── pipeline_stages ─────────────────────────────────────────────────────────

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipeline_stages_org_select ON pipeline_stages;
CREATE POLICY pipeline_stages_org_select ON pipeline_stages FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS pipeline_stages_org_insert ON pipeline_stages;
CREATE POLICY pipeline_stages_org_insert ON pipeline_stages FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS pipeline_stages_org_update ON pipeline_stages;
CREATE POLICY pipeline_stages_org_update ON pipeline_stages FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS pipeline_stages_org_delete ON pipeline_stages;
CREATE POLICY pipeline_stages_org_delete ON pipeline_stages FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── deals ───────────────────────────────────────────────────────────────────

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deals_org_select ON deals;
CREATE POLICY deals_org_select ON deals FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS deals_org_insert ON deals;
CREATE POLICY deals_org_insert ON deals FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS deals_org_update ON deals;
CREATE POLICY deals_org_update ON deals FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS deals_org_delete ON deals;
CREATE POLICY deals_org_delete ON deals FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── tags ─────────────────────────────────────────────────────────────────────

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tags_org_select ON tags;
CREATE POLICY tags_org_select ON tags FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS tags_org_insert ON tags;
CREATE POLICY tags_org_insert ON tags FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS tags_org_update ON tags;
CREATE POLICY tags_org_update ON tags FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS tags_org_delete ON tags;
CREATE POLICY tags_org_delete ON tags FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── notes ────────────────────────────────────────────────────────────────────

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notes_org_select ON notes;
CREATE POLICY notes_org_select ON notes FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS notes_org_insert ON notes;
CREATE POLICY notes_org_insert ON notes FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS notes_org_update ON notes;
CREATE POLICY notes_org_update ON notes FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS notes_org_delete ON notes;
CREATE POLICY notes_org_delete ON notes FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── phone_numbers ───────────────────────────────────────────────────────────

ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phone_numbers_org_select ON phone_numbers;
CREATE POLICY phone_numbers_org_select ON phone_numbers FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS phone_numbers_org_insert ON phone_numbers;
CREATE POLICY phone_numbers_org_insert ON phone_numbers FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS phone_numbers_org_update ON phone_numbers;
CREATE POLICY phone_numbers_org_update ON phone_numbers FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS phone_numbers_org_delete ON phone_numbers;
CREATE POLICY phone_numbers_org_delete ON phone_numbers FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── calls ────────────────────────────────────────────────────────────────────

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calls_org_select ON calls;
CREATE POLICY calls_org_select ON calls FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS calls_org_insert ON calls;
CREATE POLICY calls_org_insert ON calls FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS calls_org_update ON calls;
CREATE POLICY calls_org_update ON calls FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS calls_org_delete ON calls;
CREATE POLICY calls_org_delete ON calls FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── sms_messages ────────────────────────────────────────────────────────────

ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sms_messages_org_select ON sms_messages;
CREATE POLICY sms_messages_org_select ON sms_messages FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS sms_messages_org_insert ON sms_messages;
CREATE POLICY sms_messages_org_insert ON sms_messages FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS sms_messages_org_update ON sms_messages;
CREATE POLICY sms_messages_org_update ON sms_messages FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS sms_messages_org_delete ON sms_messages;
CREATE POLICY sms_messages_org_delete ON sms_messages FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── activities ──────────────────────────────────────────────────────────────

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activities_org_select ON activities;
CREATE POLICY activities_org_select ON activities FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS activities_org_insert ON activities;
CREATE POLICY activities_org_insert ON activities FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS activities_org_update ON activities;
CREATE POLICY activities_org_update ON activities FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS activities_org_delete ON activities;
CREATE POLICY activities_org_delete ON activities FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── ai_summaries ────────────────────────────────────────────────────────────

ALTER TABLE ai_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_summaries_org_select ON ai_summaries;
CREATE POLICY ai_summaries_org_select ON ai_summaries FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_summaries_org_insert ON ai_summaries;
CREATE POLICY ai_summaries_org_insert ON ai_summaries FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_summaries_org_update ON ai_summaries;
CREATE POLICY ai_summaries_org_update ON ai_summaries FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_summaries_org_delete ON ai_summaries;
CREATE POLICY ai_summaries_org_delete ON ai_summaries FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── ai_drafts ───────────────────────────────────────────────────────────────

ALTER TABLE ai_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_drafts_org_select ON ai_drafts;
CREATE POLICY ai_drafts_org_select ON ai_drafts FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_drafts_org_insert ON ai_drafts;
CREATE POLICY ai_drafts_org_insert ON ai_drafts FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_drafts_org_update ON ai_drafts;
CREATE POLICY ai_drafts_org_update ON ai_drafts FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_drafts_org_delete ON ai_drafts;
CREATE POLICY ai_drafts_org_delete ON ai_drafts FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── ai_styles ───────────────────────────────────────────────────────────────

ALTER TABLE ai_styles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_styles_org_select ON ai_styles;
CREATE POLICY ai_styles_org_select ON ai_styles FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_styles_org_insert ON ai_styles;
CREATE POLICY ai_styles_org_insert ON ai_styles FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_styles_org_update ON ai_styles;
CREATE POLICY ai_styles_org_update ON ai_styles FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS ai_styles_org_delete ON ai_styles;
CREATE POLICY ai_styles_org_delete ON ai_styles FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── lead_scores ─────────────────────────────────────────────────────────────

ALTER TABLE lead_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_scores_org_select ON lead_scores;
CREATE POLICY lead_scores_org_select ON lead_scores FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS lead_scores_org_insert ON lead_scores;
CREATE POLICY lead_scores_org_insert ON lead_scores FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS lead_scores_org_update ON lead_scores;
CREATE POLICY lead_scores_org_update ON lead_scores FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS lead_scores_org_delete ON lead_scores;
CREATE POLICY lead_scores_org_delete ON lead_scores FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── embeddings ──────────────────────────────────────────────────────────────

ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS embeddings_org_select ON embeddings;
CREATE POLICY embeddings_org_select ON embeddings FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS embeddings_org_insert ON embeddings;
CREATE POLICY embeddings_org_insert ON embeddings FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS embeddings_org_update ON embeddings;
CREATE POLICY embeddings_org_update ON embeddings FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS embeddings_org_delete ON embeddings;
CREATE POLICY embeddings_org_delete ON embeddings FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── audit_log ────────────────────────────────────────────────────────────────

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_org_select ON audit_log;
CREATE POLICY audit_log_org_select ON audit_log FOR SELECT TO public
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS audit_log_org_insert ON audit_log;
CREATE POLICY audit_log_org_insert ON audit_log FOR INSERT TO public
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS audit_log_org_update ON audit_log;
CREATE POLICY audit_log_org_update ON audit_log FOR UPDATE TO public
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
DROP POLICY IF EXISTS audit_log_org_delete ON audit_log;
CREATE POLICY audit_log_org_delete ON audit_log FOR DELETE TO public
  USING (org_id = public.current_org_id());

-- ─── Child tables — deny-all on the app role ─────────────────────────────────
-- Read paths must go through joins to a RLS-guarded parent table. Direct
-- SELECT/INSERT/UPDATE/DELETE from the app role returns zero rows. Future
-- SECURITY DEFINER RPCs can be added when the Phase A join-only contract is
-- insufficient.

ALTER TABLE contact_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_emails_app_deny ON contact_emails;
CREATE POLICY contact_emails_app_deny ON contact_emails
  FOR ALL TO public USING (false) WITH CHECK (false);

ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_phones_app_deny ON contact_phones;
CREATE POLICY contact_phones_app_deny ON contact_phones
  FOR ALL TO public USING (false) WITH CHECK (false);
