# Phase A · Reviewer 2 — Clerk Organizations Integration Review

**Scope:** Clerk webhook (org + membership events), `<OrganizationSwitcher />` in the dashboard sidebar, zero-orgs empty state, integration + render tests for both.

**Verdict:** **FAIL → FIXED → PASS** (after un-skipping and fixing the previously-skipped render test).

---

## Per-commit verdict

| Commit  | Verdict | Notes |
| ------- | ------- | ----- |
| `a977605` feat(webhooks): handle Clerk organization.created/updated/deleted | **PASS** | Webhook routes all 5 new event types through thin `clerk-orgs.ts` helpers. Signature verification untouched (`svix` + `CLERK_WEBHOOK_SECRET`). 200/401/500 return codes preserved. `KAVORA_ORG_ID` is only used as a fallback inside `attachMembership` when `organization.id` is missing, and emits a console warning instead of throwing. `slug` is intentionally dropped — the `organizations` table doesn't have a `slug` column yet, and the inline doc-comment flags the future-extension path. |
| `a0af03a` feat(webhooks): handle Clerk organizationMembership.created/deleted | **PASS** | `attachMembership` updates `users.orgId` and audits `user.joined_org`; `detachMembership` clears `users.orgId` only when the row currently points at the leaving org (scoped UPDATE), and audits `user.left_org`. Both helpers log a warning and skip when the user/org id is missing instead of throwing — safer for a webhook redelivery. |
| `4127ea7` feat(dashboard): `<OrganizationSwitcher />` in sidebar with zero-orgs empty state | **PASS** | `<SidebarEmptyOrg />` renders inside `<SidebarBrand />` (top of sidebar, directly below the brand Link). The thin `<OrganizationSwitcher />` wrapper at `src/components/ui/organization-switcher.tsx` locks in `hidePersonal`, `afterSelectOrganizationUrl="/dashboard"`, `organizationProfileMode="modal"` per spec §1.3.3. Clerk's Radix-based primitive handles keyboard focus + Escape/Enter/arrow keys; the fallback `<Link>` is styled with sidebar tokens and has `focus-visible:ring-2 focus-visible:ring-sidebar-ring` so it's keyboard-focusable too. |
| `6ffb2a3` test(webhooks): integration tests for Clerk organization events | **PASS** | 5 tests: synthetic Svix-signed payloads for `organization.created`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.deleted`, plus unsigned-payload → 401. Mocks `@/lib/clerk-orgs` so the tests target only the route's dispatch logic, which is exactly what we want. |
| `177c537` test(ui): render test for organization switcher empty-state | **PASS** | First test verifies the zero-memberships branch renders the create-or-join `<Link>` with correct href/target, and that `<OrganizationSwitcher />` was NOT called. Second test (initially skipped — see "Fixes applied" below) verifies the memberships-present branch. |
| `a55041a` extend vitest config + add test deps + fix render test mock | **PASS** | Adds `happy-dom`, `@testing-library/react`, `@testing-library/jest-dom` and reconfigures vitest. Good. |

---

## Fixes applied (commit SHAs)

| SHA | Subject |
| --- | --- |
| `bba2cab` | test(ui): un-skip memberships-present render test + add cleanup hook |

**Root cause of the skipped test:** it had nothing to do with ClerkProvider context, `useOrganizationList()` return shape, or `.userMemberships.count` vs `.data?.length` (the TODO speculated about all three). The real cause was simpler: **vitest does not auto-cleanup rendered React components between tests, but Jest does.** With `@testing-library/react` mounted on vitest, the first test's `<a>` link leaked into the second test's DOM. The component was actually rendering the mocked `<OrganizationSwitcher />` correctly — `document.body.innerHTML` showed the `<div data-testid="clerk-switcher">` right next to the stale `<a>` from the previous test. The `queryByRole("link", { name: /create or join…/ })` assertion failed because the stale `<a>` was still in the document.

**Fix:** import `cleanup` from `@testing-library/react` and call it in `afterEach`. Un-skip the test. Verified:
- Before fix: 1 failed, 1 passed (the failing assertion was the stale-link assertion, not the switcher-call assertion).
- After fix: 2 passed, 0 failed.
- `pnpm test tests/integration/clerk-webhook.test.ts tests/components/organization-switcher.test.tsx` → **7 passed, 0 skipped**.

---

## Spec-conformance spot checks

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| Webhook handles all 5 event types | ✓ | `src/app/api/webhooks/clerk/route.ts:88-101` — switch case covers `organization.{created,updated,deleted}` and `organizationMembership.{created,updated,deleted}`. |
| Idempotent on Svix redelivery | ✓ | Upserts use `onConflictDoUpdate`; `detachMembership` uses scoped `UPDATE … WHERE users.id = ? AND users.orgId = ?`; `deleteOrganization` is naturally idempotent. |
| `KAVORA_ORG_ID` fallback only when `organization.id` missing, logs warning | ✓ | `src/lib/clerk-orgs.ts:79-82` — `console.warn` and never throws. |
| Signature verification unchanged (`svix` + `CLERK_WEBHOOK_SECRET`) | ✓ | `route.ts:32-57` — same `Webhook.verify` flow as the pre-existing user-created branch. |
| Returns 200 / 401 / 500 correctly | ✓ | `route.ts:35` (500 missing secret), `:42` (400 missing headers), `:56` (401 bad signature), `:105` (200), `:108` (500 DB error). |
| `<OrganizationSwitcher />` keyboard-accessible | ✓ | Wrapper passes through to Clerk's Radix Popover primitive (built-in focus, Escape, Enter, arrow keys). Fallback `<Link>` has `focus-visible:ring-2` so the empty-state chrome is also focusable. |
| Zero-orgs empty state styled with dropdown-menu tokens | ✓ | `sidebar-empty-org.tsx:47-51` — tokens match the sidebar accent / ring vocabulary. |
| Layout does NOT redirect-loop when `currentOrgId()` returns null | ✓ | `src/app/(dashboard)/layout.tsx` only redirects on missing `userId`, never on missing org. `<SidebarEmptyOrg />` renders the fallback chrome instead. |
| Single source of truth for active org | ✓ | Component uses Clerk's `useOrganization` + `useOrganizationList` on the client, and the route imports from `@/lib/clerk-orgs` on the server. No competing state. |
| Middleware still calls `auth()` server-side | ✓ | `src/middleware.ts` untouched — still uses `clerkMiddleware` + `auth.protect()`. |
| Integration tests: 5 tests with Svix-signed payloads + 401 | ✓ | `tests/integration/clerk-webhook.test.ts` — 4 signed event tests + 1 unsigned → 401. All pass. |
| Render tests: zero-memberships fallback + memberships-present switcher | ✓ | `tests/components/organization-switcher.test.tsx` — both tests pass after my fix. |

---

## Cross-scope issues (flag for parent / other reviewers)

1. **Webhook will be RLS-blocked once `DATABASE_APP_ROLE` is set.** This is the most important cross-scope finding. The webhook route imports `db` from `@/db` (`src/app/api/webhooks/clerk/route.ts:4` and `src/lib/clerk-orgs.ts:18`). The migration `0007_enable_rls.sql` enables RLS on the `users` table (which Builder 3 confirmed is in the 18-table list — see `tests/phase-a-review-3.md`). With `DATABASE_APP_ROLE=app_user` set (per `.env.example:10`), the Drizzle pool connects as that non-superuser role and the webhook's `db.update(users).set({ orgId }).where(eq(users.id, userId))` will be silently blocked by the `WITH CHECK (org_id = public.current_org_id())` policy because the webhook has no Clerk session and `current_org_id()` returns `NULL`.
   - **Why Builder 2 didn't catch it:** the spec's §1.5.2 (`adminDb` design) says "Application code (route handlers, server actions, queue workers, trigger.dev jobs) **must only import `db`**" — so Builder 2 correctly used `db`. But §1.5.2 also says `adminDb` is "exported so `scripts/apply-pending-migrations.mjs` can import it for RLS-escaping migrations." The webhook is a route handler, not a migration. There is no escape hatch in the current `src/db/index.ts` for the webhook to bypass RLS.
   - **Why `0007_enable_rls.sql` adds a comment about it but no escape hatch:** the migration's "Out of scope" section (line 41-43) says "Webhook runs through the migration-time admin pool." But the admin pool (`adminDb`) is not exported from `src/db/index.ts` — `git grep adminDb src/` returns zero hits. So this is a documentation/implementation gap, not a real escape hatch.
   - **Recommended fix (cross-scope, for Reviewer 4 or the parent):** either (a) export `adminDb` from `src/db/index.ts` and switch the webhook's `db` import to `adminDb`, OR (b) the spec needs to be revised to allow webhook code to bypass RLS via `SET LOCAL role NONE` + `SET LOCAL row_security = off` inside a transaction. Option (a) is cleaner and matches the existing `adminDb` naming convention.
   - **Severity:** P1 — the webhook will work locally (RLS off, dev mode superuser) but break in any production environment where `DATABASE_APP_ROLE` is set, which is the explicit goal of Phase A.

2. **`slug` is dropped from the `organizations` upsert.** The schema's `organizations` table doesn't have a `slug` column yet (confirmed at `src/db/schema.ts:82-92`). Builder 2 documented this as a future-extension path in `clerk-orgs.ts:39`. Not a Phase A blocker, but worth a follow-up migration so the Clerk dashboard URL (e.g. `https://accounts.kavora.systems/{slug}`) can be reconstructed from the local row.

