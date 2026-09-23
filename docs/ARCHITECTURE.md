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
| **Twilio (subaccount + API key)** | Subaccount isolation means a leaked key only exposes the subaccount. API key (not auth token) means we can rotate without downtime. |
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
- **CRM core** — `contacts`, `companies`, `deals`, `pipelines`, `pipeline_stages`, `tags`, `contact_tags`, `notes`
- **Twilio** — `phone_numbers`, `calls`, `sms_messages`
- **Timeline** — `activities`, `ai_summaries`
- **AI** — `ai_drafts`, `ai_styles`, `lead_scores`, `embeddings`
- **Ops** — `audit_log`

Money is stored as `value_cents` (integer) + `currency` (ISO 4217). Phone numbers are always E.164.

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
| **DB migrations** | Drizzle-kit, applied via CI on `main` to staging branch first, manual promote to prod. |
| **Outage fallback** | If Next.js is down, Twilio voice still routes via static TwiML. SMS inbound is lost (rare); retries on recovery. |
| **PII / GDPR** | Per-contact "forget me" action wipes transcripts + embeddings + recordings. Audit-logged. |
| **Audit log** | Every mutating action (contacts/deals/companies/notes/AI) calls `logAudit`. AI actions explicitly tagged `ai.draft`, `ai.style_saved`, `lead.score`. |
| **Cost spikes** | Per-tenant LLM cap enforced in Trigger.dev; alerts at 80%. |

---

## Security

- Twilio subaccount + API key (rotatable).
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

## Roadmap (post-v1)

- Email integration (Gmail/MS Graph OAuth, SendGrid send)
- WhatsApp via Twilio Conversations
- Browser-based softphone (Twilio Voice JS SDK)
- Multi-tenant org switcher
- Custom fields on contacts/deals
- Webhooks out (Zapier-style automations)
- Mobile app (React Native + the same Twilio backend)
