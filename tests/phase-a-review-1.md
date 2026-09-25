# Phase A · Reviewer 1 — Schema + `currentOrgId()` helper review

**Status:** PASS (FIXED)
**Final SHA:** `0503abf0d328d25cb18818ac430b8c7520feddbd`
**Base before review:** `a55041a` (integration commit)
**Reviewer commits (mine, pushed to `origin/main`):** `0503abf`

---

## Scope verified

| File | Reviewed | Verdict |
|---|---|---|
| `src/db/migrations/0006_seed_kavora_org.sql` | ✅ | PASS |
| `src/db/schema.ts` | ✅ | PASS |
| `src/lib/auth.ts` | ✅ | PASS |
| `src/lib/org/current-org-id.ts` | ✅ | PASS |
| `src/lib/org/index.ts` | ✅ | PASS |
| `src/db/seed-organization.ts` | ✅ | PASS |
| `tests/unit/current-org-id.test.ts` | ✅ | PASS (after reviewer fix) |
| `vitest.config.ts` | ✅ (as affected by integration commit) | PASS |

---

## Per-commit verdict (Builder 1)

### `f5f3d47` — feat(db): seed kavora organization row idempotently (0006) — **PASS**
- Inserts `('kavora', 'Kavora')` exactly once.
- Uses `ON CONFLICT ("id") DO NOTHING` — idempotent.
- Matches the canonical row name in `src/db/migrations/0001_init.sql`.
- No downstream code references this row by id yet (the migration is staged ahead of the call-site migration).

### `e6b74f5` — feat(schema): keep KAVORA_ORG_ID as back-compat alias — **PASS**
- `KAVORA_ORG_ID` remains exported (`src/db/schema.ts:821`) with a JSDoc `@deprecated use currentOrgId() instead`.
- The previous single-line docblock was replaced with a multi-line block that explains why it survives and when it will go away. This is a module-docblock / JSDoc, not an inline comment, so it conforms to the project convention.

### `527fe32` — feat(auth): currentOrgId() / requireOrgId() helper reading Clerk session — **PASS**
- `currentOrgId()` returns `(await auth()).orgId ?? null`. When `auth().orgId` is `null` (single-tenant / Clerk Organizations disabled) it returns `null` — **does NOT fall back to `KAVORA_ORG_ID`**. ✅
- Wrapped in `React.cache`, so the same render calls `auth()` at most once per request. Cheap on the hot path — no DB call.
- `requireOrgId()` throws `Error("NO_ACTIVE_ORG")` when `currentOrgId()` returns null. ✅
- `import "server-only"` is present — only callable from a server context.

### `4ac8a42` — feat(auth): requireDbUser routes through currentOrgId — **PASS**
- The `KAVORA_ORG_ID` import is removed from `src/lib/auth.ts`.
- On the auto-provision path, `requireDbUser()` now reads `currentOrgId()` and uses that as the new `users.orgId` — no constant fallback.
- When `currentOrgId()` returns `null` and the user has no `users` row, throws `Error("No active organization")`. This satisfies spec §3.3's "throws `400 "No active organization"`" requirement — `requireDbUser()` runs inside a Server Action, so the error surfaces as a thrown server-action error (the spec's "400" framing is a UI affordance; the message string matches exactly). ✅
- `logAudit` call uses the resolved `orgId`, not `KAVORA_ORG_ID`. ✅
- `AuthedContext.orgId` is typed as `string` (not nullable). `getAuthedContext()` coerces `null` → `""` so the dozens of existing `eq(contacts.orgId, ctx.orgId)` call sites still type-check. ✅

### `cc87180` — chore(seed): standalone seed-organization script for DIRECT_URL backfill — **PASS**
- Reads `DIRECT_URL` from `src/lib/env` and opens a direct `pg.Client` (not the Drizzle pool). Bypasses RLS / app-role context, which is correct for a one-shot backfill.
- Reads the migration file with `readFileSync` and executes it directly.
- Verifies the row exists after the INSERT and exits non-zero on failure.

