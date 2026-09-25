-- RLS isolation suite: audit_log
-- Verifies that audit_log's *_org_* policies scope reads, writes, updates,
-- and deletes to the JWT's org_id claim. audit_log differs from contacts/
-- calls: it has no FK to organizations (org_id is a free varchar); we
-- therefore insert rows directly into audit_log without needing to touch
-- any parent table.

BEGIN;
SELECT plan(8);

INSERT INTO organizations (id, name)
  VALUES ('org_kavora_test', 'Kavora Test'),
         ('org_acme_test',   'Acme Test')
  ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM audit_log)::int, 0::int,
  'no JWT → zero audit_log rows visible');

-- Insert under the matching JWT — a multi-row INSERT that mixes orgs would
-- abort the entire transaction on the first WITH CHECK violation (error
-- 42501 leaves the tx in failed state, killing every subsequent SELECT).
-- Splitting per-org keeps each INSERT inside its own WITH CHECK window.
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
INSERT INTO audit_log (org_id, actor_user_id, action, entity, entity_id)
  VALUES ('org_kavora_test', 'user_kavora_1', 'contact.created', 'contact', 'c_kavora_1');
SELECT is((SELECT count(*) FROM audit_log)::int, 1::int,
  'kavora JWT → only the kavora audit row is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
INSERT INTO audit_log (org_id, actor_user_id, action, entity, entity_id)
  VALUES ('org_acme_test', 'user_acme_1', 'contact.created', 'contact', 'c_acme_1');
SELECT is((SELECT count(*) FROM audit_log)::int, 1::int,
  'acme JWT → only the acme audit row is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT throws_ok(
  $$INSERT INTO audit_log (org_id, actor_user_id, action, entity, entity_id)
       VALUES ('org_acme_test', 'mallory', 'contact.exfiltrated', 'contact', 'c_kavora_1')$$,
  '42501', NULL,
  'kavora JWT cannot write into acme audit_log (R1 — cross-tenant smuggling)');

-- RLS USING filters UPDATE target rows to current_org_id(); under acme JWT,
-- the kavora entry is invisible, so the UPDATE touches zero rows and
-- RETURNING returns zero rows. Expected must be an empty result set, not
-- the row's pre-update action value (which was the spec sample's bug).
SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT results_eq(
  $$UPDATE audit_log SET action = 'tampered' WHERE entity_id = 'c_kavora_1' RETURNING action$$,
  $$SELECT NULL::text WHERE FALSE$$,
  'cross-tenant UPDATE no-ops: acme JWT cannot see kavora entry, UPDATE touches zero rows');

SELECT lives_ok(
  $$DELETE FROM audit_log WHERE entity_id = 'c_kavora_1'$$);
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT is((SELECT count(*) FROM audit_log WHERE entity_id = 'c_kavora_1')::int, 1::int,
  'kavora audit row still present after a cross-tenant DELETE attempt');

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM audit_log)::int, 0::int,
  'JWT cleared → no audit_log rows visible');

SELECT * FROM finish();
ROLLBACK;
