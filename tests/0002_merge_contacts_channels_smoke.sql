-- ─── 0002_merge_contacts channels smoke test ────────────────────────────────────
--
-- MANUAL smoke — run with `psql $DATABASE_URL -f tests/0002_merge_contacts_channels_smoke.sql`
-- AFTER applying src/db/migrations/0002_merge_contacts.sql (with channel reconciliation).
--
-- This script is transactional; it commits at the end so a reviewer can inspect
-- the resulting rows. Wrap with `BEGIN; ... ROLLBACK;` if you want it hermetic.
--
-- What it covers:
--   1. Two contacts in a fresh temp org:
--        winner: 1 email (winner@x),       1 phone (+15551111111)
--        loser:  3 emails (loser@x, loser-home@x, WINNER@X case-variant),
--                2 phones (+15552222222, +15553333333)
--   2. Calls merge_contacts(winner, loser, org).
--   3. Asserts:
--        - winner owns all 3 unique emails + 3 unique phones
--        - loser is gone (no emails/phones left)
--        - jsonb copied_emails = 2, copied_phones = 2
--        - case-insensitive dedup fires (the WINNER@X row must NOT be copied)
--        - exactly one is_primary row per channel table on winner

\set ON_ERROR_STOP on

-- ─── Seed ──────────────────────────────────────────────────────────────────────

INSERT INTO "organizations" ("id", "name") VALUES ('_t1_4_channels', 'T1-4 Channels Smoke')
  ON CONFLICT ("id") DO NOTHING;

INSERT INTO "contacts" ("id", "org_id", "first_name", "last_name", "email", "phone")
VALUES
  ('77777777-7777-7777-7777-777777777777', '_t1_4_channels',
   'Ada', 'Winner', 'winner@x', '+15551111111'),
  ('88888888-8888-8888-8888-888888888888', '_t1_4_channels',
   'Ada', 'Loser',  'loser@x',  '+15552222222')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "contact_emails" ("contact_id", "email", "type", "is_primary") VALUES
  ('77777777-7777-7777-7777-777777777777', 'winner@x',     'work', true),
  ('88888888-8888-8888-8888-888888888888', 'loser@x',      'work', true),
  ('88888888-8888-8888-8888-888888888888', 'loser-home@x', 'home', false),
  -- Mixed-case variant of winner@x. Must NOT be copied by the merge (lower()
  -- dedup). If it leaks, assertion 2's email count (and the explicit case-insensitive
  -- regression check below) will fail.
  ('88888888-8888-8888-8888-888888888888', 'WINNER@X',     'work', false);

INSERT INTO "contact_phones" ("contact_id", "phone_e164", "type", "is_primary") VALUES
  ('77777777-7777-7777-7777-777777777777', '+15551111111', 'work', true),
  ('88888888-8888-8888-8888-888888888888', '+15552222222', 'work', true),
  ('88888888-8888-8888-8888-888888888888', '+15553333333', 'other', false);

-- ─── Run ──────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE merge_result (summary jsonb);
WITH result AS (
  SELECT merge_contacts(
    '77777777-7777-7777-7777-777777777777'::uuid, -- winner
    '88888888-8888-8888-8888-888888888888'::uuid, -- loser
    '_t1_4_channels'                              -- org
  ) AS summary
)
INSERT INTO merge_result SELECT summary FROM result;

\echo 'merge_contacts result:'
SELECT jsonb_pretty(summary) FROM merge_result;

-- ─── Asserts ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_summary jsonb;
  v_emails_winner int;
  v_emails_loser  int;
  v_phones_winner int;
  v_phones_loser  int;
  v_copied_emails int;
  v_copied_phones int;
