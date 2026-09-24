# T2-1 (Edit sheet) — multi-value email + phone UI in `edit-contact-sheet`

> Manual smoke for the view-layer half of T2-1. Covers only
> `src/components/contacts/edit-contact-sheet.tsx`. The Server-Action
> counterpart is covered by `t2-1-contact-actions-smoke.md` and the
> `new-contact-button` row pattern is shared from there.

## What this verifies

1. `EditContactSheet` seeds `emails` / `phones` local state from
   `getContactEmailsAndPhones(contact.id)` on mount.
2. The seeded rows are editable: type, value, isPrimary flip.
3. "Add email" / "Add phone" append a new row; "Trash" removes a row.
4. Removing the only row is a no-op (the last row stays).
5. Removing the primary row promotes the first remaining row to primary.
6. Submitting the form with 2 emails + 2 phones writes the right
   `contact_emails` / `contact_phones` rows AND flips the legacy
   `contacts.email` / `contacts.phone` columns to the new primary.
7. The "Saving…" state disables all row inputs and the submit button.
8. An invalid phone (`toE164` fails) bubbles up as a `toast.error` from
   `updateContact`'s `try/catch`.
9. Legacy data: a contact with 0 channel rows renders 1 empty row each
   (so the user has somewhere to type).
10. `pnpm typecheck` and `pnpm build` pass.

## Pre-reqs

- Postgres reachable via `DATABASE_URL`, migration `0005_contact_emails_phones.sql` applied.
- Dev server running: `pnpm dev`.
- Logged-in Clerk session with access to the Kavora org.

## Manual browser verification

### 1. Open the edit sheet on a contact that already has 1 email + 1 phone

1. From `/contacts`, click any contact → `/contacts/<id>`.
2. Open the "More actions" menu → **Edit contact** → `/contacts/<id>/edit`.
3. The bottom sheet should slide up titled `Edit <full name>`.
4. Inside, the **Emails** group should show **one** row populated with
   the existing email, type select defaulting to its existing type,
   and a "Primary" button (disabled) on that row.
5. The **Phones** group should mirror that for phones, with the value
   in `+1XXXXXXXXXX` form (already E.164).

### 2. Add a second email + a second phone

1. Click **Add email** under the Emails group.
2. A new empty row appears below the primary one.
3. Type `personal@example.com` and switch its type to `home`.
4. Click **Add phone** under the Phones group.
5. Type `+1 (303) 555-9999` (any valid US number) and leave the type
   at `work`.

### 3. Flip the primary

1. On the new (personal) email row, click **Make primary**. The
   button on that row becomes disabled and reads `Primary`; the
   previously-primary row's button flips back to `Make primary` and is
   enabled.
2. Repeat for the new phone row.

### 4. Save

1. Click **Save changes** in the sheet footer. The button label flips
   to **Saving…** and all row inputs become disabled.
2. The sheet closes and the URL becomes `/contacts/<id>`.
3. The detail page's **Emails** card should now show **two** rows; the
   `personal@example.com` row should have the `Primary` badge; the
   other row should not.
4. The **Phones** card should mirror that, with both rows in E.164 form
   and the `+13035559999` row marked Primary.

### 5. SQL assertions

```bash
psql "$DATABASE_URL" <<SQL
SELECT email, type, is_primary
  FROM contact_emails
 WHERE contact_id = '<id>'
 ORDER BY is_primary DESC, created_at;

SELECT phone_e164, type, is_primary
  FROM contact_phones
 WHERE contact_id = '<id>'
 ORDER BY is_primary DESC, created_at;

SELECT email, phone FROM contacts WHERE id = '<id>';
SQL
```

- `contact_emails` has 2 rows; exactly one has `is_primary = true` (the
  personal one you promoted).
- `contact_phones` has 2 rows; exactly one has `is_primary = true`
  (the one you promoted).
- `contacts.email = 'personal@example.com'` and
  `contacts.phone = '+13035559999'` — the legacy denormalized columns
  re-synced from the new primary row.

### 6. Remove the only row is a no-op

1. Open the edit sheet on the same contact.
2. Try to click the Trash button on the single remaining row in
   Emails. It is disabled (with the tooltip
   "At least one email is required").
3. Same for Phones. (The new-contact sheet uses the wording
   `Primary email can't be removed` / `Primary phone can't be removed`
   for the same `onlyRow` condition — the difference is intentional:
   this sheet has already persisted, so "at least one is required" is
   the more accurate framing; the new sheet has not persisted yet, so
   the primary is framed as locked. Do not change one to match the other.)

### 7. Remove a primary promotes the next row

1. Add a third row in Emails (any value, any type).
2. Make it primary.
3. Click its Trash icon.
4. The first remaining row's button becomes `Primary` and is disabled.

### 8. Legacy data — zero channel rows

1. Insert a contact directly via SQL with no `contact_emails` /
   `contact_phones` rows:
   ```bash
   psql "$DATABASE_URL" <<SQL
   INSERT INTO contacts (id, org_id, first_name, last_name, status)
   VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'kavora', 'Empty', 'Channels', 'lead')
   ON CONFLICT (id) DO NOTHING;
   SQL
   ```
