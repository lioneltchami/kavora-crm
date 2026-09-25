-- Replace `public.current_org_id()` with a GUC-based implementation.
--
-- The original definition called `auth.jwt()`, which is a Supabase built-in
-- that requires SECURITY DEFINER / superuser privileges. In production
-- Supabase sets the JWT on every request via the postgrest proxy, so
-- `auth.jwt()` works. In local pgTAP tests (and in any non-Supabase Postgres),
-- `auth.jwt()` returns NULL or raises permission denied because the JWT is
-- set via `set_config('request.jwt.claims', ..., true)` rather than through
-- the proxy. The RLS policies then silently filter out every row.
--
-- This migration re-defines `current_org_id()` to read directly from the
-- `request.jwt.claims` GUC, which is what Supabase's `auth.jwt()` ultimately
-- consults. In production the GUC is populated by Supabase before each
-- query; in tests pgTAP populates it via `set_config`. Same behavior, no
-- superuser permission required.
--
-- For environments without Supabase, also install pgTAP-friendly shims
-- via the application runtime — out of scope for this migration.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'org_id',
    NULLIF(current_setting('request.jwt.claim.org_id', true), '')
  )
$$;