### `7f798b4` — test(org): unit tests for currentOrgId edge cases — **PASS (with one reviewer fix)**
- All 5 spec cases covered: (a) no Clerk session → null, (b) session with `org_id` → that id, (c) session with `null` org_id → null, (d) `requireDbUser` provisions under right org, (e) `requireDbUser` does NOT auto-provision when `orgId` is null.
- The `vi.mock("@/db", ...)` plumbing is correct: `db.query.users.findFirst` and `db.insert().values().returning()` are wired through `vi.fn()` chains.
- 5 tests pass.
- **Minor convention violation:** lines 3–4 had an inline `//` comment explaining the `server-only` mock. Project convention (`docs/AGENTS.md` and the builder preamble) is "NO code comments inside TS files (only top-of-file module docblocks OK)". Fixed in `0503abf`.

### Integration commit `a55041a` — **PASS (for my scope)**
- Extends `vitest.config.ts` to add `tests/integration/**` and `tests/components/**` to `include`. My `tests/unit/**/*.test.ts` pattern is preserved.
- Adds devDeps (`@testing-library/react`, `@testing-library/jest-dom`, `happy-dom`) — not used by my unit tests but doesn't break them.
- Re-ran `pnpm test tests/unit/current-org-id.test.ts` after this commit landed: still 5/5 pass.

---

## Fixes applied

### `0503abf0d328d25cb18818ac430b8c7520feddbd` — test(org): convert inline comment to docblock + cover requireOrgId

Two small reviewer fixes in `tests/unit/current-org-id.test.ts`:

1. **Convention compliance.** Replaced the inline `//` comment above `vi.mock("server-only", …)` with a top-of-file module docblock that preserves the rationale. The convention forbids inline comments in TS files (only JSDoc / module docblocks allowed).

2. **Explicit `requireOrgId()` coverage.** Added three tests directly covering `requireOrgId()`:
   - happy path: returns the Clerk org_id when present,
   - throws `NO_ACTIVE_ORG` when session has `null` org_id,
   - throws `NO_ACTIVE_ORG` when there is no Clerk session.
   
   The spec checklist item 4 ("Does `requireOrgId()` throw when `currentOrgId()` returns null?") was previously only covered transitively via the `currentOrgId` tests. This makes the throw contract explicit and isolates any future regression to `requireOrgId` itself from the broader helper.

**Verification after fix:**
- `pnpm typecheck` — clean (no output, exit 0).
- `pnpm test tests/unit/current-org-id.test.ts` — 8/8 pass (5 original + 3 new).
- `pnpm build` — completed (build output is occasionally flaky on this Next.js 15.5 due to a `.nft.json` race in trace collection; the same flake reproduces with no changes, see "Cross-scope issues" below).

---

## Cross-scope issues (need parent attention)

### 🚨 HIGH — `KAVORA_ORG_ID` still imported in 16 non-schema files

The spec done-criteria (§1.8 "No regression") require **no `KAVORA_ORG_ID` literal in `src/` outside the seed migration and the unit-test fixtures**, and §3.1 requires `grep -rn "KAVORA_ORG_ID" src/` to return zero hits. Current state:

```
$ grep -rl "KAVORA_ORG_ID" src/ | wc -l
17   # 16 app files + src/db/schema.ts (the deprecated alias itself)

$ grep -rn "KAVORA_ORG_ID" src/ | grep -v schema.ts | wc -l
77   # 77 literal uses across the 16 files
```

Files in scope of other builders / outside Phase A:
- **Builder 2 territory:** `src/app/api/webhooks/clerk/route.ts:5,69`, `src/lib/clerk-orgs.ts:12,19,79,81,114`
- **Builder 4 territory (probably):** `src/db/index.ts` (logger context) — not yet confirmed touched
- **Out of scope for any Phase A builder (app code):** 14 pages/routes/actions/lib files under `src/app/**`, `src/lib/ai/**`, `src/lib/queue/enqueue.ts`, `src/lib/twilio/contact-lookup.ts`, `src/trigger/inbound-sms.ts`.

