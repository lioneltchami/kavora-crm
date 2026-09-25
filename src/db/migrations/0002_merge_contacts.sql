-- Kavora CRM — merge_contacts function
-- Canonical dedupe: pick winner, reassign all FK references from loser to winner,
-- merge single-value email/phone/profile_notes (winner wins, loser fills NULLs),
-- copy contact_tags links, delete loser, return jsonb summary.

-- ─── merge_contacts ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION merge_contacts(
  winner_id uuid,
  loser_id uuid,
  p_org_id varchar
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assigned_notes       int := 0;
  v_assigned_deals       int := 0;
  v_assigned_calls       int := 0;
  v_assigned_sms         int := 0;
  v_assigned_activities  int := 0;
  v_assigned_ai_drafts   int := 0;
  v_assigned_lead_scores int := 0;
  v_copied_tags          int := 0;
  v_copied_emails        int := 0;
  v_copied_phones        int := 0;
BEGIN
  -- Pin search_path so SECURITY DEFINER can't be hijacked by caller-side objects.
  SET LOCAL search_path = public, pg_temp;

  -- ─── Guard rails ────────────────────────────────────────────────────────────

  IF winner_id = loser_id THEN
    RAISE EXCEPTION 'merge_contacts: winner_id and loser_id must differ (%)', winner_id;
  END IF;

  IF winner_id IS NULL OR loser_id IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: winner_id and loser_id are required';
  END IF;

  PERFORM 1 FROM "contacts" WHERE "id" = winner_id AND "org_id" = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_contacts: winner % not found in org %', winner_id, p_org_id;
  END IF;

  PERFORM 1 FROM "contacts" WHERE "id" = loser_id AND "org_id" = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_contacts: loser % not found in org %', loser_id, p_org_id;
  END IF;

  -- ─── Soft-delete guard (defense in depth) ──────────────────────────────────
  -- The app layer's validateMergeCandidates already refuses soft-deleted
  -- contacts, but a direct SQL/CLI call would otherwise succeed. Both sides
  -- must be live before any destructive work happens.

  IF EXISTS (SELECT 1 FROM "contacts" WHERE "id" = winner_id AND "deleted_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'merge_contacts: winner % is soft-deleted', winner_id;
  END IF;
  IF EXISTS (SELECT 1 FROM "contacts" WHERE "id" = loser_id AND "deleted_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'merge_contacts: loser % is soft-deleted', loser_id;
  END IF;

  -- ─── Reassign FK references from loser → winner ────────────────────────────

  UPDATE "notes"
     SET "contact_id" = winner_id
   WHERE "contact_id" = loser_id;
  GET DIAGNOSTICS v_assigned_notes = ROW_COUNT;

  UPDATE "deals"
     SET "contact_id" = winner_id
   WHERE "contact_id" = loser_id;
  GET DIAGNOSTICS v_assigned_deals = ROW_COUNT;

  UPDATE "calls"
     SET "contact_id" = winner_id
   WHERE "contact_id" = loser_id;
  GET DIAGNOSTICS v_assigned_calls = ROW_COUNT;

  UPDATE "sms_messages"
     SET "contact_id" = winner_id
   WHERE "contact_id" = loser_id;
  GET DIAGNOSTICS v_assigned_sms = ROW_COUNT;

  UPDATE "activities"
     SET "contact_id" = winner_id
   WHERE "contact_id" = loser_id;
  GET DIAGNOSTICS v_assigned_activities = ROW_COUNT;

  UPDATE "ai_drafts"
     SET "contact_id" = winner_id
   WHERE "contact_id" = loser_id;
  GET DIAGNOSTICS v_assigned_ai_drafts = ROW_COUNT;

  UPDATE "lead_scores"
     SET "contact_id" = winner_id
   WHERE "contact_id" = loser_id;
  GET DIAGNOSTICS v_assigned_lead_scores = ROW_COUNT;

  -- ─── Merge scalar fields on the winner (winner wins, loser fills NULLs) ────

  UPDATE "contacts" w
     SET "email"         = COALESCE(w."email",         l."email"),
         "phone"         = COALESCE(w."phone",         l."phone"),
         "last_name"     = COALESCE(w."last_name",     l."last_name"),
         "source"        = COALESCE(w."source",        l."source"),
         "profile_notes" = COALESCE(w."profile_notes", l."profile_notes"),
         "company_id"    = COALESCE(w."company_id",    l."company_id"),
         "owner_user_id" = COALESCE(w."owner_user_id", l."owner_user_id"),
         "updated_at"    = now()
    FROM "contacts" l
   WHERE w."id" = winner_id
     AND l."id" = loser_id;

  -- ─── Copy contact_tags links (dedupe via PK) ────────────────────────────────

  INSERT INTO "contact_tags" ("contact_id", "tag_id")
  SELECT winner_id, ct."tag_id"
    FROM "contact_tags" ct
   WHERE ct."contact_id" = loser_id
   ON CONFLICT ("contact_id", "tag_id") DO NOTHING;
  GET DIAGNOSTICS v_copied_tags = ROW_COUNT;

  -- ─── Channel reconciliation ─────────────────────────────────────────────────

  INSERT INTO "contact_emails" ("contact_id", "email", "type", "is_primary", "created_at")
  SELECT winner_id, le."email", le."type", le."is_primary", le."created_at"
    FROM "contact_emails" le
   WHERE le."contact_id" = loser_id
     AND NOT EXISTS (
       SELECT 1 FROM "contact_emails" we
        WHERE we."contact_id" = winner_id
          AND lower(we."email") = lower(le."email")
     );
  GET DIAGNOSTICS v_copied_emails = ROW_COUNT;

  UPDATE "contact_emails"
     SET "is_primary" = false
   WHERE "contact_id" = winner_id
     AND "is_primary" = true
     AND "id" NOT IN (
       SELECT "id" FROM "contact_emails"
        WHERE "contact_id" = winner_id
        ORDER BY "is_primary" DESC, "created_at" DESC
        LIMIT 1
     );

  INSERT INTO "contact_phones" ("contact_id", "phone_e164", "type", "is_primary", "created_at")
  SELECT winner_id, lp."phone_e164", lp."type", lp."is_primary", lp."created_at"
    FROM "contact_phones" lp
   WHERE lp."contact_id" = loser_id
     AND NOT EXISTS (
       SELECT 1 FROM "contact_phones" wp
        WHERE wp."contact_id" = winner_id
          AND wp."phone_e164" = lp."phone_e164"
     );
  GET DIAGNOSTICS v_copied_phones = ROW_COUNT;

  UPDATE "contact_phones"
     SET "is_primary" = false
   WHERE "contact_id" = winner_id
     AND "is_primary" = true
     AND "id" NOT IN (
       SELECT "id" FROM "contact_phones"
        WHERE "contact_id" = winner_id
        ORDER BY "is_primary" DESC, "created_at" DESC
        LIMIT 1
     );

  DELETE FROM "contact_emails" WHERE "contact_id" = loser_id;
  DELETE FROM "contact_phones" WHERE "contact_id" = loser_id;

  -- ─── Delete the loser ──────────────────────────────────────────────────────

  DELETE FROM "contacts" WHERE "id" = loser_id;

  -- ─── Summary ────────────────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'winner_id',             winner_id,
    'loser_id',              loser_id,
    'org_id',                p_org_id,
    'reassigned_notes',      v_assigned_notes,
    'reassigned_deals',      v_assigned_deals,
    'reassigned_calls',      v_assigned_calls,
    'reassigned_sms',        v_assigned_sms,
    'reassigned_activities', v_assigned_activities,
    'reassigned_ai_drafts',  v_assigned_ai_drafts,
    'reassigned_lead_scores', v_assigned_lead_scores,
    'copied_emails',         v_copied_emails,
    'copied_phones',         v_copied_phones,
    'copied_tags',           v_copied_tags
  );
END;
$$;

-- Lock down EXECUTE to authenticated callers; the app layer's RLS-equivalent
-- (org_id check in 0001_init.sql's app code) handles tenant isolation.
REVOKE ALL ON FUNCTION merge_contacts(uuid, uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_contacts(uuid, uuid, varchar) TO authenticated;
