# Atomic CRM Research — Kavora v2 input

**Repo:** https://github.com/marmelab/atomic-crm
**Stack reviewed:** React + Vite + Supabase + react-admin (shadcn-admin-kit / ra-core)
**Reviewed:** 2026-09-23
**Purpose:** Cherry-pick patterns for Kavora CRM v2. Kavora is an AI-native CRM (Next.js 15 + App Router + Drizzle + Tailwind + shadcn/ui + Clerk + Twilio + Trigger.dev + Claude/Voyage/Deepgram), so the goal is to learn from atomic-crm's domain + UX choices without adopting its framework.

---

## Documents in this folder

| File | Lines | What it covers |
|---|---|---|
| [`domain-model.md`](./domain-model.md) | 972 | Entities, schema, relationships, business logic, validation, permissions. ~90 `path:line` references. |
| [`technical-architecture.md`](./technical-architecture.md) | 1070 | Stack, build/tooling, data fetching, routing, list/detail/form patterns, drag-drop, auth, testing. ~83 `path:line` references. |
| [`apply-to-kavora.md`](./apply-to-kavora.md) | TBD | Synthesized prioritized recommendations for Kavora v2, scored on customer demand / implementation cost / AI leverage. |

---

## How to use these docs

The two review docs are structured so you can read them without cloning atomic-crm:

- Every finding cites `path/to/file.ext:LINE` and a short code excerpt (3–10 lines).
- Each major section has its own "What to borrow / skip" verdict where relevant.
- The final sections (`What to Borrow for Kavora` and `What to Skip`) in each doc aggregate the recommendations.

If you're about to implement a v2 feature, **start by checking the relevant section in both docs** before writing code — chances are good that atomic-crm already solved (or deliberately didn't solve) the same problem.

---

## TL;DR — top patterns worth borrowing for Kavora

### From the domain-model review
- **`merge_contacts` PL/pgSQL function** (`supabase/schemas/02_functions.sql:276-426`) — atomic dedupe that reassigns tasks/deals/notes while merging emails/phones/tags by key. Saves building it from scratch.
- **Flat `tags bigint[]` array on contacts** — cheap, no join table, perfect for AI enrichment.
- **`jsonb` shape for typed multi-value fields** (`email_jsonb`, `phone_jsonb`) — `[{ email, type: "Work" | "Home" }]` matches every real CRM.
- **DB views for list screens** (`contacts_summary`, `companies_summary`, `activity_log`) — pre-computed joins, fast list queries without N+1.
- **Hybrid settings-as-code + settings-as-DB-row** — typed seeds for sectors/stages/categories, runtime-editable in a JSONB singleton.

### From the technical-architecture review
- **`<List>` + `<ListContent>` split with `useIsMobile()` returning different render trees** — single route serves dense desktop table AND optimized mobile infinite-scroll without responsive CSS tricks.
- **`Sheet side="bottom"` create/edit pattern with sticky footer Save** — production-grade mobile editing UX.
- **Sonner toasts with `undoable-mutation` pattern** — soft-deletes, bulk actions, and accidental deletes get one-click undo.
- **`<Sidebar variant="floating" collapsible="icon">`** — copy verbatim from shadcn/ui; cookie-persisted, `Cmd/Ctrl+B` shortcut, mobile drawer, all stock shadcn.
- **`withLifecycleCallbacks` data-provider pattern** — file uploads, search injection, sales-id defaults hook into the data layer cleanly.

## TL;DR — top patterns to deliberately skip

- **RLS model** — atomic-crm is wide-open per-authenticated, no row-level tenancy. Doesn't fit Kavora's `orgId`-per-row architecture.
- **`ra-supabase-core` data provider** — tightly coupled to Supabase + react-admin. Kavora uses Drizzle + Server Actions, so we reimplement the patterns instead.
- **Two separate `<DesktopAdmin>` and `<MobileAdmin>` components** — atomic-crm does this for React-Admin reasons; Kavora should use the `useIsMobile()` return-different-tree pattern instead.
- **No custom-fields framework** — atomic-crm explicitly skipped this (ALTER TABLE per field). Kavora's AI-suggests-field workflow needs to build this ourselves.

---

## Notable surprises (read these before assuming)

1. **No runtime custom fields.** Atomic CRM assumes fields are baked into the schema. See `doc/src/content/docs/developers/custom-fields.mdx` — they lean into it deliberately. For Kavora's "AI suggests a field, user accepts" workflow, this is a feature we have to build.
2. **`activity_log` is a SQL view (UNION ALL over 5 tables), not an event store.** Atomic CRM treats "creation" as the only meaningful event. Kavora's Twilio-call + AI-touch timeline needs a real event-sourcing table.
3. **No Supabase Realtime usage** — purely pull-based after mutations. We don't need Realtime for v2 either; pull after mutation is enough for a single-tenant CRM.
4. **Zod is declared but never used at the UI layer** — validation lives in react-hook-form validators. Kavora should adopt Zod on the **server action** boundary (per our `AGENTS.md` rule) but keep RHF validators on forms.
5. **Many "atomic-crm components" are actually Marmelab's paid `shadcn-admin-kit`** exposed via `@/components/admin/*`. We can use the stock shadcn primitives directly without their wrapper layer.

---

## Open questions deferred to v2 design phase

These came up during the review and need follow-up before implementing:

- **Multi-tenancy** — Kavora's `orgId` per row works fine for single-tenant, but if we ever go multi-tenant, do we add Clerk orgs or keep one Kavora org per customer?
- **Drag-reorder batching with Drizzle** — atomic-crm uses `@hello-pangea/dnd` to reorder stages; we need to map that to Drizzle batch updates + transactional integrity.
- **RSC data-fetching boundary** — atomic-crm is client-side fetching through react-admin; Kavora uses Next.js Server Components for read paths and Server Actions for writes. Where exactly does the data provider abstraction live in RSC?
- **Paid vs OSS shadcn-admin-kit components** — the wrapper layer is paid; we'd need to either pay or reimplement the wrappers around stock shadcn primitives.
- **Supabase Realtime** — neither Kavora nor atomic-crm uses it currently. Worth re-evaluating for the live "another agent is editing this record" UX when team features land.

---

## Provenance

Both review docs were generated by parallel worker subagents with read-only access to a fresh clone of atomic-crm at `/Users/lionel/.minimax/sessions/.../_research/atomic-crm/`. No files in that clone were modified. The output docs in this folder are the only artifacts — they can be re-generated from scratch by running the same prompts against a fresh clone.
