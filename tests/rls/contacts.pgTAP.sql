-- RLS isolation suite: contacts
-- Verifies that the contacts table's *_org_* policies scope SELECT, INSERT,
-- UPDATE, and DELETE to the JWT's org_id claim — never to a row tagged with
-- a different org_id. Pattern from docs/research/ai-agency/phase-a-prompt.md
-- §1.6.3 (sample pgTAP test) plus an explicit "global cross-tenant DELETE
-- attempt" assertion.

BEGIN;
SELECT plan(8);

INSERT INTO organizations (id, name)
  VALUES ('org_kavora_test', 'Kavora Test'),
         ('org_acme_test',   'Acme Test')
  ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM contacts)::int, 0::int,
  'no JWT → zero rows visible');

-- Insert under the matching JWT — a multi-row INSERT that mixes orgs would
-- abort the entire transaction on the first WITH CHECK violation (error
-- 42501 leaves the tx in failed state, killing every subsequent SELECT).
-- Splitting per-org keeps each INSERT inside its own WITH CHECK window.
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
INSERT INTO contacts (org_id, first_name) VALUES ('org_kavora_test', 'Alice');
SELECT is((SELECT count(*) FROM contacts)::int, 1::int,
  'kavora JWT → only the kavora row is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
INSERT INTO contacts (org_id, first_name) VALUES ('org_acme_test', 'Bob');
SELECT is((SELECT count(*) FROM contacts)::int, 1::int,
  'acme JWT → only the acme row is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT throws_ok(
  $$INSERT INTO contacts (org_id, first_name) VALUES ('org_acme_test', 'Mallory')$$,
  '42501', NULL,
  'kavora JWT cannot insert an acme-tagged row (WITH CHECK violation → 42501)');

-- RLS USING filters UPDATE target rows to current_org_id(); under acme JWT,
-- Alice (kavora) is invisible, so the UPDATE touches zero rows and RETURNING
-- returns zero rows. The expected must therefore be an empty result set,
-- not the row's pre-update value (which was the spec sample's bug).
SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT results_eq(
  $$UPDATE contacts SET first_name = 'X' WHERE first_name = 'Alice' RETURNING first_name$$,
  $$SELECT NULL::text WHERE FALSE$$,
  'cross-tenant UPDATE no-ops: acme JWT cannot see Alice, UPDATE touches zero rows');

SELECT lives_ok(
  $$DELETE FROM contacts WHERE first_name = 'Alice'$$);
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT is((SELECT count(*) FROM contacts WHERE first_name = 'Alice')::int, 1::int,
  'Alice still present after a cross-tenant DELETE attempt');

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM contacts)::int, 0::int,
  'with JWT cleared, both contacts are invisible (no leakage via cached claims)');

SELECT * FROM finish();
ROLLBACK;