2. Open `/contacts/dddddddd-dddd-dddd-dddd-dddddddddddd/edit`.
3. Both Emails and Phones groups render **one empty row** each with
   type `work` and a `Primary` badge. The user can immediately start
   typing.

### 9. Invalid phone surfaces a toast

1. On the existing 2-phone contact, open the edit sheet.
2. In the second phone row, type `5551234` (7-digit US local number —
   fails `toE164`).
3. Click **Save changes**.
4. Expect a Sonner toast: `Invalid phone number: 5551234` (the exact
   message from `updateContact`'s throw). The sheet stays open, the
   bad row is still editable, and `Saving…` clears back to
   `Save changes`.

### 10. `pnpm typecheck`

```bash
cd /Users/lionel/builders/kavora-crm
pnpm typecheck
```

Expect `tsc --noEmit` to exit 0 with no output.

### 11. `pnpm build`

```bash
cd /Users/lionel/builders/kavora-crm
DATABASE_URL="https://example.invalid/db" pnpm build
```

Expect a successful build with `/contacts/[id]/edit` still listed in the
route table.

## Negative paths (manual, optional)

| Scenario | Expected |
|---|---|
| Open edit sheet then quickly close it before fetch resolves | No `setState` warning; `cancelled` flag in `useEffect` cleanup suppresses the late `setEmails`/`setPhones` call. |
| `getContactEmailsAndPhones` throws (DB outage) | Catch branch sets `emails`/`phones` to `[{empty, work, primary}]` each — sheet still usable. |
| Contact has 3+ emails on load | All rows render with correct type / isPrimary; the first row without `isPrimary` in the source data is auto-promoted (defensive, via `withPrimary`). |
| Two rows are marked `isPrimary` in the DB | `withPrimary` keeps the first one flagged, demotes the others. (Won't happen with `updateContact`'s invariant, but defensive.) |
| Save with no actual email data typed (all rows empty) | `emails` JSON is `[]`; `fd.delete("email")` removes the legacy scalar; `updateContact` leaves `contacts.email` untouched (legacy branch only fires when `newEmail !== undefined`, and `undefined` from `delete` short-circuits). |
| Add a second email/phone row WITHOUT making it primary, then save | Both rows are persisted. `updateContact` (since `201d7f8`) consumes the `emails`/`phones` JSON arrays from FormData and bulk-replaces `contact_emails`/`contact_phones` for the contact — `is_primary: false` is preserved on the new row, and the previously primary row keeps its `is_primary: true` flag. The legacy `contacts.email`/`contacts.phone` columns are re-synced to whichever array entry is flagged `isPrimary`. |

## YAGNI skips

- **No shared `ChannelRow` component.** Future refactor ticket once the
  create-side and edit-side row patterns are both stable and identical.
- **No optimistic UI.** Server round-trip decides which rows persist.
- **No per-row Server Action.** `setContactEmailsAndPhones` exists in
  the action layer but isn't wired into the form yet — the form posts a
  single `FormData` to `updateContact` per the existing wire contract.
- **No client-side `toE164` validation in the edit sheet.** The
  create-side has per-row inline errors; this sheet leans on the
  server's throw → toast.error path to surface bad input, keeping
  parity with the rest of `edit-contact-sheet`'s YAGNI posture.
- **No reorder UI.** Rows are append-only.

## What changed (file paths + line counts)

| File | Change |
|---|---|
| `src/components/contacts/edit-contact-sheet.tsx` | MODIFY — replaced single-value `<Input name="email">` / `<Input name="phone">` with two `space-y-2 rounded-md border p-3` channel groups (emails + phones), each with per-row type select, "Make primary" / Trash, and an "Add …" CTA. Added `getContactEmailsAndPhones` seed via `useEffect` with `cancelled` flag; on submit, `FormData` is augmented with `emails`/`phones` JSON arrays AND legacy `email`/`phone` scalars derived from the primary row. Submit errors now surface via `toast.error` (matching `contact-actions.tsx`). |
| `tests/t2-1-edit-contact-multivalue-smoke.md` | NEW — this file. |

## Cleanup

```bash
psql "$DATABASE_URL" <<SQL
DELETE FROM contact_emails WHERE contact_id = '<id>';
DELETE FROM contact_phones WHERE contact_id = '<id>';
UPDATE contacts SET email = NULL, phone = NULL WHERE id = '<id>';
DELETE FROM contacts      WHERE id = '<id>';
DELETE FROM contact_emails WHERE contact_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
DELETE FROM contact_phones WHERE contact_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
DELETE FROM contacts        WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
SQL
```

## Where to look for pre-flight / exit / rollback

Pre-flight checks, exit criteria, and rollback steps live in
`tests/smoke-s4-v1-8-manual-runbook.md` (Pre-flight + Exit criteria +
"If smoke fails" sections) — that runbook is the single source of truth
for the walkable v1.8 smoke flow. This file is review evidence for the
edit-contact-sheet slice; the runbook covers the cross-scenario concerns
that don't belong in any one slice's doc.
