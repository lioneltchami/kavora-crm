# Phase 0 Review — Kavora CRM

## ponytail

Over-engineering against the Phase 0 skeleton:

- `package.json:18`: `delete:` `postinstall: "prisma generate || true"` — project uses Drizzle, never Prisma.
- `package.json:21,24-25,39,41,52,59,63-64`: `delete:` Phase 1+ deps unused at Phase 0 — `@anthropic-ai/sdk`, `@dnd-kit/*`, `@sendgrid/mail`, `@trigger.dev/sdk`, `next-themes`, `svix` (only Clerk webhook uses it but the webhook handler can be its own dep later), `libphonenumber-js`, `uuid`. (~ -20 deps / ~25 lines.)
- `package.json:26,37,44,57,61`: `delete:` `@hookform/resolvers`, `@radix-ui/react-toast` (sonner owns toasts), `cmdk`, `react-hook-form` (no forms wired), `server-only`, `dotenv` (drops once seed.ts drops). (~ -5.)
- `package.json:52`: `delete:` `next-themes` — no ThemeProvider / theme toggle is wired anywhere in the listed files.
- `.env.example:21-60`: `yagni:` 25+ Phase-1+ envs (Twilio SIDs/tokens, Deepgram, Voyage, OpenAI, Anthropic, Trigger.dev, Sentry, PostHog, SendGrid). Phase 0 needs only `DATABASE_URL`, Clerk pub + secret + webhook secret, and `NEXT_PUBLIC_APP_URL`. (~ -50 lines.)
- `src/db/schema.ts:117-606`: `yagni:` full Phase-1+ table graph (`companies`, `contacts`, `pipelines`, `pipeline_stages`, `deals`, `tags`, `contact_tags`, `notes`, `phone_numbers`, `calls`, `sms_messages`, `activities`, `ai_summaries`, `ai_drafts`, `ai_styles`, `lead_scores`, `embeddings`) shipped at Phase 0. Plan §"Phased Build Plan" explicitly carves Phase 0 to scaffold + baseline. (~ -480 lines.)
- `src/db/schema.ts:613-617`: `shrink:` `audit_log` uses `serial` PK + `text entity_id`, every other table uses `uuid` PK + typed FKs. Pick one and stick with it. (~ -4 lines of churn later.)
- `src/db/schema.ts:15,749`: `delete:` `import { sql }` from `drizzle-orm` and `void sql;` at the bottom — never used.
- `src/db/migrations/0001_init.sql:50-326`: `yagni:` mirror the schema cut above. Migration file even includes `pipelines` + `pipeline_stages` seed inserts which the plan places in Phase 1. (~ -270 lines.)
- `src/db/seed.ts`: `delete:` entire file. `pnpm db:migrate` already inserts the Kavora org row (`0001_init.sql:312-313`). Keeping seed.ts means double-INSERT plus the `void contacts;`/`void sql;` placeholder scaffolding. (~ -37 lines.)
- `src/lib/env.ts:24-54`: `shrink:` trim Zod schema to Phase 0 vars (~6 keys instead of 25). All the `*Configured` flags exist for Phase-1+ callers and have no callers in Phase 0. (~ -50 lines.)
- `src/lib/auth.ts:29-45`: `yagni:` `getAuthedUser` wraps `requireUser` with `role: "owner"` hardcoded — the doc-comment on L42 even admits "refined in DB row". Delete; callers go straight to `requireDbUser()`. (~ -20 lines.)
- `src/db/index.ts:16,27,30,33`: `native:` reads `process.env.*` directly. `docs/AGENTS.md` §Conventions: *"only access via `import { env } from "@/lib/env"`. Never read `process.env.*` directly in app code."* `src/db/index.ts` is app code.
- `src/app/api/webhooks/clerk/route.ts:16`: `native:` same — `process.env.CLERK_WEBHOOK_SECRET` should come from `env.CLERK_WEBHOOK_SECRET`.
- `src/db/index.ts:27`: `native:` `rejectUnauthorized: false` for Supabase SSL is a workaround that hides cert validation; the Supabase pooler URL is paired with the standard Supabase CA. Use the project's supabase CA cert instead. Also `.includes("supabase")` is brittle to URL rename.
- `next.config.ts:6-9,18`: `delete:` `experimental.serverActions.bodySizeLimit` (no actions wire anything but text yet) and `serverExternalPackages: ["twilio"]` (twilio is not imported in any Phase-0 file). (~ -5 lines.)

net: **-800 lines possible** once the skeleton is actually skinned-down to Phase 0.

## Standards

Conventions cited from `docs/AGENTS.md` and Fowler smells:

- **Process env bypass** (`src/db/index.ts:15-34`, `src/app/api/webhooks/clerk/route.ts:16`, `src/db/seed.ts:6,14`). AGENTS §Conventions: *"only access via `import { env } from "@/lib/env"`. Never read `process.env.*` directly in app code."* Five callsites violate this. Route them through the validated `env` from `src/lib/env.ts`.
- **Speculative Generality** (`src/db/schema.ts:117-606`, `src/db/migrations/0001_init.sql:50-326`, `src/lib/env.ts:24-54`, `package.json:20-64`, `.env.example:21-60`). Tables, env keys, and packages for Phase 1–5 are sitting in the Phase-0 slice. Cut to `organizations` + `users` (which `requireDbUser` needs) + `audit_log` (which `logAudit` writes to).
- **Inconsistent Abstraction** (`src/db/schema.ts:613-617`). `audit_log` uses `serial("id")` + `text entity_id` while every other table is `uuid` PK + typed FK. Either normalize audit_log to uuid+FK, or extract a small "polymorphic reference" pattern. The mixed PK strategy also breaks the `auditLog.$inferSelect` shape consistency the convention §"Drizzle types" asks for.
- **Middle Man** (`src/lib/auth.ts:29-45`). `getAuthedUser` exists only to be wrapped by `requireUser`, with a hardcoded `role: "owner"` placeholder that `requireDbUser` immediately overwrites from DB. Two layers, one job.
- **Dead Code placeholder pattern** (`src/db/seed.ts:36-37`, `src/db/schema.ts:748-749`). `void contacts; void sql;` / `void sql;` silences unused-import lint rather than removing unused imports. Stops the compiler from telling you the schema/seed is over-broad.
- **`src/app/api/webhooks/clerk/route.ts:44-64`**: minor repeated-code — `name` / `email` / `imageUrl` expressions are computed twice (insert values + onConflict set). Extract a `userValues(u)` helper.
- **`src/components/ui/separator.tsx`, `tabs.tsx`, `select.tsx`, `dialog.tsx`**: out of scope for Phase 0 — no consumer in `(dashboard)/`/sign-in/sign-up/health pages. Acceptable to ship with shadcn CLI scaffolder, but flag so Phase 1 doesn't accumulate a 30-primitive library unused.

