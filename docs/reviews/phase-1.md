# Phase 1 — Vanilla CRM review

## ponytail

src/actions/contacts.ts:161: delete: `void KAVORA_ORG_ID;` — unused-import suppression. Drop the import.
src/actions/companies.ts:102: delete: same pattern.
src/actions/deals.ts:198: delete: same pattern.
src/actions/notes.ts:77: delete: same pattern.
src/actions/contacts.ts:23-51: delete: `listContacts({q,status,limit})` is never called with `q` or `status` — `contacts/page.tsx:13-18` hard-codes `.limit(200)`. Either wire a search/filter UI to it (plan calls for it) or strip the dead params and inline the list.
src/actions/companies.ts:18-32: delete: same dead `q` / `limit` params; `companies/page.tsx` does its own select.
src/actions/deals.ts:41-49: delete: `getDeal` is exported but `deals/[id]/page.tsx:21-37` re-implements the query inline. Either call the action or drop it. Same logic applies to `getContact` / `getCompany` (unused by any page in this slice).
src/components/contacts/contact-actions.tsx:5,22-24: delete: `startOutboundCall` button (Phase 2, Twilio working number) on a Phase 1 contact page. Outbound call placement is Day 7-10, not Day 3-6.
src/components/contacts/contact-actions.tsx:36-38: delete: `<MoreVertical>` ghost icon button with no `onClick`. Pure decoration.
src/app/(dashboard)/dashboard/page.tsx:5-12, 26-45, 60-61: delete: dashboard imports + queries `calls` / `smsMessages` / `leadScores`. Tiles "Calls (7d)" and "SMS (7d)" + the "Hot leads" card render Phase 2/3/5 data the Phase 1 acceptance does not require.
src/app/(dashboard)/dashboard/page.tsx:30-45: shrink: each "count" fires `select({id}).from(t)…` and reads `.length`. Use `COUNT(*)` — five full table scans per dashboard render is wrong for the "filters/search <500 ms on 10k contacts" target, even before telephony ships.
src/app/(dashboard)/contacts/[id]/page.tsx:21, 153-184: delete: `SmsComposer` import + SMS tab content. Phase 2 surface on a Phase 1 page.
src/app/(dashboard)/contacts/[id]/page.tsx:24, 109-131: delete: `DraftOutreachButton` (Phase 4) plus the "Recent drafts" panel — Phase 4 surface on a Phase 1 page.
src/app/(dashboard)/contacts/[id]/page.tsx:39-78: shrink: the seven-query Promise.all + two follow-up queries can collapse: pull `activities` joined to `calls` / `sms_messages` via `ref_id`, drop the redundant `aiSummaries` lookup (see Standards F2).
src/app/(dashboard)/contacts/[id]/page.tsx:72-78: see Standards F2 — the lookup is wrong; before fixing, decide whether the work belongs in Phase 1 at all.
net: -120 lines possible.

## Standards

Mutating actions are well-shaped: every one starts with `await requireDbUser()`; `phone` is normalised through `toE164` at `actions/contacts.ts:75,123`; money stays `valueCents` + `currency` (`actions/deals.ts:24`, rendered correctly in `contacts/[id]/page.tsx:208` and `kanban-board.tsx:84`); every create/update/delete ends with `logAudit(...)` (`actions/contacts.ts:94-101, 133-139, 150-156`, `actions/companies.ts:66-72`, `actions/deals.ts:109-115, 158-165`, `actions/notes.ts:64-70`). `revalidatePath` is called on the affected routes. AGENTS.md's "audit every mutation" and "phone always E.164" rules are met.

Standards breaches:

- `void KAVORA_ORG_ID;` at the bottom of all four action files is a Mysterious Name smell — the import looks load-bearing but isn't. Delete it and the import.
- `app/(dashboard)/contacts/[id]/page.tsx:72-78` and `components/contacts/timeline.tsx:49` look up `aiSummaries` by `call.id` / `sms.id`, but `aiSummaries.activity_id` is FK to `activities.id` (schema `db/schema.ts:485-487`). Today this returns zero rows in 99% of cases, so the timeline's "AI summary" panel never renders. Either join `activities` first and use `activities.ref_id`, or denormalise `activityId` on `calls` / `smsMessages`.
- `components/contacts/new-contact-button.tsx:74-86`: `<Label htmlFor="source">Source</Label>` is wired to `<Select name="status">`. The label says "Source", the field name is `status`, and `htmlFor="source"` doesn't bind to any element (the underlying Select renders a trigger button, not an input with `id="source"`). The schema's `source: text` field (`db/schema.ts:160`) is silently dropped from every newly created contact, and the dialog has no `companyId` picker either.
- All dashboard / list / detail pages bypass `requireDbUser()` and filter by the `KAVORA_ORG_ID` constant directly (`dashboard/page.tsx:21, 25, 29, 33, 42`, `contacts/page.tsx:16`, `contacts/[id]/page.tsx:34, 43, 49, 55, 61, 67`, `companies/page.tsx:23`, `companies/[id]/page.tsx:20, 28`, `deals/page.tsx:14, 29, 46`, `deals/[id]/page.tsx:36, 44`). AGENTS.md only mandates `requireDbUser()` on mutations, so reads in pages are legal — but mixing the org-id source (constant vs auth-derived) is the inconsistency that bites the future multi-tenant flip.
- `dashboard/page.tsx:43`: `leadScores.score` ordered ascending with no `desc` and a `limit 5` + a card labelled "Hot leads" rendered with `<Badge variant="warning">`. The 5 returned rows are the *lowest* scoring leads. Either flip to `desc` or remove the tile (see Spec).
- `actions/contacts.ts:158`: `redirect("/contacts")` inside `deleteContact` works in Next 15 server actions but is the only action that redirects from a mutation; others rely on `revalidatePath` + `router.refresh()`. Pick one pattern.
- `timeline.tsx:39`: `kind: a.type as "note" | "stage-change" | "email" | "meeting"` — the cast trusts the enum to be a narrowing subset of the icon switch, but `activity_type` also includes `"call"` and `"sms"` (`db/schema.ts:61-68`). Those two types fall through to `FileText` silently. Use a switch with an exhaustiveness check.

