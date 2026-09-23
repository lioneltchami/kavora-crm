# Kavora CRM

A custom CRM for **Kavora Systems** (AI agency) with a working Twilio phone number and AI-powered outreach.

- 📞 Real US phone number with inbound/outbound voice (recording + voicemail) and two-way SMS/MMS
- 🤖 AI summaries on every call/SMS, lead scoring, AI-drafted outreach (with "why I picked this" citations), and RAG over past conversations
- 🧱 Single-tenant data model that can extend to multi-tenant later without a rewrite
- 🔒 Twilio subaccount + API key, signed webhooks, server-only env access, audit log on all mutations

> **Status:** Phase 0–2 complete (skeleton + vanilla CRM + Twilio working number). Phases 3–5 (call intelligence, RAG + drafts, lead scoring cron) wired but need AI provider keys to fully activate.

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

### Working number
- Buy a US number from `/settings/phone-numbers/buy`
- Call it from any phone → rings team cells in parallel; if no answer, voicemail
- After the call, recording + transcript + AI summary appear on the matched contact's timeline within ~90 s (when Deepgram + Anthropic are configured)
- SMS to the number shows up in `/inbox` and is auto-linked to the contact (or auto-creates one)

### Vanilla CRM
- Create contact → link to company → create deal → drag between stages
- Invite a teammate via Clerk dashboard — they appear in `/settings/team` automatically

### AI showcase
- After 5+ completed calls, "Draft outreach" on a contact returns 2-3 candidate drafts, each with a "why I picked this" panel listing cited past conversations and similarity scores
- Lead score widget on dashboard updates after the weekly cron, explains the rationale on hover, and badges cold/warm/hot by score
- Every AI action (draft, voice-style save, lead score) is logged in `audit_log`

---

## Costs (light usage)

~$80–150/mo + telephony, dominated by:
- Vercel Pro $20
- Supabase Pro $25
- Twilio number + voice + SMS (≈$15 at 500 min + 500 SMS)
- Anthropic Sonnet for outreach drafts (~$15)

Full breakdown in the implementation plan.

---

## License

UNLICENSED — internal Kavora Systems use only.
