# Kavora CRM

A custom CRM for **Kavora Systems** (AI agency) with a working Twilio phone number and AI-powered outreach.

- 📞 Toll-free phone number with inbound/outbound voice (recording + voicemail) and two-way SMS/MMS
- 🤖 AI summaries on every call/SMS, lead scoring, AI-drafted outreach (with "why I picked this" citations), and RAG over past conversations
- 🧱 Single-tenant data model that can extend to multi-tenant later without a rewrite
- 🔒 Signed Twilio webhooks, server-only env access, audit log on all mutations

> **Status:** v1 shipped — working toll-free number live at `crm.kavora.systems`. All five build phases complete; AI features (summaries, drafts, lead scoring) activate automatically when their keys are present and degrade gracefully to "AI not configured" otherwise. See [Known limitations](#known-limitations) below.

---

## Quick start

```bash
pnpm install
cp .env.example .env.local          # fill in the values (see SETUP.md)
pnpm db:migrate                     # apply schema to Supabase Postgres
pnpm dev
```

Then visit [http://localhost:3000](http://localhost:3000) and sign in with Clerk.

For a guided walkthrough of provisioning every external account (Twilio, Clerk, Supabase, Deepgram, Anthropic, Voyage), see [SETUP.md](./docs/SETUP.md).

---

## What's in the box

| Capability | Where it lives |
|---|---|
| Inbound voice → team cells (parallel dial) → voicemail fallback | `src/app/api/twilio/voice` + `src/lib/twilio/twiml.ts` |
| Outbound calls with "press 1 to connect" gate | `src/actions/communications.ts` + `src/app/api/twilio/dial-gate*` |
| Inbound SMS with auto-ack | `src/app/api/twilio/sms` |
| Outbound SMS from contact page | `src/components/inbox/sms-composer.tsx` |
| Call recording → Supabase Storage → Deepgram transcript → AI summary | `src/app/api/twilio/recording` + `src/lib/queue/enqueue.ts` + `src/lib/ai/*` |
| AI-drafted outreach with RAG | `src/actions/ai.ts` + `src/lib/ai/draft.ts` |
| Lead scoring cron | `src/trigger/inbound-sms.ts` → `scoreAllLeadsSchedule` (weekly Sunday 6am UTC, contacts-with-activity-in-last-30d only, concurrency 3) |
| Drag-drop deal kanban | `src/components/deals/kanban-board.tsx` |
| Activity timeline | `src/components/contacts/timeline.tsx` |
| Audit log | `src/lib/audit.ts` |

---

## Repository layout

```
src/
├── app/
│   ├── (dashboard)/                  # all authenticated routes
│   │   ├── dashboard/
│   │   ├── contacts/                 # list + [id]
│   │   ├── companies/                # list + [id]
│   │   ├── deals/                    # kanban + [id]
│   │   ├── inbox/                    # SMS inbox
│   │   ├── calls/                    # call log
│   │   ├── activities/
│   │   ├── analytics/
│   │   └── settings/
│   │       ├── phone-numbers/        # the "working number" home
│   │       ├── team/
│   │       ├── ai/                   # voice-style examples
│   │       └── integrations/         # webhook endpoint reference
│   ├── api/
│   │   ├── twilio/                   # all Twilio webhooks
│   │   ├── webhooks/clerk/           # Clerk user sync
│   │   └── health/
│   ├── sign-in/, sign-up/
│   ├── layout.tsx, page.tsx, globals.css
├── components/
│   ├── ui/                           # shadcn primitives
│   ├── dashboard/                    # sidebar, topbar, page-header
│   ├── contacts/                     # composer, timeline, AI actions
│   ├── deals/                        # kanban, new-deal dialog
│   ├── inbox/                        # sms composer
│   ├── calls/                        # recording player
│   └── settings/                     # phone number actions, etc.
├── actions/                          # server actions
├── lib/
│   ├── auth.ts                       # Clerk → DB
│   ├── audit.ts                      # write to audit_log
│   ├── env.ts                        # zod-validated env
│   ├── phone.ts                      # E.164 helpers
│   ├── twilio/                       # client, signature, TwiML, provisioning, storage
│   ├── ai/                           # Deepgram, Anthropic, embeddings, drafts, scoring
│   └── queue/enqueue.ts              # Trigger.dev dispatcher (with inline fallback)
├── db/
│   ├── schema.ts                     # Drizzle schema (all tables)
│   ├── index.ts                      # pg + drizzle client
│   └── migrations/0001_init.sql      # first migration (includes pgvector + Kavora org seed)
├── trigger/                          # Trigger.dev task definitions
└── middleware.ts                     # Clerk auth middleware
docs/
├── SETUP.md                          # account provisioning + local dev
├── ARCHITECTURE.md                   # system design, data flow, decisions
└── AGENTS.md                         # conventions for future agents
```

---

## Acceptance criteria

The full list (from the implementation plan) is in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). Highlights:

### Working number (✓ shipped)
- Buy a US or toll-free number from `/settings/phone-numbers/buy` (Account SID + Auth Token auth)
- Call it from any phone → rings team cells in parallel; if no answer, voicemail
- After the call, recording + transcript + AI summary appear on the matched contact's timeline within ~90 s (when Deepgram + Anthropic are configured)
- SMS to the number shows up in `/inbox` and is auto-linked to the contact (or auto-creates one)
- Outbound SMS reply waits on Twilio toll-free verification (see [Known limitations](#known-limitations))

### Vanilla CRM (✓ shipped)
- Create contact → link to company → create deal → drag between stages
- Invite a teammate via Clerk dashboard — they appear in `/settings/team` automatically

### AI showcase (✓ wired, key-dependent)
- After 5+ completed calls, "Draft outreach" on a contact returns 2-3 candidate drafts, each with a "why I picked this" panel listing cited past conversations and similarity scores
- Lead score widget on dashboard updates after the weekly cron (`scoreAllLeadsSchedule` — Sundays 6 am UTC), explains the rationale on hover, and badges cold/warm/hot by score
- Every AI action (draft, voice-style save, lead score) is logged in `audit_log`

---

## Known limitations

Things to know before opening this up to real customers.

### Twilio Trial account restrictions
The deployed toll-free number is on a Twilio **Trial** account. Until you upgrade:
- **Outbound SMS is gated by toll-free verification** — submit at Twilio Console → Phone Numbers → Regulatory Compliance → Toll-Free verification. Approval is free and usually minutes-to-hours.
- **Outbound voice** to numbers outside the **US1 region** (e.g., Canadian area codes) is silently dropped at the carrier level. Stick to US numbers for testing.
- **No Verified Caller ID = no outbound to arbitrary customers.** Trial accounts can only send to numbers you've manually verified (max 5). Add recipients at Console → Phone Numbers → Verified Caller IDs.
- **Account auto-expires after 30 days.** Upgrade to a paid account to remove the cliff.

To upgrade: Twilio Console (top-left account switcher → `kavora-crm`) → Account → Billing → Upgrade. Upgrade itself is free; you only pay for usage.

### Trigger.dev environment
The scheduled job `scoreAllLeadsSchedule` is currently wired through a `tr_dev_*` secret key. That's fine for dev testing but means it can't reach a production Trigger.dev env. Switch to a `tr_prod_*` key once you upgrade Trigger.dev, otherwise the weekly cron will fail with 401 from Trigger.dev's API.

### A2P 10DLC registration (US carriers)
For sending SMS at volume to US mobile numbers (any meaningful usage past Trial-verified recipients), you need **A2P 10DLC brand + campaign registration** through The Campaign Registry. One-time ~$15 setup + $0.003/msg carrier fee. Without it, US carriers will filter or block your outbound messages. Toll-free verification covers most small-scale use cases.

### Credential hygiene — `vercel env pull` safety
**Never run `vercel env pull` into a git-tracked directory.** The pulled file contains every production secret (Twilio, Anthropic, Deepgram, Voyage, Supabase, Clerk, Trigger.dev). A single `git add` leaks them to GitHub's secret scanner, which blocks the push but logs the exposure permanently and requires rotating every credential.

Safe patterns when you need to inspect Vercel env vars:
- `vercel env ls production --scope apotitechs-projects` (read values inline; nothing written to disk)
- `vercel env pull /tmp/env-check` (outside the workspace)
- A workspace-local file is fine if (a) it's gitignored (the `.gitignore` already excludes `*.env-check`) and (b) you `git status` before any `git add`

---

## Costs (light usage)

~$80–150/mo + telephony while on Trial, dominated by:
- Vercel Pro $20
- Supabase Pro $25
- Twilio number + voice + SMS — ≈$15 at 500 min + 500 SMS (toll-free local numbers $1.15/mo; outbound ~$0.014/min voice, ~$0.008/SMS)
- Anthropic Sonnet for outreach drafts (~$15)
- Deepgram transcription (~$0.0043/min of audio) + Voyage embeddings (fractions of a cent per call)

Full breakdown in the implementation plan. Once you upgrade out of Twilio Trial, costs go up slightly for non-verified recipient SMS but the major line items stay similar.

---

## License

UNLICENSED — internal Kavora Systems use only.
