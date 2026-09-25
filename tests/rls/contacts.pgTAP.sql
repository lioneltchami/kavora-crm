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

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
INSERT INTO contacts (org_id, first_name)
  VALUES ('org_kavora_test', 'Alice'), ('org_acme_test', 'Bob');
SELECT is((SELECT count(*) FROM contacts)::int, 1::int,
  'kavora JWT → only the kavora row is visible (acme insert rejected by WITH CHECK)');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT is((SELECT count(*) FROM contacts)::int, 1::int,
  'acme JWT → only the acme row is visible (inserted under acme power)');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT throws_ok(
  $$INSERT INTO contacts (org_id, first_name) VALUES ('org_acme_test', 'Mallory')$$,
  '42501', NULL,
  'kavora JWT cannot insert an acme-tagged row (WITH CHECK violation → 42501)');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT results_eq(
  $$UPDATE contacts SET first_name = 'X' WHERE first_name = 'Alice' RETURNING first_name$$,
  $$VALUES ('Alice'::text)$$,
  'cross-tenant UPDATE no-ops (Alice stays Alice; acme cannot mutate kavora rows)');

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
