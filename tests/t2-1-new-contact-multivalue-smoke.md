# T2-1 — `NewContactButton` multi-value email + phone UI

> Evidence-driven check for the multi-value channel editor on the contact
> create sheet. The action layer (`src/actions/contacts.ts:createContact`)
> already accepts `formData.get("emails")` and `formData.get("phones")` as
> JSON-encoded arrays of `{ email/phone, type, isPrimary }` (validated with
> `emailInputSchema` / `phoneInputSchema` Zod schemas and `toE164` for
> phones). This change replaces the single-value `<Input name="email">` and
> `<Input name="phone">` in `src/components/contacts/new-contact-button.tsx`
> with a repeatable sub-section for each channel.

## What this verifies

1. `NewContactButton` opens the `BottomSheet` and renders an "Emails" block
   and a "Phones" block, each seeded with one primary row
   (`type="work"`, `isPrimary: true`).
2. Each row has: a free-text Input, a `type` `<select>` (work / home /
   other), a "Make primary" / "Primary" toggle, and a Trash button.
3. The "+ Add email" / "+ Add phone" button appends a new row with
   `isPrimary: false`. The previously primary row stays primary.
4. Clicking "Make primary" on a non-primary row swaps the flag — that row
   becomes the only primary; the old primary row loses its badge and its
   Trash button becomes enabled.
5. The primary row's Trash is disabled when it's the only row in the list
   (`title="Primary email can't be removed"` / `"Primary phone can't be
   removed"`). Removing the last row is blocked; emptying the list is only
   possible when another non-primary row exists to take over. (The edit
   sheet uses the wording `At least one email is required` /
   `At least one phone is required` for the same `onlyRow` condition —
   the difference is intentional: this sheet has no persisted state yet,
   so the message frames it as "the primary is locked"; the edit sheet
   has already saved, so "at least one is required" is the more accurate
   framing. Do not change one to match the other.)
6. Submission encodes the rows into the wire format the action expects:
   `fd.set("emails", JSON.stringify([{ email, type, isPrimary }, ...]))`
   with empty rows filtered out by `email.trim().length > 0`.
7. The contact detail page renders all submitted rows under the existing
   `Emails` and `Phone` cards (sorted by `isPrimary desc, createdAt asc`).
8. `pnpm typecheck` and `pnpm build` (`DATABASE_URL="https://example.invalid/db"`)
   both succeed.

## Pre-reqs

1. Postgres reachable via `DATABASE_URL` (local or pooled Supabase).
2. Drizzle migrations applied (incl. `0005_contact_emails_phones.sql`
   that creates `contact_emails` / `contact_phones`):
   ```bash
   cd /Users/lionel/builders/kavora-crm
   pnpm db:migrate
   ```
3. Dev server running with a logged-in browser session:
   ```bash
   pnpm dev
   ```

## Manual browser verification

### 1. Sheet opens with the new sections

1. Navigate to `http://localhost:3000/contacts`.
2. Click the **New contact** button (top-right).
3. Confirm the sheet contains two bordered sub-sections labelled
   **Emails** and **Phones**.
4. Each section shows a single row, with:
   - a free-text input,
   - a `type` select defaulting to **Work**,
   - a `Primary` button (disabled, since this is the primary row),
   - a Trash icon button (disabled, since this is the only row).

### 2. Add a second email and a second phone

1. Click **+ Add email** — a second row appears, `Make primary` enabled,
   Trash enabled.
2. Click **+ Add phone** — a second phone row appears.
3. Type:
   - Email row 1: `primary@example.com` (stays primary).
   - Email row 2: `secondary@example.com`.
   - Phone row 1: `+13035551111` (stays primary).
   - Phone row 2: `+13035552222`.
4. Change row 2 of each section to type **Home** (or **Other**) via the
   inline `<select>` — the value persists on the row.

### 3. Primary swap round-trips

1. Click **Make primary** on email row 2.
2. Confirm row 2 now shows `Primary` (disabled), and row 1's button reverts
   to `Make primary` (enabled). The Trash on row 1 is now enabled.
3. Click **Make primary** on phone row 2 — same behaviour for the Phones
   section.

### 4. Invalid input blocks submission

1. Change email row 1 to `not-an-email` — the submit button at the
   bottom of the sheet becomes disabled immediately.
2. Fix it back to `primary@example.com` — the submit button re-enables.
3. Change phone row 1 to `12345` — submit button disables again; under the
   phone row, an inline red message reads `Invalid phone number`.
4. Try clicking **Create contact** with an invalid row still present (e.g.
   temporarily re-set row 1 to `not-an-email`) — the sheet does not
   submit; instead, the offending row shows
   `Invalid email format` in red below it. No toast appears.
