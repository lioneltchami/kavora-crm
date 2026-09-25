-- RLS isolation suite: embeddings
-- Verifies that the embeddings (pgvector) table's *_org_* policies scope
-- SELECT, INSERT, UPDATE, DELETE to the JWT's org_id claim. embeddings has
-- no FK to other business tables — it carries a free `source_id` uuid and a
-- `source_type` varchar — so isolation is purely a function of RLS on
-- `org_id = public.current_org_id()`. This is the highest-leverage vector
-- for cross-tenant RAG leakage, so the suite is intentionally strict.

BEGIN;
SELECT plan(8);

INSERT INTO organizations (id, name)
  VALUES ('org_kavora_test', 'Kavora Test'),
         ('org_acme_test',   'Acme Test')
  ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM embeddings)::int, 0::int,
  'no JWT → zero embeddings visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
INSERT INTO embeddings (org_id, source_type, source_id, chunk_index, content)
  VALUES ('org_kavora_test', 'note', '00000000-0000-0000-0000-000000000101', 0, 'kavora chunk'),
         ('org_acme_test',   'note', '00000000-0000-0000-0000-000000000102', 0, 'acme chunk');
SELECT is((SELECT count(*) FROM embeddings)::int, 1::int,
  'kavora JWT → only the kavora embedding is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT is((SELECT count(*) FROM embeddings)::int, 1::int,
  'acme JWT → only the acme embedding is visible');

SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT throws_ok(
  $$INSERT INTO embeddings (org_id, source_type, source_id, chunk_index, content)
       VALUES ('org_acme_test', 'note', '00000000-0000-0000-0000-000000000103', 0, 'spoofed-chunk')$$,
  '42501', NULL,
  'kavora JWT cannot ingest an acme-tagged embedding (RAG leak blocked)');

SELECT set_config('request.jwt.claims', '{"org_id":"org_acme_test"}', true);
SELECT results_eq(
  $$UPDATE embeddings SET content = 'tampered' WHERE source_id = '00000000-0000-0000-0000-000000000101' RETURNING content$$,
  $$VALUES ('kavora chunk'::text)$$,
  'cross-tenant UPDATE no-ops (acme cannot rewrite kavora embeddings)');

SELECT lives_ok(
  $$DELETE FROM embeddings WHERE source_id = '00000000-0000-0000-0000-000000000101'$$);
SELECT set_config('request.jwt.claims', '{"org_id":"org_kavora_test"}', true);
SELECT is((SELECT count(*) FROM embeddings WHERE source_id = '00000000-0000-0000-0000-000000000101')::int, 1::int,
  'kavora embedding still present after a cross-tenant DELETE attempt');

SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT count(*) FROM embeddings)::int, 0::int,
  'JWT cleared → no embeddings visible (no RAG content leak to anon role)');

SELECT * FROM finish();
ROLLBACK;
