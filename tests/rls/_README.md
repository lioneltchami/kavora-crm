# RLS isolation tests

This directory holds pgTAP tests that prove Row-Level Security policies
actually isolate each tenant. The harness runner
[`scripts/test-rls.sh`](../../scripts/test-rls.sh) globs every
`*.pgTAP.sql` here and runs them in alphabetical order with
`ON_ERROR_STOP=1`, so a single failure fails the whole run.

## Adding a new isolation test

1. Create `tests/rls/<entity>.pgTAP.sql`.
2. Use BEGIN … ROLLBACK at the top and bottom — pgTAP transactions isolate
   your fixtures from neighbouring files.
3. Build two fixtures: an actor in `org_a` and an actor in `org_b`. Use
   `SET LOCAL ROLE app_user` (or `SET LOCAL "request.jwt.claims" =
   '{"org_id":"org_a"}'`) inside the test to simulate the in-app connection.
4. Assert that the org_a actor cannot SELECT / INSERT / UPDATE / DELETE on
   rows owned by org_b.
5. The CI job `.github/workflows/ci.yml → rls` runs the harness against a
   throwaway Postgres service container on every PR — no manual setup.

Files prefixed `_` (e.g. `_harness_smoke.pgTAP.sql`) run first because of
the alphabetical glob; use that for suite-wide sanity checks like
`is_superuser = off`.