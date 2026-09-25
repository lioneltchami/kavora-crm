# Architecture

How the pieces fit together, why we made the choices we did, and where to extend.

---

## High-level diagram

```
                          ┌──────────────────────────────┐
                          │          Browser              │
                          │  Next.js 15 (App Router)      │
                          │  shadcn/ui + Tailwind         │
                          └──────────────┬────────────────┘
                                         │ HTTPS (RSC + Server Actions)
                                         ▼
                          ┌──────────────────────────────┐
                          │   Vercel (Next.js runtime)   │
                          │   /api/twilio/* (webhooks)   │
                          │   /api/ai/*     (drafts)     │
                          └──────┬───────────┬───────────┘
                                 │           │
            ┌────────────────────┘           └────────────────────┐
            ▼                                                     ▼
   ┌────────────────────┐                              ┌────────────────────┐
   │  Supabase Postgres │  pgvector                    │   Clerk (auth)     │
   │  Drizzle schema    │◄────── embeddings ──────────┤   users + sessions │
   │  Row-level security│                              └────────────────────┘
   │  S3 storage        │
   └─────┬──────────────┘
         │ triggers / queued jobs
         ▼
   ┌────────────────────┐
   │   Trigger.dev      │ ─── Deepgram (STT) ─── Anthropic (LLM) ─── Voyage (embed)
   │   scheduled +      │
   │   on-demand tasks  │
   └────────────────────┘

   ┌────────────────────┐         ┌────────────────────┐
   │      Twilio        │ ◄────── │   Public PSTN/SMS  │
   │  Voice + Messaging │ ──────►│   (real customers)  │
   │  Recordings → S3   │         └────────────────────┘
   └────────────────────┘
```

---

## Why this stack

| Decision | Why |
|---|---|
| **Next.js 15 App Router** | Server actions keep mutations close to the UI without an extra API layer; RSC means dashboards render fast with zero JS hydration cost. |
| **Supabase Postgres** | Managed, point-in-time recovery, **pgvector** is first-class for our RAG use case, and the S3-compatible Storage handles call recordings without a separate bucket. |
| **Drizzle ORM** | SQL-first, transparent migrations, plays well with Supabase's pooler, type-safe without runtime overhead. |
| **Clerk** | Polished hosted UI (sign-in/sign-up), easy MFA, **webhooks** auto-sync our `users` table. We considered Supabase Auth but Clerk's DX is faster for a customer-facing app. |
| **Twilio (Account SID + Auth Token)** | Single-account credential covers both outbound SDK calls (in `src/lib/twilio/client.ts`) AND inbound webhook signature verification (in `src/lib/twilio/signature.ts`). The earlier subaccount + API-key pattern was simplified during v1 build — Kavora Systems runs a single Twilio account, not master + subaccount. |
| **Deepgram Nova-2** | Cheapest STT with great accuracy; ~30 s for a 10-min call. Alternatives: AssemblyAI (similar cost, more features), Whisper (self-host = ops burden). |
| **Anthropic Claude** | Best-in-class instruction following for outreach drafts in our voice. Haiku for summaries/scoring keeps cost down. |
| **Voyage embeddings** | Cheaper than OpenAI, optimized for retrieval. We use 1024 dims to match the IVFFlat index lists. |
| **Trigger.dev v3** | Durable retries, cron, and easy local dev (inline fallback). Beats building our own queue. |
| **shadcn/ui** | Component code lives in our repo (no npm-bloat from a UI kit), Tailwind + Radix primitives, fully customizable. |

---

## Data model

All tables carry `orgId` (always `"kavora"` in v1). Single-tenant is enforced by a one-row `organizations` table + permissive RLS. To go multi-tenant later, flip the RLS policies and add a Clerk org claim to the JWT.

Tables:

