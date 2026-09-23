# Phase 5 review — Lead scoring + polish

Scope: weekly lead-scoring cron, hot-leads widget, analytics dashboard,
README/SETUP/ARCHITECTURE/AGENTS docs, CI workflow.

---

## ponytail

Lean spots the lean-sniffer should remove (no behaviour change):

1. `src/lib/ai/score-lead.ts:33-38` — the `summaries` query with `limit(0)` is a stub
   that explicitly says "populated via join in real impl; kept minimal here". The
   variable is `void`-discarded. It contributes nothing. **Delete the whole
   6-line block** (`const summaries = …; void summaries;`). The plan's lead-scoring
   rubric needs `aiSummaries`, so this isn't just dead code — it's an unfinished
   Phase 5 commitment. Either wire the join or drop the dead placeholder.
2. `src/trigger/inbound-sms.ts:13, 87-88` — `leadScores` is imported only to be
   `void`-discarded in a comment that says "keep `leadScores` reference alive for
   bundler / future use". No bundler needs this; Drizzle table exports have no
   side-effects. **Delete the import + the comment + the `void` line.** (-3 lines.)
3. `src/app/(dashboard)/dashboard/page.tsx:43` — `orderBy(leadScores.score)` with
   no direction is functionally a bug (see Standards / Spec), but if the fix is
   `.desc()` there's no line to delete. The hot-leads widget title link text
   "View contact →" is rendered five times — duplicating UI rather than mapping
   over names. Pulling a real name is a net add, not a delete.
4. `src/app/(dashboard)/analytics/page.tsx:75` — the description still says
   "AI cost dashboard coming in Phase 5". We *are* Phase 5; the tile was never
   built. Either ship the tile or shorten the description to "Last 30 days.".

net: -9 lines possible (score-lead stub 6, trigger dead-ref 3). Plus a few
behavioural deletes (the `// keep alive` comment is the worst kind of cargo cult).

---

## Standards

(against `docs/AGENTS.md` + general code health)

- **Auth boundary.** `scoreContact()` reads `contacts` by id only, with no
  `eq(contacts.orgId, KAVORA_ORG_ID)` filter. AGENTS says "Never read/write DB
  without auth"; `scoreContact` is server-only and gated by RLS in permissive
  mode, but a defence-in-depth `orgId` predicate would match the rest of the
  codebase (analytics, dashboard, activities all do it).
