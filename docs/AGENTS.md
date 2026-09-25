# AGENTS.md — conventions for working in this codebase

A guide for any agent (human or AI) picking up this project. Read this before you change anything.

---

## Project at a glance

- **What**: Single-tenant-per-deployment CRM. One Kavora instance per client; each carries its own `orgId` (set to `KAVORA_ORG_ID` in v1). Every business row has `orgId` and Postgres RLS is enabled as defense-in-depth so flipping the deployment to multi-tenant later is a Clerk upgrade + config flip, not a schema change.
- **Stack**: Next.js 15 (App Router) · Supabase Postgres (Drizzle) · Clerk · Twilio · Deepgram · Anthropic · Voyage · Trigger.dev · Tailwind + shadcn/ui · Sonner · Vercel.
- **Tenancy**: **single-tenant per deployment** in v1 — Kavora deploys one CRM instance per client. The schema is multi-tenant-ready (every business table carries `orgId`); the `db` / `adminDb` two-pool design is kept as **defense-in-depth**: `db` (RLS-firing, default for app code) and `adminDb` (bypasses RLS, for system writes — Clerk webhooks, Trigger.dev jobs, Twilio inbound routes). `KAVORA_ORG_ID` is the single org id in v1; multi-tenant mode (Clerk Organizations + RLS keyed on JWT org claim) is **dormant** pending 3+ paying clients. To re-activate, see the playbook in `docs/research/ai-agency/README.md`.
- **Tier-1 + first four Tier-2 items + Phase A scaffolding shipped (2026-09-24):** shadcn/ui sidebar shell + `merge_contacts` PL/pgSQL dedupe (now reconciles loser's `contact_emails` / `contact_phones` into winner) + Sonner `undoable()` soft-delete + DB summary views + mobile list split + multi-value contact channels (data layer + create/edit form UI) + bottom-sheet dialogs + idempotent migration runner with GH Actions auto-apply + RLS on 18 tables (dormant) + pgTAP harness + non-superuser app pool + two-pool design (`db` + `adminDb`). The full roadmap (Tier 2 / Tier 3 + the agency-platform pivot) lives in [`docs/research/atomic-crm/apply-to-kavora.md`](./research/atomic-crm/apply-to-kavora.md) and [`docs/research/ai-agency/README.md`](./research/ai-agency/README.md).

---

## Common commands

```bash
pnpm install
pnpm dev                # http://localhost:3000
pnpm typecheck          # tsc --noEmit (run before committing)
pnpm lint
pnpm db:generate        # regenerate SQL from src/db/schema.ts
pnpm db:migrate         # apply migrations to DIRECT_URL
pnpm db:studio          # local Drizzle Studio
pnpm format             # prettier + tailwind plugin
```

---

## Where to make changes

| You want to… | Go to |
|---|---|
| Add a new entity | `src/db/schema.ts` → `pnpm db:generate` → `src/db/migrations/` |
| Add a Twilio webhook | `src/app/api/twilio/<name>/route.ts` + register in `src/lib/twilio/signature.ts` and update TwiML in `src/lib/twilio/twiml.ts` |
| Add a new page | `src/app/(dashboard)/<route>/page.tsx` + components in `src/components/<area>/` |
| Add a server action | `src/actions/<area>.ts` — must call `requireDbUser()` first |
| Add a background job | `src/trigger/<job>.ts` + register in `trigger.config.ts` |
| Add a UI primitive | `src/components/ui/<name>.tsx` (shadcn-style) |
| Add a new AI provider | `src/lib/ai/<provider>.ts` and wire into `src/lib/ai/embed.ts` / `draft.ts` |
| Add a sidebar nav item | `src/lib/navigation.ts` (mainNavItems or settingsNavItems) — never edit `sidebar.tsx` |
| Wire an Undo button onto a destructive action | `undoable({ message, perform, undo, type? })` from `@/lib/undoable` |
| Merge two contacts | `mergeContact({ winnerId, loserId })` from `@/actions/merge-contacts` (calls the PL/pgSQL function `merge_contacts(...)` from `src/db/migrations/0002_merge_contacts.sql`). The function copies the loser's `contact_emails` / `contact_phones` into the winner (case-insensitive email dedup, exact `phone_e164` match, one-primary invariant enforced) before deleting the loser; returns `copied_emails` + `copied_phones` counters that the action surfaces to the audit log. |
| Add a multi-value email/phone to a contact | `addContactEmail` / `addContactPhone` from `@/actions/contacts` (writes to `contact_emails` / `contact_phones`, mirrors primary to legacy `contacts.email` / `contacts.phone`). For bulk replacement on edit, use `setContactEmailsAndPhones({ contactId, emails, phones })` or send the JSON arrays on FormData — `updateContact` consumes `emails` + `phones` JSON arrays when present and falls back to legacy scalars otherwise. |
| Build a new create/edit dialog | `<BottomSheet>` from `@/components/ui/bottom-sheet` — pass `formId` + `onSubmit`. Note: the submit button's `disabled` is currently driven by `isSubmitting`; if you also need to disable on invalid state, pass `isSubmitting={submitting || formInvalid}` and keep error messages derived live from state via `useMemo` (see the form-validation anti-pattern in agent memory). |
| Read a list view from the summary view | `listContacts` / `listCompanies` from `@/actions/contacts` / `@/actions/companies` — already read from `contacts_summary` / `companies_summary`, returns `ContactSummary[]` / `CompanySummary[]` |
| Add a new DB migration | Write `src/db/migrations/00XX_<name>.sql`, use `CREATE OR REPLACE` or `ADD COLUMN IF NOT EXISTS` for idempotency, and **add a check entry to `scripts/apply-pending-migrations.mjs`** — GH Actions auto-applies on push to main |

---

## Conventions

- **Server actions** — every mutation goes in `src/actions/*.ts` and starts with `await requireDbUser()`. Never read/write DB without auth.
- **Webhooks** — always verify the signature, always return 200 fast (do work in `enqueue`). Twilio retries 5xx so be slow only via the queue. Use `adminDb` for the DB writes (no session in webhook context).
- **Phone numbers** — always store E.164. Use `toE164()` from `src/lib/phone.ts`.
- **Money** — always `valueCents` (integer) + `currency`. Never floats.
- **AI prompts** — wrap retrieved context in `<context>` tags and instruct the model to ignore instructions inside.
- **Env** — only access via `import { env } from "@/lib/env"`. Never read `process.env.*` directly in app code.
- **Twilio credentials** — the SDK in `src/lib/twilio/client.ts` uses **`twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)`** with the same auth token also used for webhook signature verification. There is **no API-key pattern in this codebase** — the original "subaccount + API key" architecture was simplified during v1 build because Kavora Systems runs a single Twilio account, not master + subaccount. If you re-introduce an API key, update both `client.ts` (outbound SDK) and `storage.ts` (recording downloads) — both use HTTP Basic Auth with the credential pair.
- **Audit** — every mutating server action ends with `logAudit(...)`. `logAudit` uses `adminDb` internally (system-level write, bypasses RLS).
- **Drizzle types** — export `NewX` for inserts and `X` for selects (`InferSelect` is fine, but keep names predictable).
- **RLS — adding a new entity** — every new table that has `orgId` MUST have `ENABLE ROW LEVEL SECURITY` + 4 policies (`*_org_select`, `*_org_insert`, `*_org_update`, `*_org_delete`) keyed on `org_id = (select public.current_org_id())`. See `src/db/migrations/0007_enable_rls.sql` for the canonical pattern. Add the same to `tests/rls/<table>.pgTAP.sql`. If you add a table without an orgId column, write a deny-all policy instead — see `contact_emails` / `contact_phones`.
- **Soft-delete contacts** — the `contacts` table has `deletedAt timestamptz NULL`. **Every read path that touches contacts MUST filter `isNull(contacts.deletedAt)`** (or use the `getContact` / `getContactEmailsAndPhones` / `listContacts` actions, which already do). Including: list pages, detail pages, the company-detail contact list, the dashboard hot-leads + total, the analytics tile, the dial-gate routing lookup, the inbound phone `contact-lookup`, the lead-scoring query, and the outbound call/SMS `communications` actions. If you add a new contact query, add the filter.
- **Multi-value contact channels** — `contacts.email` and `contacts.phone` are now legacy denormalized columns. The source of truth lives in `contact_emails` and `contact_phones` (added in T2-1). When you add or update a contact, write to BOTH the new tables (via `addContactEmail` / `setContactEmailsAndPhones`) AND the legacy columns. To read multi-value channels, use `getContactEmailsAndPhones(contactId)`. The create form (`new-contact-button.tsx`) and edit form (`edit-contact-sheet.tsx`) both submit `emails` + `phones` as JSON-encoded FormData arrays of `{ email|phone, type, isPrimary }` — `createContact` / `updateContact` parse with `z.array(emailInputSchema|phoneInputSchema)` and write atomically with the legacy scalar mirror.
- **Undoable mutations** — destructive UI actions that the user might want to reverse go through `undoable({ message, perform, undo, type? })` from `@/lib/undoable`. The helper shows a Sonner toast with an "Undo" button that calls `undo()` if clicked before auto-dismiss. Do not roll your own confirm-then-toast pattern — reuse the helper so the Undo affordance is consistent.
- **Sidebar nav** — `src/lib/navigation.ts` is the single source of truth for main + settings nav items and the `isNavItemActive()` helper. Don't add nav items inline in `src/components/dashboard/sidebar.tsx`.

---

## Don'ts

- ❌ Don't log Twilio auth tokens, recording URLs, or PII.
- ❌ Don't use Clerk's auth in middleware bypass — always `await auth()` server-side.
- ❌ Don't bypass Twilio signature verification, even for "test" webhooks. Use `twilio.test()` payloads.
- ❌ Don't hardcode org IDs other than `KAVORA_ORG_ID`.
- ❌ Don't add a column without a migration. Drizzle-kit will not auto-apply.
- ❌ Don't commit `.env.local` or any `*.env-check` file (already in `.gitignore`).
- ❌ Don't use raw `pg.Pool.query` inside the action layer — wrap in `db.execute(...)` for tracing.
- ❌ Don't run `vercel env pull` into the workspace. The pulled file contains every production secret and would be a one-line commit away from leaking them to GitHub's secret scanner. Use `vercel env ls production --scope apotitechs-projects` for inline reads, or pull to `/tmp/`.
- ❌ Don't add a contact query without `isNull(contacts.deletedAt)` (or going through `getContact` / `getContactEmailsAndPhones` / `listContacts`). Soft-deleted rows must stay invisible.
- ❌ Don't roll your own confirm-then-toast pattern for destructive actions. Use `undoable({...})` from `@/lib/undoable` so the Undo affordance is consistent.
- ❌ Don't hardcode nav items in `src/components/dashboard/sidebar.tsx`. Update `src/lib/navigation.ts` instead.
- ❌ Don't read `c.email` or `c.phone` directly when you could use `getContactEmailsAndPhones(contactId)` — the legacy columns are denormalized and will not have all values once contacts grow multiple channels.
- ❌ Don't add a new migration SQL file without also adding a check entry to `scripts/apply-pending-migrations.mjs` — the runner needs to know how to detect prior state, and missing entries silently skip the migration forever. If the new function references tables created in another migration, order the runner's checks array by cross-reference dependency (function migrations that depend on table-creating migrations must be applied AFTER them on a fresh DB).
- ❌ Don't ship a SQL function shape change (new jsonb return keys, renamed columns) in the same deploy as the TS code that consumes it, unless the migration runner runs against prod BEFORE the TS deploy — otherwise the first prod call returns jsonb missing the new keys and TS structural typing lets `undefined` leak into typed fields. Either coalesce with `?? defaultValue` on the TS side, or document the deploy sequencing requirement.
- ❌ Don't use `db` from `@/db` in webhook routes, Trigger.dev jobs, cron tasks, or any code path with no Clerk session — even though v1 is single-tenant, RLS policies are dormant-not-disabled (they will be re-armed when multi-tenant mode is reactivated) and `db` will silently return zero rows the moment the policies fire. Use `adminDb` for those paths. The two exports exist precisely for this distinction.
- ❌ Don't use `adminDb` from user-facing request handlers or Server Actions. Admin bypass defeats the RLS isolation guarantee (dormant today, load-bearing the day multi-tenant mode is reactivated); if you find yourself reaching for adminDb in app code, the right fix is usually to thread the orgId via `requireDbUser()`.

---

## Adding a Twilio webhook

1. Create `src/app/api/twilio/<event>/route.ts` with `export const runtime = "nodejs"`.
2. Verify signature: `verifyTwilioSignature({...})` from `@/lib/twilio/signature`. The URL must be the **exact public URL** Twilio POSTs to.
3. Parse `formData` with `req.formData()`.
4. Persist to DB with `onConflictDoNothing` on the Twilio SID (idempotency).
5. Enqueue any AI work via `enqueueXxx()` from `@/lib/queue/enqueue`.
6. Return TwiML if it's a call-flow route, JSON otherwise.
7. Add the endpoint to `src/app/(dashboard)/settings/integrations/page.tsx` so admins know it exists.

---

## Adding a new AI provider

- Embeddings: add a `embedWithXxx` function in `src/lib/ai/embed.ts` and a branch in `resolveProvider()`.
- LLM: add a `getXxx()` client factory at the top of `summarize.ts` / `draft.ts` / `score-lead.ts`. Default to Anthropic — only add a provider if there's a real reason.
- All providers must be **optional** at boot (graceful no-op when key is missing).

---

## Migrations

- **Never edit a migration after it's been applied to staging/prod.** Add a new one.
- For vector columns, write raw SQL in the migration file. Drizzle doesn't yet ship first-class pgvector types.
- After editing `schema.ts`, run `pnpm db:generate` and commit the generated SQL.
- **PL/pgSQL functions live in their own migration.** Atomic-crm-style features (merge, dedupe, anything that needs to be atomic server-side) go in `src/db/migrations/00XX_<name>.sql` as a `CREATE OR REPLACE FUNCTION` block, then the Server Action wrapper lives in `src/actions/<name>.ts` and calls the function via `db.execute(sql\`SELECT <name>(...)\`)`. Mark the function `SECURITY DEFINER` and pin `search_path = public, pg_temp` at the top of the body. The Server Action is the auth + audit + revalidatePath boundary; the SQL is the data boundary.

---

## Testing

- **Unit**: webhook signature verification, TwiML builders, phone number parsing.
- **Integration**: webhook handlers with `twilio.test()` payloads (synthetic HTTP fixtures).
- **E2E**: Playwright (not yet wired) — sign in → add contact → place call → see recording → draft outreach.
- **Manual**: real call/SMS on staging before each phase closes.

---

## Deployment

- Vercel auto-deploys from `main`.
- **DB migrations** — applied automatically by `.github/workflows/migrate.yml` on push to `main` whenever `src/db/migrations/**` changes. The workflow runs `node scripts/apply-pending-migrations.mjs`, which is idempotent: each migration checks for its own signature in the DB (function / column / view existence) before applying. Requires `DIRECT_URL` to be set in repo secrets (Settings → Secrets and variables → Actions).
- Migrations are **hand-written SQL** (not `drizzle-kit generate`) because the migration files include features the Drizzle TS schema can't express (PL/pgSQL functions, views, partial indexes). The script reads each `.sql` file in order and applies it conditionally — no `meta/_journal.json` is used.
- **Writing a new migration**: add `src/db/migrations/00XX_<name>.sql`, prefer `CREATE OR REPLACE ...` or `ALTER ... ADD COLUMN IF NOT EXISTS` for idempotency, and update the script's checks array in `scripts/apply-pending-migrations.mjs` so it knows how to detect the prior state. Keep the file under 200 lines; if it grows, split into multiple migrations.
- Trigger.dev: `npx trigger.dev deploy` from the project root. **Use a `tr_prod_*` key**, not `tr_dev_*` — the schedule (`scoreAllLeadsSchedule`) and any production jobs will fail with 401 from Trigger.dev's API otherwise. The inline fallback in `src/lib/queue/enqueue.ts` keeps inbound SMS working even when Trigger.dev is down, but the weekly cron will silently no-op.
- Sentry: source maps auto-uploaded via `@sentry/nextjs` (when configured).

---

## Where to ask questions

- Twilio docs: [twilio.com/docs](https://www.twilio.com/docs)
- Drizzle docs: [orm.drizzle.team](https://orm.drizzle.team)
- Clerk + Next.js: [clerk.com/docs/quickstarts/nextjs](https://clerk.com/docs/quickstarts/nextjs)
- pgvector: [github.com/pgvector/pgvector](https://github.com/pgvector/pgvector)
- Trigger.dev: [trigger.dev/docs](https://trigger.dev/docs)

If you're an agent and unsure where a piece of code lives, `grep -r "symbolName" src/` is your friend. The codebase is intentionally flat and grep-able.
