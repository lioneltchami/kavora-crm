-- Kavora CRM — soft delete for contacts
-- Adds `deleted_at` so delete is reversible within a 5 s Undo window without
-- a destructive row delete. NULL = active row. NULL is the default; no backfill
-- is needed because every existing contact is implicitly active.

-- ─── Column ───────────────────────────────────────────────────────────────────

ALTER TABLE "contacts"
  ADD COLUMN "deleted_at" timestamptz NULL;

-- ─── Index ────────────────────────────────────────────────────────────────────

-- Partial index over the active-row query path that the list / detail views
-- will use once they filter on `deleted_at IS NULL`. Stays small because most
-- production rows will remain NULL.
CREATE INDEX "contacts_org_active_idx"
  ON "contacts" ("org_id")
  WHERE "deleted_at" IS NULL;
