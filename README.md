# Kavora CRM

A custom CRM for **Kavora Systems** (AI agency) with a working Twilio phone number and AI-powered outreach.

- 📞 Toll-free phone number with inbound/outbound voice (recording + voicemail) and two-way SMS/MMS
- 🤖 AI summaries on every call/SMS, lead scoring, AI-drafted outreach (with "why I picked this" citations), and RAG over past conversations
- 🧱 Single-tenant data model that can extend to multi-tenant later without a rewrite
- 🔒 Signed Twilio webhooks, server-only env access, audit log on all mutations
- 🎛️ shadcn/ui admin shell — floating sidebar, `Cmd/Ctrl+B` collapse, mobile Sheet drawer
- 🔗 Contact dedupe — atomic `merge_contacts` PL/pgSQL function + Server Action
- ↩️ Soft-delete with Undo — `deleted_at` column + Sonner toast with "Undo" affordance
- 🗄️ DB summary views — `contacts_summary` + `companies_summary` with embedded aggregates (no N+1 on list pages)
- 📱 Mobile-first list pages — `<List>` + `<ListContent>` split with `useIsMobile()` variant switching
- 📇 Multi-value contact channels — `contact_emails` + `contact_phones` tables with type + is_primary, E.164 CHECK
- 📜 Bottom-sheet create/edit — sticky footer Save button, full-height on every viewport

