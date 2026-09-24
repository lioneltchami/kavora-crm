# T2-4 — BottomSheet smoke test

Manually verify the create/edit dialogs now use a bottom sheet (`side="bottom"`, `h-dvh`) with a sticky footer instead of the centered modal dialog. The shared wrapper lives at `src/components/ui/bottom-sheet.tsx` and is consumed by `NewContactButton`, `NewCompanyButton`, `NewDealButton`, and the new `EditContactSheet`.

## Pre-flight

- `pnpm typecheck` passes.
- `pnpm build` (with `DATABASE_URL="https://example.invalid/db"`) compiles; `/contacts/[id]/edit` shows up at ~3.5 kB.
- `grep -rn 'BottomSheet\|side="bottom"' src/components/` returns the wrapper plus the four refactored consumers.

## Steps

1. **Open `/contacts` on mobile (≤767 px).** Tap **New contact**. A sheet slides up from the bottom and fills the viewport (`h-dvh`). No centered modal.
2. **Sticky footer.** Scroll the form. The `Cancel` (outline) and `Create contact` (primary) buttons stay pinned at the bottom edge of the sheet at all times — they're inside `SheetFooter` with `border-t` and `flex flex-row w-full gap-4`.
3. **Save flow.** Enter `First name = Test`, `Email = test@example.com`, tap `Create contact`. The sheet auto-closes (`setOpen(false)`), the new contact appears in the list (`router.refresh()` triggers `revalidatePath("/contacts")`).
4. **Desktop (≥768 px).** Repeat step 1 — the sheet still uses `side="bottom"` and still fills the viewport. This matches the atomic-crm spec ("side='bottom' on mobile, but always full-height").
5. **Cancel.** Re-open **New contact**, tap `Cancel`. Sheet closes without writing.
6. **Edit contact.** From any contact row, open the `⋮` menu → **Edit contact**. You land on `/contacts/[id]/edit`. The sheet is open by default, pre-filled with the contact's current values (`defaultValue={contact.firstName}` etc.). Change the `Last name`, tap `Save changes`. You navigate back to `/contacts/[id]` with the update reflected.
7. **Keyboard / a11y.** With the sheet open:
   - `Tab` cycles through the fields and lands on `Cancel` then the primary submit button (the footer button uses `type="submit"` + `form="..."` to associate with the BottomSheet's internal form).
   - `Shift+Tab` cycles back.
   - `Esc` closes the sheet via the Radix Dialog primitive (overlay dismiss), then triggers `router.push("/contacts/[id]")` on the edit page.
   - The X icon in the top-right is the existing Radix close trigger; same dismissal path.
8. **Companies + Deals.** Open **New company** on `/companies` and **New deal** on `/deals` — both should now slide up from the bottom and use the same footer pattern. Existing field validation, hidden `pipelineId` / `currency` inputs on the deal sheet, and the lazy-loaded company `<Select>` on the contact sheet all keep working.

## What to look for if something breaks

- Sheet doesn't appear full-height on desktop → check `SheetContent` `className="h-dvh flex flex-col"` in `src/components/ui/bottom-sheet.tsx`.
- Submit button does nothing → check that the footer `<Button type="submit" form={formId}>` has `formId` set on the wrapper (`formId="new-contact-form"` etc.) so the HTML5 `form` attribute associates it with the BottomSheet's internal `<form>`.
- Cancel closes the sheet but the page doesn't navigate back from `/contacts/[id]/edit` → check `handleOpenChange` in `edit-contact-sheet.tsx`.
- Radix warning about missing `Description` on the Sheet → already suppressed by passing `aria-describedby={undefined}` to `SheetContent`.
