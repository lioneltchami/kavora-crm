BEGIN;
SELECT plan(1);
SELECT is(
  current_setting('is_superuser', true),
  'off',
  'app role is not superuser so RLS fires'
);
SELECT * FROM finish();
ROLLBACK;