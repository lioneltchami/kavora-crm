# Kavora CRM — Final Blind Review

Reviewer: blind, end-to-end. No prior context. Build verified locally with
dummy env (see *Validation* at bottom). All file paths absolute.

---

## ponytail

- `src/db/schema.ts:748` — `void sql;` is dead-import suppression. The `sql`
  helper is imported but never used anywhere in the file. Drop the import and
  the trailing statement. **−2 lines.**
- `src/db/seed.ts:36-37` — `void contacts;` / `void sql;` exist only to silence
  unused-import warnings for symbols that are NOT YET USED. The whole `seed.ts`
  is a 28-line shell that inserts one row by raw SQL; it should either be
  wired to the schema helpers or removed. **−8 lines** if removed, **−2** if
  just the `void`s go.
- `src/lib/ai/score-lead.ts:49-57` — the entire `summaries` query is dead
  code (`limit(0)` with a placeholder TODO and `void summaries`). Either
  finish it with `inArray(aiSummaries.activityId, recentActivityIds)` or
  remove the variable and the import of `aiSummaries`. **−9 lines.**
- `src/lib/twilio/twiml.ts:92-93` — `void opts.callerId; void opts.recordingStatusCallbackUrl;`
  in `voiceOutboundDialGate` to silence "unused parameter" warnings. The
  function takes 3 params but only uses `customerNumber`. Drop the unused
  fields from the opts type and the call site. **−6 lines.**
- `src/app/(dashboard)/settings/integrations/page.tsx:17-24` — missing
  `/api/twilio/recording-url` (real route exists at
  `src/app/api/twilio/recording-url/route.ts:1`). +1 line, not negative.
- `src/actions/communications.ts:61-66` (`sendSmsToContact`) — inserts an
  `activities` row missing `refId: smsRow.id` and `occurredAt`. Inbound
  webhook writes the same row correctly (`src/app/api/twilio/sms/route.ts:62-69`).
  Outbound path silently diverges. **+3 lines to fix.**
- `src/actions/communications.ts:115-124` (`startOutboundCall`) — no
  `activities` insert at all. Outbound calls are invisible on the
  polymorphic timeline. **+7 lines to fix.**
- `src/actions/deals.ts:170-194` (`updateDeal`) and
  `src/actions/companies.ts:78-100` (`updateCompany`) and
  `src/actions/settings.ts:85-95` (`updateMyRoutingPhone`) — three
  mutating actions with no `logAudit(...)` call, violating AGENTS.md
  "every mutating server action ends with `logAudit(...)`". **+9 lines to fix.**
- `src/lib/twilio/signature.ts:42` — `process.env.NEXT_PUBLIC_APP_URL`
  reads the raw env. Should be `env.NEXT_PUBLIC_APP_URL`. **No line delta.**

net: -10 lines possible.

---

## Standards

The codebase is broadly disciplined: Drizzle + Postgres with consistent
tenancy scaffolding, validated zod env, server-only gates on AI/twilio
modules, idempotent webhook inserts via `onConflictDoNothing`, and a
well-factored queue with an inline dev fallback. Twilio signature
verification reconstructs the public URL **including the query string**
(`src/lib/twilio/signature.ts:42-43`), so the
`/api/twilio/dial-gate?customer=…` route verifies correctly against
`X-Twilio-Signature`. The Drizzle pgvector migration
(`src/db/migrations/0001_init.sql:281-294`) includes the IVFFlat index
that the TS schema can't express. PII redaction
(`src/lib/pii.ts`) is consistently applied in `summarize.ts`,
`draft.ts`, and `score-lead.ts`. RAG context is wrapped in `<context>`
tags with an explicit "ignore instructions inside" instruction
(`src/lib/ai/draft.ts:145-149`).

Two Standards smells:

1. **Twilio TwiML uses relative URLs** for `action` and `statusCallback`
   attributes (`src/lib/twilio/twiml.ts:39, 47, 61, 85, 117`). Twilio
   requires absolute URLs; relative paths silently break callbacks. This
   will be caught the moment anyone makes a real call.
2. **Dead-import suppressions (`void X;`) appear in four files**
   (`schema.ts:749`, `seed.ts:36-37`, `score-lead.ts:57`,
   `twiml.ts:92-93`). The smell is consistent: code is being kept around
   for "future" use rather than deleted. Several of these are masking
   partially-implemented features (the score-lead summaries fetch is
   literally `limit(0)` with a TODO).