> **Status:** v1.7 shipped — Tier 1 + first four Tier-2 items (sidebar, merge, undoable soft-delete, DB views, mobile list split, multi-value contact channels, bottom-sheet dialogs) live at `crm.kavora.systems`. All five v1 build phases complete; AI features (summaries, drafts, lead scoring) activate automatically when their keys are present and degrade gracefully to "AI not configured" otherwise. See [Known limitations](#known-limitations) below. The remaining Tier 2/3 roadmap is in [docs/research/atomic-crom/apply-to-kavora.md](./docs/research/atomic-crm/apply-to-kavora.md).

---

## Quick start

```bash
pnpm install
cp .env.example .env.local          # fill in the values (see SETUP.md)
node scripts/apply-pending-migrations.mjs   # idempotent migration runner
pnpm dev
```

Migrations are **hand-written SQL** (not `drizzle-kit generate`) because the migration files include features the Drizzle TS schema can't express (PL/pgSQL functions, views, partial indexes, CHECK constraints). The runner is idempotent: each migration declares its own "already applied?" signature check (function exists, column exists, view/table exists) before applying. CI auto-applies on push to `main` via `.github/workflows/migrate.yml`. See `docs/AGENTS.md` §Deployment for the full flow.

Then visit [http://localhost:3000](http://localhost:3000) and sign in with Clerk.

For a guided walkthrough of provisioning every external account (Twilio, Clerk, Supabase, Deepgram, Anthropic, Voyage), see [SETUP.md](./docs/SETUP.md).

---

## What's in the box

| Capability | Where it lives |
|---|---|
| Admin shell — floating sidebar, Cmd/Ctrl+B collapse, mobile Sheet drawer | `src/components/dashboard/sidebar.tsx` + `src/components/ui/sidebar.tsx` |
| Brand header + Clerk user footer in the sidebar | `src/components/dashboard/sidebar-brand.tsx` + `sidebar-user.tsx` |
| Sidebar nav config (main + settings) + active-state helper | `src/lib/navigation.ts` |
| List pages with mobile variants — `<List>` / `<ListContent>` split via `useIsMobile()` | `src/components/contacts/contact-list*.tsx` + `src/components/companies/company-list*.tsx` |
| DB summary views — `contacts_summary` + `companies_summary` with embedded `nb_deals` / `nb_calls` / `last_activity_at` aggregates | `src/db/migrations/0004_summary_views.sql` + `src/db/views.ts` + `listContacts` / `listCompanies` |
| Bottom-sheet create/edit dialogs — sticky footer Save, full-height on every viewport | `src/components/ui/bottom-sheet.tsx` (used by NewContactButton, NewCompanyButton, NewDealButton, edit-contact-sheet) |
| Multi-value contact emails + phones — `contact_emails` + `contact_phones` tables with type + is_primary, E.164 CHECK | `src/db/migrations/0005_contact_emails_phones.sql` + `src/db/schema.ts` + 8 new Server Actions in `src/actions/contacts.ts` |
| Inbound voice → team cells (parallel dial) → voicemail fallback | `src/app/api/twilio/voice` + `src/lib/twilio/twiml.ts` |
| Outbound calls with "press 1 to connect" gate | `src/actions/communications.ts` + `src/app/api/twilio/dial-gate*` |
| Inbound SMS with auto-ack | `src/app/api/twilio/sms` |
| Outbound SMS from contact page | `src/components/inbox/sms-composer.tsx` |
| Call recording → Supabase Storage → Deepgram transcript → AI summary | `src/app/api/twilio/recording` + `src/lib/queue/enqueue.ts` + `src/lib/ai/*` |
| AI-drafted outreach with RAG | `src/actions/ai.ts` + `src/lib/ai/draft.ts` |
| Lead scoring cron | `src/trigger/inbound-sms.ts` → `scoreAllLeadsSchedule` (weekly Sunday 6am UTC, contacts-with-activity-in-last-30d only, concurrency 3) |
| Drag-drop deal kanban | `src/components/deals/kanban-board.tsx` |
| Activity timeline | `src/components/contacts/timeline.tsx` |
| Contact dedupe — `merge_contacts(winner, loser, org)` atomic | `src/db/migrations/0002_merge_contacts.sql` + `src/actions/merge-contacts.ts` |
| Soft-delete with Undo toast — Sonner-backed `undoable({...})` helper | `src/lib/undoable.ts` + `src/db/migrations/0003_soft_delete_contacts.sql` + `src/actions/contacts.ts` (`softDeleteContact` / `restoreContact`) |
| Idempotent migration runner + GH Actions auto-apply | `scripts/apply-pending-migrations.mjs` + `.github/workflows/migrate.yml` |
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
│   ├── ui/                           # shadcn primitives (sidebar, sheet, dropdown, bottom-sheet, ...)
│   ├── dashboard/                    # sidebar shell, brand, user footer, page-header, hot-leads
│   ├── contacts/                     # composer, timeline, AI actions, contact-list + content + content-mobile, edit-contact-sheet
│   ├── companies/                    # company-list + content + content-mobile (card grid)
│   ├── deals/                        # kanban, new-deal dialog (now BottomSheet)
│   ├── inbox/                        # sms composer
│   ├── calls/                        # recording player
│   └── settings/                     # phone number actions, etc.
├── actions/                          # server actions (contacts, companies, deals, ..., merge-contacts)
├── hooks/
│   └── use-mobile.tsx                # 768px breakpoint detector (used by shadcn Sidebar)
├── lib/
│   ├── auth.ts                       # Clerk → DB
│   ├── audit.ts                      # write to audit_log
│   ├── env.ts                        # zod-validated env
│   ├── navigation.ts                 # sidebar main + settings nav items, isNavItemActive()
│   ├── phone.ts                      # E.164 helpers
│   ├── undoable.ts                   # Sonner undo toast wrapper (perform + undo + Undo button)
│   ├── views.ts                      # Drizzle pgView type defs for contacts_summary + companies_summary
│   ├── twilio/                       # client, signature, TwiML, provisioning, storage
│   ├── ai/                           # Deepgram, Anthropic, embeddings, drafts, scoring
│   └── queue/enqueue.ts              # Trigger.dev dispatcher (with inline fallback)
├── db/
│   ├── schema.ts                     # Drizzle schema (incl. contact_emails + contact_phones tables)
│   ├── views.ts                      # pgView() for the summary views
│   ├── index.ts                      # pg + drizzle client
│   └── migrations/
│       ├── 0001_init.sql             # first migration (includes pgvector + Kavora org seed)
│       ├── 0002_merge_contacts.sql   # PL/pgSQL merge function (T1-2)
│       ├── 0003_soft_delete_contacts.sql  # deleted_at column + active-row partial index (T1-3)
│       ├── 0004_summary_views.sql    # contacts_summary + companies_summary views (T2-2)
│       └── 0005_contact_emails_phones.sql  # multi-value email/phone tables + backfill (T2-1)
├── scripts/
│   └── apply-pending-migrations.mjs  # idempotent migration runner (no drizzle-kit dependency)
├── trigger/                          # Trigger.dev task definitions
└── middleware.ts                     # Clerk auth middleware
docs/
├── SETUP.md                          # account provisioning + local dev
├── ARCHITECTURE.md                   # system design, data flow, decisions
├── AGENTS.md                         # conventions for future agents
├── research/atomic-crm/              # source-of-truth roadmap + borrow-from notes
│   └── apply-to-kavora.md            # 8-week Tier 1/2/3 plan (what's done, what's next)
└── reviews/                          # per-PR blind review reports
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
