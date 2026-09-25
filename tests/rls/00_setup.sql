-- pgTAP isolation suite — shared setup
--
-- This file is intentionally NOT a pgTAP plan — it's a baseline loader that
-- downstream `*.pgTAP.sql` files assume is already in place. The harness
-- (`scripts/test-rls.sh`, owned by Builder 4) sources this once at the start
-- of every run.
--
-- Two organizations (`org_kavora_test`, `org_acme_test`) are inserted
-- idempotently. Per-suite tests then drive `current_org_id()` via
-- `set_config('request.jwt.claims', '{"org_id":"…"}', true)` and assert that
-- every operation is scoped to the JWT's org — never crosses to the other.
--
-- The transactions are short-lived: each `*.pgTAP.sql` runs inside its own
-- psql `BEGIN; … COMMIT/ROLLBACK` boundary, so we don't need TRUNCATE here.
-- Drop at the end of each suite via ROLLBACK.

BEGIN;

INSERT INTO organizations (id, name)
  VALUES ('org_kavora_test', 'Kavora Test'),
         ('org_acme_test',   'Acme Test')
  ON CONFLICT (id) DO NOTHING;

COMMIT;