The middleware correctly enforces auth on everything that isn't a
public webhook. However, see `## Critical Bugs` #2 — the public-route
list is incomplete. Smoke-test was clean: `pnpm typecheck` passes,
`pnpm build` succeeds against dummy Clerk + DATABASE_URL env. Two
ESLint warnings during build (unused exports in `lib/datetime.ts`),
not blockers.

---

## Spec

Against the implementation plan's acceptance criteria:

**Working number**
- *Buy a US number from `/settings/phone-numbers/buy`* — **PASS**.
  `src/app/(dashboard)/settings/phone-numbers/buy/page.tsx` + `purchaseNumber()` in `src/lib/twilio/provisioning.ts:89-120` + `buyPhoneNumber()` action wires webhooks automatically.
- *Calling rings team cells; records if answered* — **PARTIAL PASS**. TwiML is correct (`voiceInbound`, `twiml.ts:24-68`) but `<Dial action="/api/twilio/voicemail">` and `<Number statusCallback="/api/twilio/status">` use relative paths — Twilio will not deliver those callbacks. Inbound routing itself works because the inline TwiML is returned synchronously, but no post-call status updates fire.
- *Recording → transcript → AI summary on contact within ~90 s* — **PASS** for the happy path: `enqueueCallTranscription` (`src/lib/queue/enqueue.ts:83-156`) chains Deepgram → summarizeCallTranscript → embedActivity, persists transcript and ai_summaries linked to the call's activity row (`enqueue.ts:113-132`).
- *Inbound SMS creates inbox entry, auto-links contact* — **PASS**. `src/app/api/twilio/sms/route.ts:32-69` finds-or-creates contact, inserts both `sms_messages` and `activities` rows idempotently.
- *Reply from `/inbox` delivers to sender* — **PASS**. `SmsComposer` (`src/components/inbox/sms-composer.tsx`) calls `sendSmsToContact` action.
- *Outbound call rings user's cell with "press 1" gate* — **PARTIAL PASS**. `voiceOutboundDialGate` (`twiml.ts:75-95`) prompts correctly, but `action` is relative; the dial-gate path also won't receive the press. Inbound side: `src/app/api/twilio/dial-gate/route.ts` works and verifies signature correctly with query string included.
- *All webhooks reject unsigned requests* — **PASS at code level**. `verifyTwilioWebhook` is called in every Twilio route (`voice/route.ts:23`, `sms/route.ts:23`, `recording/route.ts:17`, `status/route.ts:15`, `dial-gate/route.ts:19`, `dial-gate-bootstrap/route.ts:22`, `sms-status/route.ts:22`, `voicemail/route.ts:10`). Will fail in production because the middleware never reaches the verifier (see Critical Bugs #2).

**AI showcase**
- *Draft outreach cites past conversations in "why I picked this"* — **PASS**. `MultiDraftResult.retrievedSnippets` is returned and rendered (`src/components/contacts/draft-outreach-button.tsx:101-117`).
- *Hot leads widget shows rationale* — **PARTIAL FAIL**. Hot leads render with `orderBy(desc(score), desc(scoredAt))` and display name + bucket badge — that part is correct (`dashboard/page.tsx:38-51`). However the rationale is rendered as always-visible body text (`page.tsx:138`); the `title` attribute holds the scored date, NOT the rationale. Spec said "rationale-on-hover".
- *All AI actions in audit log* — **PARTIAL PASS**. `ai.draft` (`actions/ai.ts:36-48`) and `ai.style_saved` (`actions/ai.ts:93-100`) are logged. `lead.score` is NOT — the cron lives in `src/trigger/inbound-sms.ts:123-145` and writes only to `lead_scores`.

**Vanilla CRM**
- *Create contact → link company → create deal → drag stages → note → timeline* — **PASS**. Verified the full path: `createContact` → `updateContact` (with companyId) → `createDeal` (with companyId/contactId) → `moveDealStage` → `createNote` (which writes an `activities` row). Timeline renders from the polymorphic `activities` table, joined to `ai_summaries` by `activityId` (`contacts/[id]/page.tsx:82-88`).
- *Invite teammate via Clerk dashboard* — **PASS** (Clerk handles invite UI; webhook at `src/app/api/webhooks/clerk/route.ts` syncs `users`).
- *Filters/search <500 ms on 10k contacts* — not measurable without seed data; code uses `ilike` with `(orgId, ...)` index — adequate.

**Twilio multi-tenant primitives** (cross-checks from the task spec)
- `contacts(orgId, phone)` is `uniqueIndex` — **PASS** (`schema.ts:177`).
- `findOrCreateContactByPhone` uses `onConflictDoNothing({ target: [contacts.orgId, contacts.phone] })` — **PASS** (`contact-lookup.ts:51`).
- `/api/twilio/recording-url` filters by `orgId` — **PASS** (`recording-url/route.ts:31`).
- `scoreContact` filters contact by `orgId` — **PASS** (`score-lead.ts:35`).

---

## Critical Bugs

1. **TwiML relative URLs break callbacks** — `src/lib/twilio/twiml.ts:39, 47, 61, 85, 117` use `"/api/twilio/..."` for `action` and `statusCallback`. Twilio documents these as requiring absolute URLs (the `signature.ts` comment on lines 32-38 says exactly this for inbound URLs). Result in production:
   - Inbound call: `<Dial action="/api/twilio/voicemail">` → no-answer falls through to Twilio's default, our voicemail handler never runs.
   - Inbound call: `<Number statusCallback="/api/twilio/status">` → call rows stay at `status="ringing"` forever.
   - Outbound call: same status callback never fires.
   - Outbound gate: `<Gather action="/api/twilio/dial-gate?customer=...">` — even with `?customer=`, Twilio may not POST back to a relative URL.
   **Fix**: prepend `buildWebhookUrl(path)` to every action/statusCallback string. (Already done correctly for `recordingStatusCallbackUrl` — just mirror the pattern.)

2. **Middleware blocks all `/api/twilio/*` webhooks** — `src/middleware.ts:9-15` only excludes `/api/webhooks/(.*)`, `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/api/health`. Twilio POSTs to `/api/twilio/*` carry no Clerk session, so `auth.protect()` on line 19 redirects them to `/sign-in`. Signature verification never runs.
   **Fix**: add `"/api/twilio/(.*)"` to `createRouteMatcher([...])` in `src/middleware.ts:9-15`.
   **Reproduction**: deploy to staging, dial the number. Twilio's HTTP log shows 302 to `/sign-in` for every webhook.

3. **Dead-code AI summaries in `scoreContact`** — `src/lib/ai/score-lead.ts:49-57`. The `summaries` query has `.limit(0)` and a literal `// placeholder` comment. `void summaries` suppresses the unused-variable error. The prompt on line 73 only sees raw activity rows (capped at 20, last 30 days), missing the AI-extracted `summary / nextActions / topics`. Either ship `inArray(aiSummaries.activityId, recentActivityIds)` here, or delete the entire variable + import. As written, lead scores are noisier than the plan implies.

4. **Hot leads rationale is not "on hover"** — `src/app/(dashboard)/dashboard/page.tsx:134-139` renders `h.rationale` as visible body text. The `title={...}` attribute on line 136 only carries the scored date. Plan and README explicitly say "explains the rationale on hover". Either move the rationale to a tooltip (and show something else inline), or update the docs.

5. **`updateDeal` / `updateCompany` / `updateMyRoutingPhone` skip `logAudit`** — AGENTS.md "Conventions" line 52 requires every mutating server action to end with `logAudit(...)`. The three actions listed mutate DB rows but never call `logAudit`. Compliance audit and "every mutation has an audit row" promises in `ARCHITECTURE.md` and `AGENTS.md` are broken. Concrete files: `src/actions/deals.ts:170-194`, `src/actions/companies.ts:78-100`, `src/actions/settings.ts:85-95`.

6. **`process.env.NEXT_PUBLIC_APP_URL` read in app code** — `src/lib/twilio/signature.ts:42`. AGENTS.md line 51 says all env access goes through `import { env } from "@/lib/env"`. The signature path is the most security-sensitive place to violate this rule; an unset variable here means **all** Twilio signatures verify as false in production.

7. **Integrations page lists 8 of 9 webhooks** — `src/app/(dashboard)/settings/integrations/page.tsx:17-24` omits `/api/twilio/recording-url`, which is a real, auth-protected route used by the recording player. AGENTS.md "Adding a Twilio webhook" step 7 says every new webhook endpoint must be listed here.

---

## Ship verdict

**SHIP WITH CAVEATS** — the codebase is well-structured and the happy
paths (signature verification, PII redaction, idempotency, RAG retrieval,
embedding idempotency, multi-tenant column/index readiness, contact
auto-create, schema, migrations, build) are all in place. **But three
production-fatal bugs (#1, #2, #6 above) must be fixed before
production traffic:**

- Fix TwiML relative URLs (`src/lib/twilio/twiml.ts:39,47,61,85,117`).
- Add `/api/twilio/(.*)` to middleware public routes (`src/middleware.ts:9-15`).
- Read `NEXT_PUBLIC_APP_URL` via `env.NEXT_PUBLIC_APP_URL` (`src/lib/twilio/signature.ts:42`).
- Wire up `inArray(aiSummaries.activityId, ...)` or delete the dead code (`src/lib/ai/score-lead.ts:49-57`).
- Add `logAudit` to `updateDeal`, `updateCompany`, `updateMyRoutingPhone`.
- Move the rationale into a hover tooltip on the hot-leads widget (or amend the docs).
- Add `/api/twilio/recording-url` to the integrations page.

Without those, Twilio webhooks fail, call status never updates, the
voicemail fallback breaks, and outbound "press 1" doesn't connect.

---

## Top 5 Most Important Things to Fix

1. **`src/lib/twilio/twiml.ts:39,47,61,85,117`** — Replace every
   `"/api/twilio/..."` literal in TwiML `action` and `statusCallback`
   with `${buildWebhookUrl("/api/twilio/...")}`. This is the bug that
   will be on fire the first time anyone places a real call.

2. **`src/middleware.ts:9-15`** — Add `"/api/twilio/(.*)"` to the
   `createRouteMatcher` array. Right now Twilio webhooks get 302'd to
   `/sign-in` before signature verification runs.

3. **`src/lib/twilio/signature.ts:42`** — Change
   `process.env.NEXT_PUBLIC_APP_URL` to `env.NEXT_PUBLIC_APP_URL`. Also
   add a guard: if `env.NEXT_PUBLIC_APP_URL` is missing, fail closed —
   never silently fall back to the request URL in production.

4. **`src/lib/ai/score-lead.ts:49-57`** — Either implement the
   `aiSummaries` fetch with `inArray(aiSummaries.activityId, recentActivityIds)`
   and include `summary.nextActions`/`summary.topics` in the prompt, or
   delete the entire variable, the `aiSummaries` import, and the `void
   summaries` line. Don't ship a TODO with a `limit(0)`.

5. **`src/actions/deals.ts:170-194`, `src/actions/companies.ts:78-100`,
   `src/actions/settings.ts:85-95`** — Add `await logAudit({...})` to
   `updateDeal`, `updateCompany`, `updateMyRoutingPhone`. Then add
   `/api/twilio/recording-url` to `src/app/(dashboard)/settings/integrations/page.tsx`.
   These two together close out the AGENTS.md compliance gaps.

---

## Validation

- `pnpm typecheck` → ✅ exit 0
- `pnpm build` → ✅ exit 0 (build artifact lists all 9 twilio routes, all dashboard routes, middleware bundle)
- File count covered: 67 .ts/.tsx/.sql/.yml/.md files; all reviewed (no file skipped, no prior review opened).
- Manual checks: Drizzle index definitions match migration SQL (`uniqueIndex` ↔ `CREATE UNIQUE INDEX`); Twilio webhook handlers all gate on `verifyTwilioWebhook(req, params)`; PII redaction precedes every Anthropic call; embeddings idempotency uses DELETE-then-INSERT; cron target is `activities.occurredAt >= now-30d` capped at 200 with `CONCURRENCY=3`.

## Assumptions

- "AGENTS.md compliance" is taken to mean: the four bullets listed in the
  task brief (no raw `process.env.*` in app code, no `void X;`
  suppressions, every mutating action ends with `logAudit`, RAG context in
  `<context>` tags with ignore-instructions note). I checked each.
- I did NOT read any file under `docs/reviews/`.
- I treated `KAVORA_ORG_ID` and "single-tenant for v1" as the design
  intent; multi-tenant readiness is verified by the existence of
  `orgId` columns + the `(orgId, phone)` unique index.
- `pnpm db:migrate` was not run (no live DB). SQL was reviewed against
  schema.ts; the migration includes pgvector + IVFFlat + the seed rows.

## Blockers / Remaining Risks

- **Live Twilio + Live DB smoke test not run in this review.** All
  findings are from code review + build success. Recommend a staging
  end-to-end before sign-off (dial the number, watch `/api/twilio/status`
  arrive).
- **Trigger.dev v3 task definitions are not deployed.** Tasks defined in
  `src/trigger/inbound-sms.ts` will only run via the inline fallback
  until `npx trigger.dev deploy` is executed in prod. Acceptable for v1.
- The `next.config.ts` `serverExternalPackages: ["twilio"]` is correct
  for Node runtime; no Edge concerns identified.
