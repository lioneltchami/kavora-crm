-- Kavora CRM — contact channels (multi-value emails + phones, normalized)
-- Replaces the legacy single-value `contacts.email` / `contacts.phone` columns
-- (kept in place for backward compatibility; see T2-1 in
-- docs/research/atomic-crm/apply-to-kavora.md).

-- ─── Enum ──────────────────────────────────────────────────────────────────────

CREATE TYPE "contact_channel_type" AS ENUM ('work', 'home', 'other');

-- ─── contact_emails ────────────────────────────────────────────────────────────

CREATE TABLE "contact_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "type" "contact_channel_type" NOT NULL DEFAULT 'work',
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- ─── contact_phones ────────────────────────────────────────────────────────────

CREATE TABLE "contact_phones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "phone_e164" varchar(32) NOT NULL,
  "type" "contact_channel_type" NOT NULL DEFAULT 'work',
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "contact_phones_e164_format" CHECK ("phone_e164" ~ '^\+[1-9]\d{1,14}$')
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX "contact_emails_contact_idx" ON "contact_emails" ("contact_id");
CREATE INDEX "contact_phones_contact_idx" ON "contact_phones" ("contact_id");
CREATE INDEX "contact_phones_e164_idx" ON "contact_phones" ("phone_e164");

-- ─── Backfill from contacts.email ──────────────────────────────────────────────

INSERT INTO "contact_emails" ("contact_id", "email", "type", "is_primary")
SELECT id, email, 'work', true
FROM "contacts"
WHERE "email" IS NOT NULL AND "email" != '';

-- ─── Backfill from contacts.phone ──────────────────────────────────────────────

INSERT INTO "contact_phones" ("contact_id", "phone_e164", "type", "is_primary")
SELECT id, phone, 'work', true
FROM "contacts"
WHERE "phone" IS NOT NULL AND "phone" != '';