- **Identity** — `organizations`, `users`
- **CRM core** — `contacts`, `companies`, `deals`, `pipelines`, `pipeline_stages`, `tags`, `contact_tags`, `notes`, `contact_emails`, `contact_phones`
- **Twilio** — `phone_numbers`, `calls`, `sms_messages`
- **Timeline** — `activities`, `ai_summaries`
- **AI** — `ai_drafts`, `ai_styles`, `lead_scores`, `embeddings`
- **Ops** — `audit_log`

Money is stored as `value_cents` (integer) + `currency` (ISO 4217). Phone numbers are always E.164 (CHECK constraint on `contact_phones.phone_e164` + `toE164()` at write time).

### Multi-value contact channels (T2-1 + v1.8 UI)

`contacts.email` and `contacts.phone` remain as legacy single-value columns (denormalized for backwards compatibility with list views, AI outreach, and Twilio lookup paths). The source of truth lives in two normalized tables:

- `contact_emails (id, contact_id, email, type, is_primary, created_at)` — type enum `('work' | 'home' | 'other')`. At most one row per contact may have `is_primary = true` (app-layer discipline; no DB-level partial unique constraint yet).
- `contact_phones (id, contact_id, phone_e164, type, is_primary, created_at)` — same shape. `phone_e164` carries a CHECK constraint enforcing `^\+[1-9]\d{1,14}$`.

8 new Server Actions in `src/actions/contacts.ts` (`addContactEmail`, `removeContactEmail`, `setPrimaryContactEmail`, `addContactPhone`, `removeContactPhone`, `setPrimaryContactPhone`, `setContactEmailsAndPhones`, `getContactEmailsAndPhones`). `createContact` and `updateContact` accept `emails` + `phones` JSON FormData fields (wire format: `z.array(emailInputSchema|phoneInputSchema).parse(JSON.parse(formData.get("emails"|"phones")))`) and write to BOTH the new tables AND the legacy columns in a transaction.

**v1.8 form UI** — both `new-contact-button.tsx` (create flow) and `edit-contact-sheet.tsx` (edit flow) expose the multi-value channels with per-row add / remove / "Make primary" toggle inside a `space-y-2 rounded-md border p-3` sub-section (matches the `SmsComposer` grouping pattern). Validation surfaces inline via `useMemo`-derived per-row error maps; phone validation runs `toE164()` from `src/lib/phone.ts` and email validation rejects non-RFC-5321 values without using HTML5 native validation (which would silently block form submission). Edit-sheet fetch on mount is cancel-safe via a `cancelled` flag. To drop the legacy columns safely, every read path that references `c.email` / `c.phone` must first be migrated to read from `contact_emails` / `contact_phones`.

### Soft-delete (contacts only)

`contacts.deleted_at timestamptz NULL` — `NULL` means active. Soft-delete via `softDeleteContact(id)`; restore via `restoreContact(id)`. Every read path that touches contacts (list / detail / company-detail / dashboard hot-leads / analytics tile / dial-gate routing / inbound phone lookup / lead scoring / outbound call + SMS) **must** filter `isNull(contacts.deletedAt)`. The `getContact` and `listContacts` Server Actions already do. UI surfaces `undoable({...})` from `@/lib/undoable` so the toast carries an "Undo" button that calls `restoreContact` if clicked before the 5-second auto-dismiss.

### Dedupe — `merge_contacts` PL/pgSQL function

`src/db/migrations/0002_merge_contacts.sql` defines `merge_contacts(winner_id uuid, loser_id uuid, p_org_id varchar) RETURNS jsonb`. Atomic transaction:

