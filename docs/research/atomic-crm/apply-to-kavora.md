# Apply Atomic CRM Learnings to Kavora v2

**Purpose:** Synthesize [`domain-model.md`](./domain-model.md) and [`technical-architecture.md`](./technical-architecture.md) into a prioritized v2 roadmap. Every recommendation links back to the source doc with `path:line` references and a short excerpt.

**Reading order:** skim this doc first to get the prioritization, then drill into the source docs when you actually implement.

---

## Prioritization rubric

For each candidate pattern, score on three axes (1–5 each):

| Axis | What it measures |
|---|---|
| **Customer demand** | Will Kavora's actual users care? Higher = real users asking for it. |
| **Implementation cost** | Weeks of work to ship a v1. **Lower number = cheaper.** (1 = trivial, 5 = major rebuild) |
| **AI leverage** | Does the pattern benefit from Kavora's AI differentiation (RAG, AI-drafted outreach, lead scoring)? Higher = more unique. |

**Total ≥ 12** → ship in v2 (within 8 weeks). **8–11** → backlog for v3. **< 8** → skip.

---

## Tier 1 — Quick wins (cheap + high impact)

### T1-1. Sidebar shell from shadcn/ui — verbatim copy
- **Source:** [`technical-architecture.md` §Sidebar](#) (the agent's "borrow verbatim" callout)
- **Score:** demand 4 / cost 1 (1–2 days) / AI leverage 1 → **total 6** but it's foundation for everything else
- **Why:** The `<Sidebar variant="floating" collapsible="icon">` from shadcn/ui gives cookie-persisted collapse, `Cmd/Ctrl+B` shortcut, mobile drawer — all stock. Kavora's current sidebar is custom and rough.
- **Effort:** **S** (~1 day)
- **Dependencies:** None — pure UI

### T1-2. `merge_contacts` dedupe function
- **Source:** [`domain-model.md` §13 What to Borrow](#) + the actual function at `supabase/schemas/02_functions.sql:276-426`
- **Score:** demand 5 (every CRM needs this) / cost 2 (port + tests) / AI leverage 4 (AI-suggested merges) → **total 11**
- **Why:** ~150 lines of PL/pgSQL that atomically reassigns tasks, deal `contact_id`s, and `contact_notes` while merging emails/phones/tags by key. Saves building from scratch AND fixes a class of bugs Kavora will hit within a month of usage.
- **Effort:** **S–M** (~3 days incl. tests)
- **Dependencies:** None — pure DB function + Server Action

### T1-3. Sonner + undoable-mutation pattern for soft deletes + bulk actions
- **Source:** [`technical-architecture.md` §11 Notifications](#)
- **Score:** demand 4 / cost 1 / AI leverage 1 → **total 6** but unlocks future bulk features
- **Why:** The "delete → toast with Undo" pattern is now table stakes for admin UX. Kavora has no soft-delete mechanism and no toast system. Building both unlocks future bulk-action features.
- **Effort:** **S** (~1 day)
- **Dependencies:** None — UI + Server Action

---

## Tier 2 — Substantive features (medium effort, high payoff)

### T2-1. `email_jsonb` / `phone_jsonb` typed multi-value fields
- **Source:** [`domain-model.md` §1 Entities](#) + `supabase/schemas/01_tables.sql` for the columns
- **Score:** demand 4 (every real CRM has multiple emails/phones per contact) / cost 2 (migration + UI rewrite) / AI leverage 4 (AI extracts structured email/phone arrays from transcripts) → **total 10**
- **Why:** Today's `phone varchar(32)` and `email text` are single-value. Real CRM needs `[{ email, type: "Work" | "Home" | "Other" }]` shape with types. Atomic CRM's `jsonb` approach is the cleanest — type-safe in TS, indexed for search.
- **Effort:** **M** (~1 week incl. migration of existing data)
- **Dependencies:** Decide on a migration strategy for the existing single-value columns

### T2-2. DB views for list screens
- **Source:** [`domain-model.md` §13 What to Borrow](#) + the actual views (`contacts_summary`, `companies_summary`, `activity_log`)
- **Score:** demand 3 (developer-only payoff, not user-visible) / cost 1 (just SQL) / AI leverage 3 (the views can include AI summaries inline) → **total 7** but it's a multiplier on every list page
- **Why:** Pre-computed joins in SQL = no N+1 in Drizzle. Every list page (`/contacts`, `/companies`, `/calls`, `/inbox`) gets faster for free. The `activity_log` UNION ALL view is the foundation for the contact timeline.
- **Effort:** **S–M** (~2–3 days)
- **Dependencies:** Should land alongside T1-1 sidebar so list pages re-render with the new shell

### T2-3. `<List>` + `<ListContent>` split with `useIsMobile()`
- **Source:** [`technical-architecture.md` §5 List Page Patterns](#)
- **Score:** demand 3 / cost 2 / AI leverage 2 → **total 7** but it sets the pattern for all future mobile UX
- **Why:** Single route serves both dense desktop table and mobile infinite-scroll without responsive CSS tricks. Kavora's current list pages are desktop-only with `md:hidden` workarounds.
- **Effort:** **M** (~1 week, refactor 4 list pages)
- **Dependencies:** Should land after T1-1 sidebar

### T2-4. Sheet `side="bottom"` for create/edit
- **Source:** [`technical-architecture.md` §10 Modal/Drawer/Sheet](#)
- **Score:** demand 4 / cost 1 / AI leverage 2 → **total 7** but it's the mobile-editing pattern every form will use
- **Why:** Mobile users can't easily use centered modals. Bottom sheet is the right mobile pattern. Atomic CRM uses sticky footer Save button — production-grade UX.
- **Effort:** **S–M** (~3 days, refactor new-contact/new-deal/new-company dialogs)
- **Dependencies:** None — pure UI primitives

### T2-5. `withLifecycleCallbacks` data-provider pattern for files + search
- **Source:** [`domain-model.md` §13 What to Borrow](#) + their data provider hooks
- **Score:** demand 3 / cost 3 / AI leverage 3 → **total 9**
- **Why:** The "before/after every mutation, run hooks" pattern is how they inject search indexing and file uploads. Kavora can use the same pattern to inject `logAudit()` and AI embedding into every mutation.
- **Effort:** **M–L** (~1 week incl. refactor of existing server actions)
- **Dependencies:** Should land alongside the audit log expansion

---

## Tier 3 — Big bets (high effort, transformative)

### T3-1. Real event-sourced `activity_log` table
- **Source:** [`domain-model.md` §15 Open Questions](#) (they noted this gap)
- **Score:** demand 5 (every AI-touchpoint needs to be queryable) / cost 4 / AI leverage 5 → **total 14**
- **Why:** Atomic CRM's `activity_log` is a SQL view that only captures creation events. Kavora needs Twilio-call, AI-summary, AI-draft, RAG-embed events — a real event store with `actor_type` ('contact', 'agent', 'ai', 'system'), `event_type`, `payload jsonb`, `occurred_at`. Without it, the contact timeline is incomplete.
- **Effort:** **L** (~2 weeks incl. migration + retroactive backfill)
- **Dependencies:** Blocks the AI-event timeline UI; unblocks AI-touch attribution analytics

### T3-2. Custom-fields framework (AI-suggested fields)
- **Source:** [`domain-model.md` §15](#) (they explicitly didn't build this)
- **Score:** demand 3 / cost 5 / AI leverage 5 → **total 13**
- **Why:** Atomic CRM skipped this. For Kavora's "AI suggests a field, user accepts" workflow (e.g., AI extracts `lead_source = 'Referral'` from a transcript and the user can add it to their schema), we need a runtime custom-field framework. This is the hardest pattern in the doc and likely the most differentiating.
- **Effort:** **XL** (~3 weeks for v1; can land as JSONB-only with no UI for first iteration)
- **Dependencies:** Depends on T3-1 activity_log

### T3-3. Workflow rules engine (EspoCRM pattern)
- **Source:** Skipped from atomic-crm (it's an EspoCRM feature); see [`domain-model.md` §14](#)
- **Score:** demand 4 / cost 5 / AI leverage 4 → **total 13**
- **Why:** When a deal moves to "won", send an email. When a contact goes cold, re-engage. Atomic CRM doesn't have this; EspoCRM does. Kavora could build it on Trigger.dev schedules + custom hooks.
- **Effort:** **XL** (~3 weeks; defer to v3 unless customer demand spikes)
- **Dependencies:** Should land after T3-1 and T3-2

---

## Recommended implementation order (8 weeks to v2)

| Week | Items | Cumulative impact |
|---|---|---|
| **W1** | T1-1 (sidebar shell) | Production-feeling admin shell |
| **W2** | T1-3 (Sonner + undo), T2-4 (bottom sheet) | Mobile-friendly forms |
| **W3** | T2-2 (DB views), T2-3 (`useIsMobile()` refactor) | Fast list pages, true mobile UX |
| **W4** | T1-2 (`merge_contacts`) | Data quality win, deduplication UX |
| **W5** | T2-1 (`email_jsonb` / `phone_jsonb` migration) | Real CRM-grade contact data |
| **W6** | T2-5 (`withLifecycleCallbacks` for audit + AI) | Cross-cutting observability + AI |
| **W7** | T3-1 (event-sourced activity_log) | AI-touchpoint analytics + timeline |
| **W8** | Buffer / docs / customer demos | Ship v2 |

---

## Backlog (v3, not v2)

- T3-2 (custom-fields framework) — needs T3-1 first
- T3-3 (workflow rules engine) — needs T3-1 + T3-2
- Email integration (IMAP/SMTP sync) — EspoCRM-style, defer
- Bulk operations at scale — depends on T2-5 lifecycle callbacks
- Multi-tenancy / Clerk orgs — strategic decision, defer

---

## Skip list (do not build)

| Pattern | Why skip |
|---|---|
| RLS model | Atomic CRM is wide-open per-authenticated. Kavora's `orgId` per row is already correct. |
| `ra-supabase-core` data provider | React-Admin-only. Kavora uses Server Actions + Drizzle. |
| Two separate `<DesktopAdmin>` + `<MobileAdmin>` components | Use `useIsMobile()` returning different trees instead (T2-3). |
| Custom fields via ALTER TABLE | That's literally what we're avoiding by building T3-2 properly. |
| Supabase Realtime | Neither Kavora nor atomic-crm uses it; pull after mutation is fine. |

---

## Provenance

Each pattern above links back to a section in either source doc. To implement:
1. Read the matching section in the source doc
2. Open the cited file in atomic-crm at `_research/atomic-crm/<path>` (or via the GitHub UI)
3. Port the pattern, substituting Kavora's stack conventions
4. Add tests + audit log entry per the `AGENTS.md` rules

Both source docs contain `path:line` references and 3–10 line code excerpts, so most porting can happen without cloning the repo.

---

## Bonus: glean from `frappe/crm` and `trycompai/crm`

After the atomic-crm review, two more OSS CRMs were skimmed (not full deep-dives). Each yielded 1–3 patterns worth knowing — none large enough to justify a full review, but worth recording.

### Frappe CRM ([github.com/frappe/crm](https://github.com/frappe/crm)) — Python/Vue

**Standout patterns:**
- **Custom Views** — saved filter/sort/column configurations per user. Implemented in `frontend/src/components/ViewControls.vue:529-561` and persisted server-side. Lets a sales rep save "My Q4 deals > $10k in late stages" and reload it across devices. **Score: demand 4 / cost 2 / AI leverage 1 → 7** (deferrable).
- **Domain Enrichment** — `crm/domain_enrichment/` auto-fills company data from a website URL (logo, industry, employee count). **Score: demand 3 / cost 2 / AI leverage 5 → 10** (a Claude-powered version would beat the heuristic ones they ship).
- **Assignment Rules** — `crm/api/assignment_rule.py` auto-routes new leads to reps by criteria (region, source, deal size). Useful when Kavora gets to team features. **Score: demand 3 / cost 2 / AI leverage 2 → 7** (deferrable).

**Skip:** Form Scripts (eval'd JS at runtime — security landmine), Python stack (different from ours), Frappe framework coupling.

### trycomp CRM ([github.com/trycompai/crm](https://github.com/trycompai/crm)) — TypeScript/Bun/eve

This one is **the most architecturally aligned with where Kavora should go long-term** — it's "agent-first, the CRM is where the agent keeps its notes."

**Standout patterns:**
- **Agent tab on every record** — `apps/app/components/crm/record-sheet/company-sheet.tsx:212` and `deal-sheet.tsx:164` mount `<AgentPanel>` as a tab. Shows the AI's work-in-progress, leads it discarded and why, and inline questions when it can't decide. **Score: demand 5 / cost 3 / AI leverage 5 → 13** (this is a tier-3 big bet — the single most differentiating AI feature across all four CRMs we reviewed).
- **Work-queue with `FOR UPDATE SKIP LOCKED`** — `apps/agent/agent/lib/tasks.ts` → `claimDue()`. Two dispatchers take disjoint rows; lease expires if a run dies. We get this for free with Trigger.dev schedules. **Skip (already have it).**
- **Sandbox with `deny-all` egress** — agent gets bash/grep + `/workspace` but no network and no `DATABASE_URL`. Defends against prompt injection exfiltrating customer data. **Score: demand 2 / cost 3 / AI leverage 4 → 9** (deferrable; only matters once we run user-driven AI features).
- **Skill files in markdown, versioned like code** — `apps/agent/agent/skills/*.md` — agent reads them like prompts. Cheap, durable, git-traceable. **Score: demand 2 / cost 1 / AI leverage 3 → 6** (could land alongside T3-1).
- **Settings → General for API keys** — store keys in a DB row the user can edit; the agent reads them per-session. Avoids redeploy-to-set-env. **Score: demand 2 / cost 2 / AI leverage 2 → 6** (deferrable).

**Skip:** eve framework coupling (their runtime), `eve`'s session durability (Trigger.dev covers this for us).

### Combined recommendation

- **Tier 3 add: T3-4 "Agent tab on every record"** — add to `apply-to-kavora.md` Tier 3 list (W7+ work, but the highest-leverage AI surface across all four CRMs).
- **Defer:** Custom Views, Domain Enrichment (Claude-powered version), Assignment Rules, Skill files, Settings-as-DB-row for keys — all backlog candidates for v3.
- **Skip:** Form Scripts (Frappe), eve framework (trycomp), FOR UPDATE SKIP LOCKED work-queue (we have Trigger.dev).

**The four-CRM survey is complete.** Atomic CRM gave us the bulk of the architecture patterns; trycomp gave us the AI surface; frappe gave us a few operational niceties. No more deep-dives warranted — we have enough input for v2 + a backlog for v3.

### Stop here on research

Three full reviews + two glances = ~6 hours of focused code-reading. Diminishing returns at this point. The next hour spent implementing T1-1 (sidebar shell) returns more v2 value than another repo skim. Recommend: stop researching, start building.