5. Fix the row — red message clears, submit re-enables, **Create contact**
   succeeds and the sheet closes.

### 5. Empty rows are skipped (defence-in-depth filter)

1. Click **+ Add email** twice to add two empty rows.
2. Leave them blank. Confirm the submit button is NOT disabled by the
   empty rows (only by actually invalid content).
3. Click **Create contact** with valid data on the first row only — the
   action receives a single-element `emails` array (empty rows stripped
   by `emails.filter((e) => e.email.trim().length > 0)`).
4. Open the new contact's detail page (`/contacts/<id>`) and assert:
   exactly **1** row in the **Emails** card, exactly **1** row in the
   **Phones** card (empty rows never persisted — the on-submit filter
   stripped them before they reached the action layer).

### 6. Empty list is a valid contact

1. Add a third row, then delete the primary row via the Trash button —
   the row you just added (or the one that was second) auto-promotes to
   primary. Continue deleting until only one row remains; the Trash on
   that sole row is now disabled with the
   `Primary email can't be removed` tooltip.

> Strict "remove all" empty-state requires going through promote-then-
> delete (because the primary row is protected). The contact-without-
> email/phone case is still representable by submitting with an empty
> `emails` / `phones` array, which the action layer accepts.

### 7. Persistence on the detail page

1. Create a new contact named `Multivalue Smoke` with:
   - 2 emails (`alice@example.com` work primary, `alice.home@example.com` home).
   - 2 phones (`+13035551111` work primary, `+13035552222` home).
2. After the sheet closes, the list refreshes via `router.refresh()`
   (no redirect — URL stays on `/contacts`). Open the new contact's
   detail page (`/contacts/<id>`).
3. Confirm the **Emails** card lists both rows and the **Phone** card
   lists both rows. The primary row appears first in each card (the
   detail page sorts by `isPrimary desc, createdAt asc`).

### 8. `pnpm typecheck`

```bash
cd /Users/lionel/builders/kavora-crm
pnpm typecheck
```

Expect `tsc --noEmit` to exit 0 with no output.

### 9. `pnpm build`

```bash
cd /Users/lionel/builders/kavora-crm
DATABASE_URL="https://example.invalid/db" pnpm build
```

Expect a successful build. The `/contacts` route still appears in the
build output.

### 10. Grep confirms the wire format

```bash
cd /Users/lionel/builders/kavora-crm
grep -n "fd.set(\"emails\"\|fd.set(\"phones\"" \
  src/components/contacts/new-contact-button.tsx
```

Expect two matches — one for `emails`, one for `phones`, both wrapping
the JSON-encoded array (filtered by `.trim().length > 0`).

## What changed (file paths + line ranges)

| File | Lines | Change |
| ---- | ----- | ------ |
| `src/components/contacts/new-contact-button.tsx` | whole file | Replaced the single-value `<Input name="email">` and `<Input name="phone">` with two repeatable sub-sections (Emails / Phones), each with type select, primary toggle, Trash, and "+ Add" CTA. State is local `useState<EmailRow[]>` / `useState<PhoneRow[]>`; submission appends `emails` and `phones` as JSON-encoded arrays (empty rows filtered out). |

## YAGNI skips

- No `useFieldArray` / `react-hook-form` — `useState` + small handlers are
  enough for ≤ ~5 rows.
- No shared `<ChannelInput>` component across new + edit sheets — the
  edit sheet (`edit-contact-sheet.tsx`) is owned by another worker and
  will get its own local JSX; cross-component dedup is a future refactor.
- No per-row drag-to-reorder — primary swap covers the only ordering that
  matters (primary first).
- No phone-format helper on the form — the existing `formatPhoneForDisplay`
  is display-only, and validation goes through `toE164` directly.
- No new `package.json` dependencies — `lucide-react` `Trash2` /
  `Plus`, the existing `Button` / `Input` / `BottomSheet`, and a native
  `<select>` cover everything.

## Constraints hit

- `BottomSheet`'s submit button is hardcoded `disabled={isSubmitting}` —
  we cannot visually toggle a `submitDisabled` prop without editing a
  file outside the allowlist. Workaround: pass `isSubmitting={submitting
  || formInvalid}` so the same prop also disables when the form has
  invalid rows. The label stays accurate because `submitLabel` keys off
  `submitting` alone. Inline red text still surfaces the exact row(s)
  that failed validation.

## Where to look for pre-flight / exit / rollback

Pre-flight checks, exit criteria, and rollback steps live in
`tests/smoke-s4-v1-8-manual-runbook.md` (Pre-flight + Exit criteria +
"If smoke fails" sections) — that runbook is the single source of truth
for the walkable v1.8 smoke flow. This file is review evidence for the
new-contact-sheet slice; the runbook covers the cross-scenario concerns
that don't belong in any one slice's doc.