3. **`detachMembership` audit log uses `orgId ?? KAVORA_ORG_ID`** at `src/lib/clerk-orgs.ts:114`. The function already early-returns when `orgId` is missing (line 106), so by the time we reach the audit insert, `orgId` is guaranteed non-null — the `?? KAVORA_ORG_ID` is dead code and slightly misleading. Cosmetic; would simplify to just `orgId`.

---

## Validation run

```
pnpm typecheck                                 → clean
pnpm test tests/integration/clerk-webhook.test.ts \
          tests/components/organization-switcher.test.tsx
                                                 → 7 passed, 0 skipped
pnpm build (with env vars loaded)               → clean
```

The build emits a one-shot warning ("[db] running as superuser — RLS policies will be bypassed") which is expected when `DATABASE_APP_ROLE` isn't set in the local environment. The production deploy uses the Vercel env vars from `/tmp/kavora-env-check`, which currently does NOT set `DATABASE_APP_ROLE`, so prod is also currently RLS-bypassed until the Vercel env vars are updated. (Cross-scope concern; outside this reviewer's allowlist.)

---

## Final SHA

- Fix commit (pushed to `origin/main`): `bba2cab` — `test(ui): un-skip memberships-present render test + add cleanup hook`
- `origin/main` HEAD after push: contains this commit along with Reviewer 1's `0503abf` and Reviewer 3's `ca6fd2d`.