- **Env hygiene.** AGENTS says "only access via `import { env } from "@/lib/env"`.
  Never read `process.env.*` directly". `trigger.config.ts:4` does exactly that
  (`process.env.TRIGGER_PROJECT_ID ?? "proj_replace_me"`). Acceptable in the
  build config (it can't import app env cleanly) but should be noted as the one
  intentional exception.
- **AI provider optionality.** AGENTS: "All providers must be optional at boot
  (graceful no-op when key is missing)." `scoreContact` does this correctly via
  the early `if (!anthropicConfigured) return null;` guard. ✓
- **Money / units.** `analytics/page.tsx` correctly converts `valueCents` via
  `/100` and uses `Intl.NumberFormat`. ✓
- **Cron registration.** `scoreAllLeadsSchedule = schedules.task({ cron: "0 6 * * 0", … })`
  matches the Trigger.dev v3 API (uses `schedules.task`, not `task({ cron })`).
  ✓
- **CI env.** `.github/workflows/ci.yml` supplies dummy Clerk + DATABASE_URL
  values to keep `pnpm build` alive; matches SETUP/AGENTS guidance. ✓
- **Type safety.** `score-lead.ts` parses LLM output with `JSON.parse` and an
  unchecked cast to `{ score: number; rationale: string }`. If the model returns
  a non-numeric score, `Math.round(parsed.score)` produces `NaN`, which gets
  inserted. Worth a `Number.isFinite()` guard or a zod parse. Minor.

---

## Spec

(against "Phase 5", "Lead scoring (weekly cron)", "AI Features → Lead scoring",
and the "Acceptance for AI showcase" sections of the plan)

**Lead scoring rubric (plan §AI Features → Lead scoring):**
- Weekly cron ✓ (`schedules.task({ cron: "0 6 * * 0" })`).
- "Pulls contacts with activity in the last 30 days" ✗ — implementation iterates
  *all* contacts in the org (`src/trigger/inbound-sms.ts:77`), with no recency
  filter on `contacts`. Plan says "contacts with activity in the last 30 days".
- "For each, sends a rubric prompt to Claude with **activity summaries** +
  demographic data → score 0-100 + rationale" — partially: activities are
  included, but `ai_summaries` are not (the `summaries` query in `score-lead.ts`
  is an empty stub, see ponytail §1). Demographic data is sparse (only firstName,
  lastName, status, profileNotes).
- "Stores in `lead_scores` with timestamp" ✓ (scoredAt defaultNow()).
- "Surfaces a 'Hot leads' widget on the dashboard" ✓ — but see below.

**"Hot leads" widget (Acceptance for AI showcase):**
> "Lead score widget on dashboard updates after the weekly cron runs and
> explains the rationale on hover."

- "Updates after the weekly cron" — partially. The widget selects every row in
  `lead_scores` for the org and orders by `leadScores.score` **ascending** with
  `limit(5)`. That surfaces the 5 *coldest* leads as "Hot leads". Bug:
  `orderBy` is missing `.desc()`. (`src/app/(dashboard)/dashboard/page.tsx:43`.)
- "Explains the rationale on hover" — the rationale is shown as plain body text
  under each lead (not a tooltip on hover). Meets the spirit (rationale visible),
  fails the letter (always visible, not on hover). The `Badge` "warning" variant
  doesn't change with score; a 30 and a 90 look identical. UX should bucket
  score (cold < 50 < warm < 75 < hot) and put the rationale behind a `<details>`
  or Radix tooltip, not always-on.
- **Contact identity missing.** The widget renders five "View contact →" links
  with no contact name. Users can't tell who the hot lead is without clicking
  through. Need to join `contacts` (first/last name) or denormalise the name
  into `lead_scores` at insert. This is a real gap for the acceptance demo.

**Analytics page (plan §UI/Route Map):**
- `/analytics` shows call volume, win rate, won value ✓. "Avg deal size" is not
  shown; "AI cost" is not shown (description admits "coming in Phase 5" but
  we're Phase 5). The deals aggregation has no 30-day window while calls/SMS
  do — inconsistent window makes win rate misleading.

**Docs coherence:**
- README "What's in the box" row "Lead scoring cron" references
  `scoreAllLeadsTask`. Actual exported name in `src/trigger/inbound-sms.ts:73`
  is `scoreAllLeadsSchedule`. Name mismatch.
- README "Acceptance criteria → AI showcase" says only "Lead score widget on
  dashboard updates after the weekly cron". The plan's full acceptance line
  is "updates after the weekly cron runs and explains the rationale on hover" —
  README truncated the rationale half.
- ARCHITECTURE.md "End-to-end flows G" matches the plan's "activity in the
  last 30 days" wording — the code does *not* match this; ARCHITECTURE drifts
  from the implementation.
- AGENTS.md: accurate. ✓

**Read-only check:** all four docs and CI workflow are coherent *as documents*;
the inconsistencies above are drift from the code, not contradictions among
docs themselves.

---

## Summary

Five things to fix, ranked:

1. **Hot-leads widget order is inverted.** `orderBy(leadScores.score)` without
   `.desc()` returns the five *coldest* contacts. Show the hottest. File:
   `src/app/(dashboard)/dashboard/page.tsx:43`. (Functionally wrong; breaks the
   AI-showcase demo.)
2. **Cron iterates every contact weekly, not "activity in last 30 days" as the
   plan specifies.** Add a recency filter on `contacts` (or join via
   `activities`) before scoring. File: `src/trigger/inbound-sms.ts:77-83`.
   Also: serial `for` loop with no concurrency cap — batch with `allSettled`
   or at least `Promise.all` with a sensible chunk size.
3. **Widget renders no contact name, only "View contact →".** Join `contacts`
   or denormalise first/last name into `lead_scores` at insert so the widget
   shows "Jane Doe · 87". Without this the widget fails the acceptance demo.
   Also: rationale is always-on text, not hover-tooltip — wrap in a Radix
   `<Tooltip>` and bucket the score badge by cold/warm/hot.
4. **`score-lead.ts` has a 6-line stub for `aiSummaries` (`limit(0)`) that
   contributes nothing.** Either wire the join into the prompt (the plan says
   "activity summaries" are a key signal) or delete it. Same file: harden the
   LLM JSON parse with a zod schema or `Number.isFinite` guard so a hallucinated
   non-numeric score doesn't write `NaN` into the DB.
5. **Doc drift.** Rename the README reference from `scoreAllLeadsTask` →
   `scoreAllLeadsSchedule`; restore the full acceptance line ("…and explains
   the rationale on hover"); update ARCHITECTURE.md to match whatever the
   cron actually does (recency-filtered or not); fix the analytics page
   description ("AI cost dashboard coming in Phase 5" → we are Phase 5).

Honourable mention: `src/trigger/inbound-sms.ts:13,87-88` (`void leadScores;`
"keep reference alive for bundler") — delete the import and the comment. The
least useful four lines in Phase 5.