1. Guard rails: same org, both exist, winner ≠ loser.
2. Reassign every FK referencing the loser to the winner (`notes`, `deals`, `calls`, `sms_messages`, `activities`, `ai_drafts`, `lead_scores`).
3. `COALESCE(winner, loser)` for single-value scalars (`email`, `phone`, `profile_notes`, `source`, `company_id`, `owner_user_id`, `last_name`).
4. Copy `contact_tags` rows from loser to winner via `INSERT ... ON CONFLICT DO NOTHING`.
5. **v1.8 — Channel reconciliation**: copy `contact_emails` rows from loser to winner, skipping case-insensitive duplicates on `email` value (preserving original case on the stored value), enforcing one-primary invariant per contact by demoting any existing winner primary row before promoting a loser primary. Same for `contact_phones` with exact match on `phone_e164` (the CHECK constraint guarantees canonical format). Counters `v_copied_emails` / `v_copied_phones` feed `copied_emails` / `copied_phones` keys in the jsonb return.
6. Delete the loser (FK cascades clean up the loser's channel rows since they were already copied).
7. Return jsonb `{ winner_id, loser_id, reassigned_*, copied_tags, copied_emails, copied_phones }`.

`SECURITY DEFINER` + `search_path = public, pg_temp` pinning. The Server Action wrapper at `src/actions/merge-contacts.ts` is the auth + audit + revalidatePath boundary; the new `copiedEmails` / `copiedPhones` fields flow into `logAudit.meta` via the existing `...result` spread. The migration runner detects the updated function body via a `pg_proc.prosrc` substring match on `'copied_emails'` so the runner can re-apply the migration even after the function exists. The runner's check ordering for this migration must place `0005_contact_emails_phones` BEFORE `0002_merge_contacts` — the function body references those tables, so a fresh-DB bootstrap would fail at 0002 with "relation does not exist" if the table-creating migration hadn't run yet (ordering is non-load-bearing on already-migrated DBs because each check is independently idempotent).

### List pages with DB summary views (T2-2 + T2-3)

Every list page reads from a SQL view that pre-aggregates counts in Postgres instead of N+1-ing them in Drizzle:

- `contacts_summary` — `contacts` joined LEFT with `deals` / `calls` / `sms_messages` / `activities`. Embeds `nb_deals`, `nb_calls`, `nb_sms`, `last_activity_at` (`GREATEST` across activity timestamps). Filters `contacts.deleted_at IS NULL` inside the view (the T1-3 soft-delete contract — callers don't repeat the filter).
- `companies_summary` — `companies` joined LEFT with `contacts` (active only, soft-deleted excluded) + `deals`. Embeds `nb_contacts`, `nb_deals`, `nb_open_deals` (count distinct where `status='open'`).

Drizzle type defs at `src/db/views.ts` use `pgView(...).existing()` so `drizzle-kit` doesn't try to emit CREATE VIEW migrations. List pages route through `listContacts()` / `listCompanies()` which read from the views; the page shell is a thin server component that delegates rendering to `<ContactList>` / `<CompanyList>` wrappers (client components that choose desktop or mobile content via `useIsMobile()`). Desktop variant renders a table or card grid; mobile variant renders a card stack. Empty states distinguish "no data" (rich CTA) from "no results" (inline clear-filters affordance).

### Bottom-sheet create/edit (T2-4)

Reusable `BottomSheet` wrapper in `src/components/ui/bottom-sheet.tsx` — `Sheet` with `side="bottom"`, `h-dvh flex flex-col`, `aria-describedby={undefined}` (silences Radix Dialog warning), sticky footer Save + Cancel (`flex-1 h-12`). Used by NewContactButton, NewCompanyButton, NewDealButton, and `edit-contact-sheet.tsx` (the contact edit route at `/contacts/[id]/edit`). Mobile-first by default — full-height on every viewport per atomic-crom §10.

---

## End-to-end flows

### A. Inbound call
1. Caller dials Twilio number.
2. Twilio POSTs `/api/twilio/voice` (signed).
3. Handler verifies signature → finds/creates contact by `From` → persists `calls` row (idempotent on `twilio_call_sid`).
4. Returns TwiML: consent announcement → parallel `<Dial>` to team cells with `record-from-answer` → on no-answer, voicemail.
5. Twilio emits `statusCallback` to `/api/twilio/status`; we update the row.
6. When recording is ready, Twilio POSTs `/api/twilio/recording` → we download to Supabase Storage → enqueue `transcribe_call`.

### B. Outbound call (click-to-dial)
1. User clicks **Call** on a contact → server action `startOutboundCall`.
2. We place a Twilio call **to the agent's cell**, with TwiML that prompts "press 1 to connect."
3. On press 1, `/api/twilio/dial-gate` returns TwiML that dials the customer.
4. Status callbacks flow back through `/api/twilio/status`.

### C. Inbound SMS
1. Twilio POSTs `/api/twilio/sms` → verify signature → find/create contact → persist `sms_messages` row.
2. Enqueue `inbound_sms` job → Claude Haiku summary → embed.
3. Auto-ack TwiML.

### D. Outbound SMS
1. User composes in inbox → `sendSmsToContact` server action → Twilio REST → persist row.
2. Twilio's `sms-status` callback updates delivery state.

### E. AI summary of a call
1. `transcribe_call` job downloads recording, calls Deepgram Nova-2, saves transcript.
2. `summarize_call` (Haiku) extracts `{summary, next_actions, sentiment, topics}`.
3. `embed_activity` chunks + embeds the transcript into pgvector.

### F. AI-drafted outreach
1. User clicks **Draft outreach** on a contact.
2. Embed the intent + recent deal notes.
3. Retrieve top-k past chunks (cosine distance on pgvector).
4. System prompt = voice examples + retrieved chunks + intent.
5. Sonnet (email) / Haiku (SMS) returns 2-3 candidates.
6. User edits, sends via SMS or — future — email.

### G. Lead scoring (weekly cron)
1. Trigger.dev cron `score-all-leads` (Sunday 6am UTC) selects contacts with activity in the last 30 days (capped at 200 per run, batches of 3 in flight).
2. For each, Haiku scores 0-100 with rationale (validated by zod; invalid output is skipped, never writes NaN).
3. Stores in `lead_scores`; dashboard "Hot leads" widget surfaces top 5 in DESC order with contact name + bucketed badge (cold/warm/hot) + rationale-on-hover.

---

## State, concurrency, failure modes

| Concern | How we handle it |
|---|---|
| **Twilio webhook retries** | Idempotent on `CallSid` / `MessageSid` via unique indexes. First write wins, second is a no-op. |
| **Webhook signature** | Every public webhook verifies `X-Twilio-Signature` via `verifyTwilioWebhook(req, params)` — reconstructs the full URL (pathname + query string) so signatures match even when Twilio posts to URLs with `?customer=…`. |
| **Contact phone races** | `findOrCreateContactByPhone` uses `onConflictDoNothing` on the `(orgId, phone)` unique index, so concurrent webhook fan-out cannot race-create duplicates. |
| **Recording download failures** | Trigger.dev retries 3× with exponential backoff. Permanent failure → `transcript_status='failed'`, surfaced on contact timeline. |
| **AI provider rate limits** | Trigger.dev retries with backoff. UI shows "AI not configured" when keys are missing (graceful degradation). |
| **Embed retries (RAG poisoning)** | `embedActivity` deletes existing chunks for the same `(orgId, sourceType, sourceId)` before re-inserting, so retries do not double-index. |
| **PII leak to LLMs** | All LLM inputs pass through `redactPII` (SSN / credit-card / API-key patterns) before being sent. Original is preserved in DB. |
| **Softphone concurrency** | Outbound calls go to the agent's cell with a "press 1" gate; only one customer call can be in flight per agent at a time. |
| **DB migrations** | Hand-written SQL in `src/db/migrations/00XX_*.sql` applied idempotently by `scripts/apply-pending-migrations.mjs` (each migration declares its own "already applied?" signature check — function body substring, column existence, view existence — before applying). GH Actions runs the script on push to `main` via `.github/workflows/migrate.yml` whenever `src/db/migrations/**` changes. Requires `DIRECT_URL` in repo secrets. Hand-written rather than drizzle-kit-generated because the files include PL/pgSQL functions, views, partial indexes, and CHECK constraints that the Drizzle TS schema can't express. |
| **Outage fallback** | If Next.js is down, Twilio voice still routes via static TwiML. SMS inbound is lost (rare); retries on recovery. |
| **PII / GDPR** | Per-contact "forget me" action wipes transcripts + embeddings + recordings. Audit-logged. |
| **Audit log** | Every mutating action (contacts/deals/companies/notes/AI) calls `logAudit`. AI actions explicitly tagged `ai.draft`, `ai.style_saved`, `lead.score`. |
| **Cost spikes** | Per-tenant LLM cap enforced in Trigger.dev; alerts at 80%. |

---

## Security

- Twilio Account SID + Auth Token (same credential for outbound SDK and inbound webhook signature verification; rotate via the Twilio Console).
- Webhooks over HTTPS only.
- Recording bucket is **private**; signed URLs only, 5-min TTL.
- Clerk handles MFA; every dashboard route behind `auth()`.
- Rate-limit `/api/ai/*` per user.
- Audit log on every contact/deal mutation.
- AI prompts wrap retrieved chunks in `<context>` tags and explicitly tell the model to ignore instructions inside them (prompt-injection guard).
- Secrets only in Vercel env / 1Password. Never committed.

---

## Cost breakdown (light usage)

| Item | $/mo |
|---|---|
| Vercel Pro | 20 |
| Supabase Pro | 25 |
| Clerk | 0-25 |
| Twilio number | 1-15 |
| Twilio voice (~500 min) | ~8 |
| Twilio SMS (~500 msgs) | ~4 |
| Deepgram (~500 min) | ~3 |
| Anthropic Haiku (~5M tok) | ~5 |
| Anthropic Sonnet (~1M tok) | ~15 |
| Voyage embeddings | ~2 |
| Trigger.dev | 0-20 |
| Sentry + PostHog | 0-26 |
| **Total** | **$80-150 + telephony** |

---

## Roadmap

Tier 1 (T1-1 sidebar shell, T1-2 `merge_contacts`, T1-3 Sonner `undoable` soft-delete) shipped as v1.5. The first four Tier-2 items — DB summary views (T2-2), List/ListContent mobile split (T2-3), multi-value contact channels (T2-1), bottom-sheet create/edit dialogs (T2-4) — plus the multi-value form UI in new-contact + edit-contact sheets and the `merge_contacts` channel reconciliation — shipped as v1.7 → v1.8. **Phase A scaffolding shipped 2026-09-24 (RLS + adminDb + per-table orgId); Phase A.5 deferred Clerk Organizations pending 3+ clients**. RLS on 18 org-scoped tables + pgTAP isolation harness + non-superuser app pool + two-pool design are kept as defense-in-depth (dormant in v1 single-tenant mode — every table still carries `orgId` so reactivation is a Clerk upgrade + config flip, not a schema change). 32/32 pgTAP isolation tests pass against live Supabase DB; 15/15 vitest tests pass; typecheck + build clean. The Tier 2/3 plan from the atomic-crm research and the agency-platform pivot are the source of truth for what's next:

→ **[docs/research/atomic-crm/apply-to-kavora.md](./research/atomic-crm/apply-to-kavora.md)** — full Tier 1 / Tier 2 / Tier 3 breakdown with scores, effort estimates, dependencies, and the recommended 8-week schedule.
→ **[docs/research/ai-agency/README.md](./research/ai-agency/README.md)** — agency-platform pivot (Phase A is the foundation; Phase B adds per-tenant Twilio subaccounts, Phase C adds service catalog + billing).

Backlog (not on the v2 path):

- Email integration (Gmail/MS Graph OAuth, SendGrid send)
- WhatsApp via Twilio Conversations
- Browser-based softphone (Twilio Voice JS SDK)
- Custom fields on contacts/deals
- Webhooks out (Zapier-style automations)
- Mobile app (React Native + the same Twilio backend)
