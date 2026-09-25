-- RLS isolation suite: calls
-- Verifies that the calls table's *_org_* policies scope SELECT, INSERT,
-- UPDATE, and DELETE to the JWT's org_id claim. The unique twilio_call_sid
-- index means a single SID cannot be inserted under two different orgs —
-- that constraint plus RLS gives us double protection against cross-tenant
-- row smuggling.

BEGIN;
SELECT plan(8);

INSERT INTO organizations (id, name)
  VALUES ('org_kavora_test', 'Kavora Test'),
         ('org_acme_test',   'Acme Test')
  ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM calls)::int, 0::int,
  'no JWT → zero calls visible');

-- Insert under the matching JWT — a multi-row INSERT that mixes orgs would
-- abort the entire transaction on the first WITH CHECK violation (error
-- 42501 leaves the tx in failed state, killing every subsequent SELECT).
-- Splitting per-org keeps each INSERT inside its own WITH CHECK window.
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
INSERT INTO calls (org_id, twilio_call_sid, direction, from_number, to_number)
  VALUES ('org_kavora_test', 'CA_kavora_001', 'inbound', '+15551110001', '+15552220001');
SELECT is((SELECT count(*) FROM calls)::int, 1::int,
  'kavora JWT → only the kavora call is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
INSERT INTO calls (org_id, twilio_call_sid, direction, from_number, to_number)
  VALUES ('org_acme_test', 'CA_acme_001', 'inbound', '+15551110002', '+15552220002');
SELECT is((SELECT count(*) FROM calls)::int, 1::int,
  'acme JWT → only the acme call is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT throws_ok(
  $$INSERT INTO calls (org_id, twilio_call_sid, direction, from_number, to_number)
       VALUES ('org_acme_test', 'CA_spoofed_777', 'outbound', '+15551110999', '+15552220999')$$,
  '42501', NULL,
  'kavora JWT cannot insert an acme-tagged call (WITH CHECK → 42501)');

-- RLS USING filters UPDATE target rows to current_org_id(); under acme JWT,
-- CA_kavora_001 is invisible, so the UPDATE touches zero rows and RETURNING
-- returns zero rows. Expected must be an empty result set, not the row's
-- pre-update twilio_call_sid (which was the spec sample's bug).
SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT results_eq(
  $$UPDATE calls SET from_number = '+19999999999' WHERE twilio_call_sid = 'CA_kavora_001' RETURNING twilio_call_sid$$,
  $$SELECT NULL::varchar WHERE FALSE$$,
  'cross-tenant UPDATE no-ops: acme JWT cannot see CA_kavora_001, UPDATE touches zero rows');

SELECT lives_ok(
  $$DELETE FROM calls WHERE twilio_call_sid = 'CA_kavora_001'$$);
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT is((SELECT count(*) FROM calls WHERE twilio_call_sid = 'CA_kavora_001')::int, 1::int,
  'kavora call still present after a cross-tenant DELETE attempt');

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM calls)::int, 0::int,
  'JWT cleared → no calls visible');

SELECT * FROM finish();
ROLLBACK;
