-- RLS isolation suite: embeddings
-- Verifies that embeddings' *_org_* policies scope reads, writes, updates,
-- and deletes to the JWT's org_id claim. embeddings is the RAG retrieval
-- table — a leak here means one tenant can query another's notes/summaries,
-- which is the worst-case data exfiltration vector.

BEGIN;
SELECT plan(8);

INSERT INTO organizations (id, name)
  VALUES ('org_kavora_test', 'Kavora Test'),
         ('org_acme_test',   'Acme Test')
  ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM embeddings)::int, 0::int,
  'no JWT → zero embeddings visible');

-- Insert under the matching JWT — a multi-row INSERT that mixes orgs would
-- abort the entire transaction on the first WITH CHECK violation (error
-- 42501 leaves the tx in failed state, killing every subsequent SELECT).
-- Splitting per-org keeps each INSERT inside its own WITH CHECK window.
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
INSERT INTO embeddings (org_id, source_type, source_id, chunk_index, content)
  VALUES ('org_kavora_test', 'note', '00000000-0000-0000-0000-000000000101', 0, 'kavora chunk');
SELECT is((SELECT count(*) FROM embeddings)::int, 1::int,
  'kavora JWT → only the kavora embedding is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
INSERT INTO embeddings (org_id, source_type, source_id, chunk_index, content)
  VALUES ('org_acme_test', 'note', '00000000-0000-0000-0000-000000000102', 0, 'acme chunk');
SELECT is((SELECT count(*) FROM embeddings)::int, 1::int,
  'acme JWT → only the acme embedding is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT throws_ok(
  $$INSERT INTO embeddings (org_id, source_type, source_id, chunk_index, content)
       VALUES ('org_acme_test', 'note', '00000000-0000-0000-0000-000000000103', 0, 'spoofed-chunk')$$,
  '42501', NULL,
  'kavora JWT cannot ingest an acme-tagged embedding (RAG leak blocked)');

-- RLS USING filters UPDATE target rows to current_org_id(); under acme JWT,
-- the kavora embedding is invisible, so the UPDATE touches zero rows and
-- RETURNING returns zero rows. Expected must be an empty result set, not
-- the row's pre-update content value (which was the spec sample's bug).
SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT results_eq(
  $$UPDATE embeddings SET content = 'tampered' WHERE source_id = '00000000-0000-0000-0000-000000000101' RETURNING content$$,
  $$SELECT NULL::text WHERE FALSE$$,
  'cross-tenant UPDATE no-ops: acme JWT cannot see kavora embedding, UPDATE touches zero rows');

SELECT lives_ok(
  $$DELETE FROM embeddings WHERE source_id = '00000000-0000-0000-0000-000000000101'$$);
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT is((SELECT count(*) FROM embeddings WHERE source_id = '00000000-0000-0000-0000-000000000101')::int, 1::int,
  'kavora embedding still present after a cross-tenant DELETE attempt');

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM embeddings)::int, 0::int,
  'JWT cleared → no embeddings visible');

SELECT * FROM finish();
ROLLBACK;