BEGIN
  SELECT summary INTO v_summary FROM merge_result;
  -- 1. Loser is gone.
  IF EXISTS (SELECT 1 FROM "contacts" WHERE "id" = '88888888-8888-8888-8888-888888888888') THEN
    RAISE EXCEPTION 'ASSERT FAIL: loser still present';
  END IF;

  -- 2. Winner owns all 3 unique emails.
  SELECT COUNT(*) INTO v_emails_winner FROM "contact_emails"
   WHERE "contact_id" = '77777777-7777-7777-7777-777777777777';
  IF v_emails_winner <> 3 THEN
    RAISE EXCEPTION 'ASSERT FAIL: winner should have 3 emails, got %', v_emails_winner;
  END IF;

  -- 3. Winner owns all 3 unique phones.
  SELECT COUNT(*) INTO v_phones_winner FROM "contact_phones"
   WHERE "contact_id" = '77777777-7777-7777-7777-777777777777';
  IF v_phones_winner <> 3 THEN
    RAISE EXCEPTION 'ASSERT FAIL: winner should have 3 phones, got %', v_phones_winner;
  END IF;

  -- 4. Loser's emails and phones are gone.
  SELECT COUNT(*) INTO v_emails_loser FROM "contact_emails"
   WHERE "contact_id" = '88888888-8888-8888-8888-888888888888';
  IF v_emails_loser <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAIL: loser still has % emails', v_emails_loser;
  END IF;

  SELECT COUNT(*) INTO v_phones_loser FROM "contact_phones"
   WHERE "contact_id" = '88888888-8888-8888-8888-888888888888';
  IF v_phones_loser <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAIL: loser still has % phones', v_phones_loser;
  END IF;

  -- 5. email set on winner is exactly {winner@x, loser@x, loser-home@x}.
  IF (SELECT array_agg(lower("email") ORDER BY lower("email"))
        FROM "contact_emails"
       WHERE "contact_id" = '77777777-7777-7777-7777-777777777777')
     <> ARRAY['loser-home@x', 'loser@x', 'winner@x']::text[] THEN
    RAISE EXCEPTION 'ASSERT FAIL: winner email set mismatch';
  END IF;

  -- 6. phone set on winner is exactly {+15551111111, +15552222222, +15553333333}.
  IF (SELECT array_agg("phone_e164" ORDER BY "phone_e164")
        FROM "contact_phones"
       WHERE "contact_id" = '77777777-7777-7777-7777-777777777777')
     <> ARRAY['+15551111111', '+15552222222', '+15553333333']::text[] THEN
    RAISE EXCEPTION 'ASSERT FAIL: winner phone set mismatch';
  END IF;

  -- 7. jsonb summary has copied_emails = 2 and copied_phones = 2.
  v_copied_emails := (v_summary ->> 'copied_emails')::int;
  IF v_copied_emails <> 2 THEN
    RAISE EXCEPTION 'ASSERT FAIL: copied_emails expected 2, got %', v_copied_emails;
  END IF;

  v_copied_phones := (v_summary ->> 'copied_phones')::int;
  IF v_copied_phones <> 2 THEN
    RAISE EXCEPTION 'ASSERT FAIL: copied_phones expected 2, got %', v_copied_phones;
  END IF;

  -- 8. Case-insensitive email dedup: loser's WINNER@X must NOT be copied.
  -- Regression indicator: if the lower() comparison in the NOT EXISTS subquery
  -- is dropped (or the comparison is changed to direct equality), this row
  -- leaks to the winner, bumping the email count from 3 → 4 and producing
  -- a duplicate (case-insensitive) email on the contact.
  IF EXISTS (SELECT 1 FROM "contact_emails"
              WHERE "contact_id" = '77777777-7777-7777-7777-777777777777'
                AND lower("email") = 'winner@x'
                AND "email" <> 'winner@x') THEN
    RAISE EXCEPTION 'ASSERT FAIL: case-insensitive dedup did not fire (uppercase variant leaked to winner)';
  END IF;
END $$;

-- ─── Single-primary invariant SELECTs (reviewable as documentation) ──────────
-- Exactly one is_primary row per channel table after merge. The merge's
-- post-insert UPDATE collapses any leftover is_primary duplicates back to one
-- (ORDER BY is_primary DESC, created_at DESC LIMIT 1).
--
-- Regression indicator: if that UPDATE is removed, both the winner's original
-- primary and the loser-side primary that was copied over remain flagged,
-- so COUNT(*) WHERE is_primary would be > 1 on the winner.

SELECT (SELECT COUNT(*) FROM "contact_emails"
         WHERE "contact_id" = '77777777-7777-7777-7777-777777777777'
           AND "is_primary") = 1 AS emails_primary_invariant;

SELECT (SELECT COUNT(*) FROM "contact_phones"
         WHERE "contact_id" = '77777777-7777-7777-7777-777777777777'
           AND "is_primary") = 1 AS phones_primary_invariant;

DROP TABLE merge_result;

-- ─── Cleanup ───────────────────────────────────────────────────────────────────

DELETE FROM "contacts" WHERE "id" IN (
  '77777777-7777-7777-7777-777777777777',
  '88888888-8888-8888-8888-888888888888'
);
DELETE FROM "organizations" WHERE "id" = '_t1_4_channels';

\echo 'merge_contacts channels smoke: PASSED'