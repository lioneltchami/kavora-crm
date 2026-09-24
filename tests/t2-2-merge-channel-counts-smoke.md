# T2-2 — `mergeContact` surfaces channel-copy counts

> **Post-deploy sanity check** (code-contract only — not a walkable
> browser scenario). All checks below are `grep` / `sed` / `pnpm
> typecheck` against the committed source; they verify the TS surface
> still agrees with the SQL return shape. The walkable browser merge
> scenario lives in `tests/smoke-s4-v1-8-manual-runbook.md` Scenario 3.
> Run this only if the Scenario 3 SQL smoke or the audit-log assertion
> in the runbook comes back with unexpected values.

Evidence-driven check for the TS-side shape change:
`src/actions/merge-contacts.ts` now returns `copiedEmails` and
`copiedPhones` in its audit metadata, mirroring the
`copied_emails` / `copied_phones` jsonb keys that Agent 3A's
PL/pgSQL change adds to `merge_contacts(...)`'s
`jsonb_build_object(...)` in
`src/db/migrations/0002_merge_contacts.sql`.

## What this verifies

1. `MergeContactResult` (the interface exported from
   `src/actions/merge-contacts.ts`) now declares `copiedEmails: number`
   and `copiedPhones: number` in addition to the existing reassignment /
   tag-copy counts.
2. The result mapper populates both new fields from `raw.copied_emails`
   and `raw.copied_phones` (snake_case SQL → camelCase TS).
3. The `logAudit({ ..., meta: { ...result } })` call records both new
   counts under the `contact.merged` audit row, because `meta` is typed
   `Record<string, unknown>` and the spread is exhaustive.
4. `pnpm typecheck` passes for the action file once Agent 3A's SQL
   migration lands (typecheck against the current pre-SQL change may
   still flag a missing field at runtime, but the TS contract itself
   stays consistent).

## Type contract (verbatim from `src/actions/merge-contacts.ts`)

```ts
export interface MergeContactResult {
  winnerId: string;
  loserId: string;
  reassignedNotes: number;
  reassignedDeals: number;
  reassignedCalls: number;
  reassignedSms: number;
  reassignedActivities: number;
  reassignedAiDrafts: number;
  reassignedLeadScores: number;
  copiedTags: number;
  copiedEmails: number;
  copiedPhones: number;
}
```

Caller shape (matches existing server-action signature):

```ts
await mergeContact({ winnerId, loserId });
// → Promise<void> (unchanged contract; result is captured in audit meta)
```

Audit row (post-call, written via `logAudit`):

```json
{
  "action": "contact.merged",
  "entity": "contact",
  "entityId": "<loserId>",
  "meta": {
    "winnerId": "<uuid>",
    "loserId":  "<uuid>",
    "reassignedNotes":       0,
    "reassignedDeals":       0,
    "reassignedCalls":       0,
    "reassignedSms":         0,
    "reassignedActivities":  0,
    "reassignedAiDrafts":    0,
    "reassignedLeadScores":  0,
    "copiedTags":            0,
    "copiedEmails":          0,
    "copiedPhones":          0
  }
}
```

## Pre-reqs

1. Agent 3A's SQL change to `src/db/migrations/0002_merge_contacts.sql`
   has been applied (adds `copied_emails` / `copied_phones` to the
   `jsonb_build_object(...)` return):
   ```bash
   cd /Users/lionel/builders/kavora-crm
   pnpm db:migrate
   ```
2. Logged-in browser session (server action requires Clerk auth via
   `requireDbUser`).

## Manual verification

### 1. Action signature is unchanged for callers

```bash
cd /Users/lionel/builders/kavora-crm
grep -n "Promise<void>" src/actions/merge-contacts.ts
```

Expect a hit on the `mergeContact` return type — the action still
returns `Promise<void>`; the merge counts are surfaced only via the
audit log (matching the prior pattern for `copiedTags`).

### 2. `MergeContactResult` includes the two new fields

```bash
cd /Users/lionel/builders/kavora-crm
sed -n '21,35p' src/actions/merge-contacts.ts
```

Expect the interface to list `copiedEmails` and `copiedPhones` after
`copiedTags`, in that order.

### 3. Result mapper reads the new snake_case keys

```bash
cd /Users/lionel/builders/kavora-crm
grep -n "copied_emails\|copied_phones\|copiedEmails\|copiedPhones" \
  src/actions/merge-contacts.ts
```

Expect four hits:
- one each in `RawMergeSummary` (snake_case keys),
- one each inside the `MergeContactResult = { ... }` literal
  (camelCase mapping).

### 4. `pnpm typecheck` is clean

```bash
cd /Users/lionel/builders/kavora-crm
pnpm tsc --noEmit src/actions/merge-contacts.ts
```

Expect `tsc` to exit 0 with no output. (If Agent 3A's SQL change has
not yet landed, the test SQL in
`tests/0002_merge_contacts_channels_smoke.sql` documents the expected
return shape — use that as the reference for what `raw.*` will hold at
runtime; the TS contract is forward-compatible with it.)

### 5. Grep confirms audit meta captures both counts

```bash
cd /Users/lionel/builders/kavora-crm
grep -n "meta: { ...result }" src/actions/merge-contacts.ts
```

Expect a single hit: the spread inside `logAudit({ ..., meta: { ...result } })`
already covers every key of `MergeContactResult`, so `copiedEmails`
and `copiedPhones` are recorded automatically — no further change to
the audit call is required.

## What changed (file paths + line ranges)

| File                                       | Lines     | Change                                                                       |
| ------------------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `src/actions/merge-contacts.ts`            | 21–34     | Added `copiedEmails: number` and `copiedPhones: number` to `MergeContactResult`. |
| `src/actions/merge-contacts.ts`            | 34–48     | Added matching `copied_emails: number` / `copied_phones: number` to `RawMergeSummary`. |
| `src/actions/merge-contacts.ts`            | 76–89     | Result literal maps `raw.copied_emails` → `copiedEmails`, `raw.copied_phones` → `copiedPhones`. |

## YAGNI skips

- No new exported helper (`mapMergeSummary` etc.) — the inline literal
  mirrors the existing pattern for `copiedTags` and is the smallest
  change that satisfies the contract.
- No change to `mergeContact`'s public signature (still `Promise<void>`);
  the contract remains "return shape is captured in `logAudit.meta`",
  just with two additional keys.
- No change to the throw path — if `db.execute` rejects or
  `rows.rows[0]?.result` is missing, the existing `throw` covers both
  cases and the new fields are irrelevant on that branch.
- No SQL changes here (Agent 3A's territory) — only the TS surface
  required to consume what the SQL function already plans to return.

## Where to look for pre-flight / exit / rollback

Pre-flight checks, exit criteria, and rollback steps live in
`tests/smoke-s4-v1-8-manual-runbook.md` (Pre-flight + Exit criteria +
"If smoke fails" sections) — that runbook is the single source of truth
for the walkable v1.8 smoke flow. This file is review evidence for the
`mergeContact` TS-side surface; the runbook covers the cross-scenario
concerns that don't belong in any one slice's doc.