## Spec

Phase 1 acceptance ("**create a contact → link to company → create a deal → drag stages → log a note → see in timeline**") is wired end-to-end on the happy path: `actions/contacts.ts:createContact` → `actions/companies.ts:createCompany` → `actions/deals.ts:createDeal` → `kanban-board.tsx:onDragEnd` → `actions/deals.ts:moveDealStage` → `kanban-board.tsx` re-renders; `actions/notes.ts:createNote` inserts a paired `activities` row (`:55-62`) which `timeline.tsx:38-43` renders. Good.

Acceptance breaches:

- **"Filters and search return expected results in <500 ms on 10k contacts"** — unmet. `contacts/page.tsx` has a hardcoded `.limit(200)` and no search/filter UI. `listContacts({q,status})` is a dead branch (see ponytail). The Phase 1 plan row "Tags, filters, search (Postgres full-text on contacts)" is not started.
- **Phase 1 surface creep into later phases.** The dashboard tiles "Calls (7d)" (`page.tsx:61`) and "SMS (7d)" (`:62`) read from `calls` / `smsMessages` — neither table will have rows before Phase 2 (Twilio working number, Day 7-10). The "Hot leads" card (`:96-121`) reads `lead_scores` (Phase 5, Day 18-20). `contacts/[id]/page.tsx:21,24` import `SmsComposer` (Phase 2) and `DraftOutreachButton` (Phase 4). `contact-actions.tsx:5,22-24` mounts an outbound-Call button via `startOutboundCall` (Phase 2). None of these ship before Day 10 at earliest; the dashboard will render either zeros or NULLs throughout Phase 1 acceptance.
- `dashboard/page.tsx:43` orders `lead_scores.score` ascending, then labels the result "Hot leads" — behaviour is the inverse of the intent. Even when the Phase 5 cron lands, this needs `desc`. For Phase 1 the whole card should be removed.
- `new-contact-button.tsx:74-86` label/field mismatch and missing `source` + `companyId` — described in Standards.
- `timeline.tsx` + `contacts/[id]/page.tsx` `aiSummaries` lookup is FK-incorrect — described in Standards. Phase 1 still benefits from fixing because the timeline currently promises an AI summary panel it cannot deliver.
- Plan calls for `/settings/team` invites in Phase 1; not in this slice.
- Plan calls for per-contact timeline, which is delivered; the "polymorphic timeline" requirement on the schema is met.

## Summary

1. **Strip the Phase 2/3/4/5 surfaces out of Phase 1.** Dashboard tiles for `calls` / `smsMessages` / `leadScores`, the `SmsComposer` tab on `contacts/[id]`, the `DraftOutreachButton` panel, the outbound-Call button in `contact-actions.tsx`. Phase 1 acceptance is a vanilla CRM; everything listed here is wired to tables/components that won't exist for another 4-17 days of build time.
2. **Fix the `aiSummaries` FK lookup.** `aiSummaries.activity_id` references `activities.id`, but `timeline.tsx:49` and `contacts/[id]/page.tsx:72-78` look up by `call.id` / `sms.id`. The fix is either (a) join through `activities.ref_id` or (b) denormalise `activityId` onto `calls` / `smsMessages`. Today AI summaries silently never render on call/SMS items.
3. **Build the `/contacts` search/filter UI the plan already specifies.** `listContacts({q, status})` exists but no page calls it. Either wire a search input + status filter or delete the dead params.
4. **Fix `new-contact-button.tsx:74-86`** — the label says "Source", the field is `status`, and the schema's `source` text field is missing from the form (so every newly created contact has `source = null`). Also: add a `companyId` picker.
5. **Resolve the auth-org-id inconsistency.** Mutating actions use `ctx.orgId`; reads hardcode `KAVORA_ORG_ID`; the trailing `void KAVORA_ORG_ID;` lines exist to hide the unused import. Pick one source-of-truth before Phase 0 → production, and delete the `void` no-ops while you're there.