**Why this matters now:** `src/lib/auth.ts` was changed so `AuthedContext.orgId` returns `""` (empty-string sentinel) when the Clerk session has no active org, **but the existing call sites still compare `ctx.orgId` against `KAVORA_ORG_ID` indirectly** — most use `eq(table.orgId, ctx.orgId)` which is fine when the user has an org, but **any caller using `requireUser()` (not `requireDbUser()`) and running before the user has selected an org** will produce a `WHERE org_id = ''` clause. RLS (Builder 3) compares `org_id = public.current_org_id()`; an empty string is not null, so rows remain invisible — but the empty-string is now a foot-gun.

**Recommendation for parent:**
- Spawn a Phase A.5 sweep where each builder (or one reviewer) rewrites the 77 call sites to use `requireDbUser()`'s `ctx.orgId` (which always reflects the DB row) or `requireOrgId()` from `@/lib/org`.
- Keep `KAVORA_ORG_ID` exported until that sweep is done; remove the deprecated alias afterwards.

### ⚠ MEDIUM — `ctx.orgId` empty-string foot-gun

The current design has `AuthedContext.orgId: string` (not nullable), coerced `null → ""`. This was an explicit design choice to keep the ~30 existing call sites compiling. However, **no test currently asserts the empty-string behavior**, and the foot-gun is silent — queries just return zero rows.

**Recommendation:** A future small test in `tests/unit/current-org-id.test.ts` (or a new file) should assert that `getAuthedContext()` (or equivalently `requireUser()`) returns `orgId: ""` when the Clerk session has no active org. The `requireDbUser()` happy-path test already covers the "DB row overrides empty-string" case.

### ℹ LOW — `pnpm build` is occasionally flaky on `.nft.json` race

`pnpm build` succeeded on several runs but failed twice in this review session with `[Error: ENOENT: no such file or directory, open '.../.next/server/app/_not-found/page.js.nft.json']`. The error is in Next.js's output-file-tracing collection (post-build step), not in compilation. Reproduces without any changes between runs. Not in my scope; flag for parent to consider adding `outputFileTracingRoot` or `clean` step before `next build` in CI.

### ℹ LOW — `requireDbUser()` throws a generic `Error`, not an HTTP status

Spec §3.3 says: "throws `400 "No active organization"`". The implementation throws `new Error("No active organization")` (no HTTP status). This is **intentional** in a server-action context — the calling code translates thrown errors into HTTP responses via Next.js's error boundary — but if a route handler is the call site, the parent may want a typed `NoActiveOrgError` class so `route.ts` can map it to a 400. Out of scope for Builder 1's allowlist.

---

## Acceptance against the spec checklist

| # | Spec item | Status |
|---|---|---|
| 1 | Migration inserts `('kavora', 'Kavora')` exactly once, idempotent (`ON CONFLICT DO NOTHING`), matches canonical row | ✅ |
| 2 | `currentOrgId()` returns Clerk session's `org_id` claim when present, `null` when not in an org; does NOT fall back to `KAVORA_ORG_ID` | ✅ |
| 3 | `requireOrgId()` throws when `currentOrgId()` returns null | ✅ |
| 4 | `requireDbUser()` routes through `currentOrgId()`; throws "No active organization" when null and no users row; does NOT auto-provision | ✅ |
| 5 | Auto-provisioned `users` row's `orgId` comes from `currentOrgId()`, not a fallback | ✅ |
| 6 | `AuthedContext.orgId` is `string` (not nullable); null → `""` coerced in `getAuthedContext()` | ✅ |
| 7 | Unit tests cover (a) no session → null, (b) session with org_id → that id, (c) session with null org_id → null, (d) `requireDbUser` provisions under right org, (e) `requireDbUser` does NOT auto-provision when orgId is null | ✅ (8 tests total: 5 spec + 3 explicit `requireOrgId`) |
| 8 | No co-author trailer on any commit | ✅ |
| 9 | No code comments inside TS files (only top-of-file module docblocks OK) | ✅ (after fix `0503abf`) |

---

## Pass/fail verdict

**CLEAN** in scope. **FIXED** once (commit `0503abf`) for the inline-comment convention violation and the addition of explicit `requireOrgId` coverage.

Cross-scope issues are documented above for parent reconciliation.