No review-only Standards violation in: `middleware.ts` (correct Clerk usage), `src/app/page.tsx` (server-side `auth()`), `src/app/layout.tsx`, `src/components/ui/badge.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`, `button.tsx` (standard shadcn), `src/components/dashboard/topbar.tsx`.

## Spec

Spec source: `plan.md` §Summary, §Proposed Architecture, §Data Model, §Phased Build Plan.

**Plan §Phased Build Plan — Phase 0:**
- *"Next.js 15 + Tailwind + shadcn/ui scaffold."* ✓ Met.
- *"Supabase project + Drizzle migrations baseline."* Partial: migration file ships 17 Phase-1+ tables, not a baseline. Spec says baseline; code ships the whole plan.
- *"Clerk auth wired, user provisioning webhook."* ✓ Met (`src/app/api/webhooks/clerk/route.ts`, `src/lib/auth.ts`).
- *"`organizations` seeded with Kavora row."* ✓ Met, but done twice (`seed.ts:19-22` + migration `L312-313`). Pick one.
- *"Vercel deploy + GitHub Actions + Sentry."* Out of scope of this review (no Sentry file in Phase-0 list).

**Plan §Data Model:** the schema is complete and matches the spec column-for-column where used — single-tenant `org_id` everywhere, E.164 width, `value_cents` integer + currency, pgvector on `embeddings` (raw SQL in migration ✓), `audit_log` columns. The model is faithful, just oversized for Phase 0.

**Plan §State, Concurrency, Failure & Recovery:** *"Idempotent handlers keyed on `CallSid`/`MessageSid` — first write wins."* Schema enforces this via `uniqueIndex` on `calls.twilio_call_sid` and `sms_messages.twilio_message_sid`. ✓

**Plan §Security & Compliance:**
- *"Drizzle row-level security enabled in permissive mode for v1 single-tenant."* **Missing.** Migration creates no `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and no permissive policies. Schema FKs cascade but nothing actually scopes rows by `orgId`. Plan says RLS is the chosen gate, not cascade FK.
- *"Twilio credentials in Vercel env, never logged. Use Twilio subaccount + API key (not master auth token)."* `.env.example:21-27` honours both shapes. ✓

**Plan §AI Showcase / Locked models:** env defaults `claude-haiku-4-5` / `claude-sonnet-4-5` match the plan's "Locked decisions". ✓

**Plan §Cost Estimate:** Plan notes email as Phase 5+ optional. `.env.example:57-59` ships `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL` — scope creep, plan §Unresolved Decisions #3 says *"Default: defer to v2 unless user says otherwise."*

**Plan §Open Questions:** none blocking Phase 0; routing/domain/toll-free vs local deferred correctly.

**Scope creep vs the Phase-0 carve-out:** `package.json` carries `@anthropic-ai/sdk` (Phase 3), `@dnd-kit/*` (Phase 1), `@sendgrid/mail` (Phase 5), `@trigger.dev/sdk` (Phase 2), `next-themes` (UI), plus 25+ future env vars. None are wired in any Phase-0 file reviewed. Out-of-spec for Phase 0.

**Missing from Phase 0 per plan:**
- RLS permissive policies (plan §Security).
- `redirect("/dashboard")` in `src/app/page.tsx:6` lands on a route that is not in the Phase-0 scope; will 404 until Phase 1 lands. Mitigation: redirect to `/sign-in` only or to a stub `page.tsx` that returns "Coming soon".

## Summary

- Phase 0 is roughly 800 lines too large: schema + migration + env + deps + seed already include the entire data model, AI/Twilio/Trigger/SendGrid packages, and ~25 future env keys (`src/db/schema.ts:117-606`, `migrations/0001_init.sql:50-326`, `package.json:20-64`, `.env.example:21-60`, `src/db/seed.ts`).
- Five callsites read `process.env.*` directly, bypassing the AGENTS.md §Conventions envelope (`src/db/index.ts:15-34`, `src/app/api/webhooks/clerk/route.ts:16`, `src/db/seed.ts`). Route them through `src/lib/env.ts`.
- `src/lib/auth.ts:29-45` exports a `getAuthedUser` wrapper that hardcodes `role: "owner"` and is always overridden by `requireDbUser` — pure middle-man; delete it.
- Plan-mandated RLS permissive policies are missing in `migrations/0001_init.sql`; schema cascades via FK but nothing scopes by `orgId` at the database layer (plan §Security).
- `src/app/page.tsx:6` redirects to `/dashboard`, which is not in the Phase-0 slice and will 404; pick a stub target until Phase 1 lands the dashboard group. `seed.ts` also double-INSERTs the org row that the migration already seeds — delete seed.ts.
