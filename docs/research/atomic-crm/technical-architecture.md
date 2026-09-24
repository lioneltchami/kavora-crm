# Atomic CRM — Technical Architecture + UX Review

**Repo:** https://github.com/marmelab/atomic-crm
**Stack:** React 19 + Vite 7 + Supabase + react-admin (we use Next.js 15 + Drizzle + shadcn/ui)
**Reviewed:** 2026-09-23
**Purpose:** Cherry-pick UI/UX + technical patterns for Kavora CRM v2

> Scope: technical architecture + UI/UX patterns only. Domain model, business logic, and data migration are owned by another research agent.

---

## TL;DR

**Top patterns worth borrowing for Kavora**
- **Two-tier layout**: persistent left `SidebarProvider` (desktop) + bottom sheet `MobileLayout` for sub-768px, swapped via `useIsMobile()` — far cleaner than responsive `md:hidden` everywhere.
- **`Sidebar` from shadcn/ui with `collapsible="icon"`** + cookie-persisted state + `Cmd/Ctrl+B` shortcut. Production-ready; drop into Next.js client component.
- **Two list view variants rendered side-by-side**: a `<List>` wrapper owns data fetching + pagination/filter chrome; a small `<ListContent>` component renders the actual rows. This makes "contact list as table" vs "contact list as card grid" vs "mobile compact view" trivial to switch by replacing one file.
- **Sticky bottom `BulkActionsToolbar`** (appears only when rows are selected) — `position: fixed; bottom-2; left-0; right-0`. Small UX win, very implementable in shadcn.
- **`@hello-pangea/dnd` kanban with optimistic local state + rebalance-on-drop**: their `updateDealStage` function is a great template for any drag-to-reorder feature on Drizzle/Postgres.
- **`@tanstack/react-query` + `PersistQueryClientProvider`** with `localStorage` persister and `networkMode: "offlineFirst"` — drop-in for offline-tolerant list pages.
- **Sonner toast wired to a single `Notification` component** with `undoable: true` mutations (`<Toaster richColors closeButton position="bottom-center" />`) — gives free undo for destructive actions across the whole app.
- **Empty-state pattern**: `<Empty>` component inside `<List>` checks `data?.length && !hasFilters` to show a rich onboarding `DealEmpty`/`ContactEmpty` (with image + 2 CTAs), otherwise renders a "no results" message.
- **"Use case from email" pattern** in `ContactInputs.tsx:115` — auto-fills first/last name from pasted email via `useFormContext().getValues/setValue`. Cute, shippable.

**Top patterns to skip**
- The whole `ra-core` / `shadcn-admin-kit` data provider abstraction (`useGetList`, `EditBase`, `ResourceContext`, `RecordContextProvider`). All of this maps cleanly to Next.js Server Components + Drizzle queries + Server Actions. Don't try to replicate it; just borrow the *shapes* (e.g. `data-table.tsx`'s column sorting / selection API).
- The `email_jsonb` / `phone_jsonb` JSONB-in-Postgres approach for contacts — for Kavora this should be a normalized `contact_emails` table.
- `react-router` v7 routes defined inside `<CRM>` via `<Resource>` and `<CustomRoutes>`. Next.js App Router file-system routing is the equivalent and you already have it.
- The `@nivo/bar` chart library (heavy ~200kB). Use Recharts or Tremor instead.

**Biggest surprises**
- The CRM is actually `marmelab/atomic-crm` — it's a fork of `marmelab/react-admin`'s reference CRM, layered on top of their paid `shadcn-admin-kit` (free OSS preview). Many "atomic-crm components" are really `shadcn-admin-kit` primitives exposed via `@/components/admin/*`.
- `Supabase Realtime` is **not** used. All updates flow through TanStack Query cache invalidation after mutations.
- There's no Zod usage at the UI layer — form validation is `react-hook-form` validators (`required()`, `email()`, `isLinkedinUrl`).
- They render different *entirely separate* Admin components for desktop vs mobile (`<DesktopAdmin>` vs `<MobileAdmin>` in `CRM.tsx:233`/`277`), not just responsive variants. Each has its own routes, layout, and even its own `QueryClient` (mobile one is persisted).

---

## 1. Stack & Module Structure

### Stack (exact versions from `package.json`)
- React `^19.1.0`, ReactDOM `^19.1.0`
- Vite `^7.3.2` (build), `@tailwindcss/vite ^4.1.18`, `tailwindcss ^4.1.11`
- `ra-core ^5.14.7` (react-admin headless) — Marmelab's library
- `ra-supabase-core ^3.5.2` — the bridge to Supabase
- `react-router ^7.17.0` (note: not `react-router-dom`)
- `@tanstack/react-query ^5.101.0` + `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` — offline-first mobile
- `@hello-pangea/dnd ^18.0.1` — kanban / drag-reorder
- `react-hook-form ^7.78.0` — forms (no Zod resolver)
- `zod ^4.1.12` — declared but **unused at UI layer**; only used server-side (Supabase Edge Functions)
- `sonner ^2.0.7` — toast
- `vaul ^1.1.2` — drawer (mobile bottom sheet)
- `cmdk ^1.1.1` — command palette
- `lucide-react ^0.542.0` — icons
- `next-themes ^0.4.6` — declared but they rolled their own `ThemeProvider` (`src/components/admin/theme-provider.tsx`)
- `@nivo/bar ^0.99.0` — only chart lib, only used in `DealsChart.tsx`
- `@hookform/resolvers` — **not present**
- Storybook `^9.1.19` (Vite builder), Playwright `^1.60.0`, Vitest `^4.1.0`
- PWA via `vite-plugin-pwa`

### Top-level layout
```
src/
  App.tsx, main.tsx, index.css, App.css
  components/
    admin/        ← re-exports shadcn-admin-kit primitives (~80 files: List, Edit, DataTable, ReferenceField, etc.)
    atomic-crm/   ← the actual CRM app code
    supabase/     ← Supabase auth pages (forgot-password, set-password, oauth-consent)
    ui/           ← stock shadcn/ui primitives (button, sheet, sidebar, sonner, etc.)
  hooks/          ← useIsMobile, useBulkExport, user-menu-context, saved-queries
  lib/            ← utils.ts, i18nProvider, sanitizeInputRestProps, genericMemo, toSlug, field.type.ts
  test/           ← StoryWrapper.tsx (story decorator)
supabase/
  functions/      ← Edge Functions (users, merge_contacts, postmark, update_password, delete_note_attachments, mcp)
  migrations/
  schemas/
e2e/              ← Playwright specs
docs/learnings/   ← their own internal patterns doc (we read this)
```

`src/components/atomic-crm/` (the meaty part):
```
activity/      companies/      contacts/        dashboard/
deals/         filters/        layout/          login/
misc/          notes/          providers/       root/
sales/         settings/       simple-list/     tags/
tasks/         dataImport/
```

The `providers/` subdirectory is split: `commons/` (helpers shared by Supabase + fakerest backends) vs `supabase/` vs `fakerest/`. The fakerest backend is used for the **public demo** (no Supabase needed).

---

## 2. Build / Tooling

**Vite config** (`vite.config.ts`):
- `tailwindcss()` plugin (v4 inline), `react()`, `visualizer()` (bundle analyzer to `dist/stats.html`), `createHtmlPlugin` (custom index.html), `VitePWA` (autoUpdate).
- `resolve.alias = { "@": "./src" }` — same convention we'd want in a Next.js project (`@/*`).
- `define:` injects `import.meta.env.VITE_*` at build time for the demo build.

**Storybook** (`.storybook/main.ts`):
```ts
stories: ["../src/**/*.stories.@(ts|tsx)"],
addons: [],
framework: { name: "@storybook/react-vite" },
viteFinal: (config) => {
  config.resolve.alias = { ...config.resolve.alias, "@": path.resolve(__dirname, "../src") };
  return config;
}
```
- Zero addons — no a11y, no controls auto-setup beyond the Storybook defaults.
- `preview.ts` sets `layout: "fullscreen"`.

**Test runner** (`vitest.config.ts`):
- Three Vitest projects:
  1. `app` — browser mode via `@vitest/browser-playwright` (Chromium, headless). Includes a custom `setTimezone` command using Chrome DevTools Protocol (CDP) to override timezone at runtime. Clever.
  2. `claude` — Node-only, runs `.claude/**/*.test.mjs` hooks (subprocess integration tests).
  3. `functions` — Node, runs Deno-targeted Supabase Edge Function tests with `jsr:/npm:` aliasing mapped to installed npm packages.
- Aliases `@` → `./src` per project.

**Linting**: ESLint flat config (`@eslint/js`, `typescript-eslint`, `react-hooks`, `react-refresh`). Pre-commit via `husky` + `lint-staged`.

---

## 3. Data Fetching Layer

### Pattern
- All data flows through a `dataProvider` passed to `<Admin>`. The provider implements a fixed interface (`getList`, `getOne`, `getCreate`, `getUpdate`, `getDelete`, etc.) and is invoked by `ra-core` hooks: `useGetList`, `useGetOne`, `useUpdate`, `useCreate`, `useDelete`.
- Under the hood it's TanStack Query with custom hook wrappers. The `useGetList`/`useUpdate` etc. hooks are how every component reads/writes data.

### Supabase data provider (`src/components/atomic-crm/providers/supabase/dataProvider.ts`)
- Wraps `supabaseDataProvider` from `ra-supabase-core` (line 23–29):
```ts
const getBaseDataProvider = () =>
  supabaseDataProvider({
    instanceUrl: import.meta.env.VITE_SUPABASE_URL,
    apiKey: import.meta.env.VITE_SB_PUBLISHABLE_KEY,
    supabaseClient: getSupabaseClient(),
    sortOrder: "asc,desc.nullslast" as any,
  });
```
- Overrides `getList` to route `companies` → `companies_summary` view, `contacts` → `contacts_summary` view (DB-side denormalized lists for fast listing).
- Adds custom methods `signUp`, `salesCreate`, `salesUpdate`, `updatePassword` that invoke Supabase Edge Functions via `getSupabaseClient().functions.invoke("users", { method: "POST", body })` (lines 116–140).
- The lifecycle callback `withLifecycleCallbacks` lets you hook before/after every mutation.

### Mutation pattern (`Note.tsx:62-100`)
```ts
const [update, { isPending }] = useUpdate();
const [deleteNote] = useDelete(resource, undefined, {
  mutationMode: "undoable",
  onSuccess: () => notify("resources.notes.deleted", { type: "info", undoable: true, messageArgs: { _: "Note deleted" } }),
});

const handleNoteUpdate: SubmitHandler<FieldValues> = (values) => {
  update(resource, { id: note.id, data: values, previousData: note }, { onSuccess: () => setEditing(false) });
};
```

### Caching / invalidation
- All data lives in TanStack Query cache, keyed by resource + query args.
- Mutations automatically invalidate related query keys (`["tasks", "getList"]`, etc.).
- Manual invalidation example (`Task.tsx:86`): `queryClient.invalidateQueries({ queryKey: ["tasks", "getList"] })` — only triggered after non-`done_date` updates.
- Mobile build uses `PersistQueryClientProvider` with `localStorage` persister (`CRM.tsx:294-301`) for offline-first.

### Realtime
**Not used.** Searched: `grep -rn "channel\|postgres_changes\|subscription" src/` returns zero hits. The CRM does NOT subscribe to Supabase Realtime. All updates are pull-based after mutation. This is a meaningful gap they accepted — for Kavora, evaluating Supabase Realtime for a notifications/feed is worth a separate spike.

### Optimistic updates
- Built into `useUpdate` / `useCreate` / `useDelete` via `mutationMode: "optimistic"` (see `ContactInputs.tsx:243-269` for an inline status-selector update).
- All four mutation modes (`pessimistic`, `optimistic`, `undoable`, `switch`) are exposed by `ra-core`. The CRM uses `undoable` for all list-page deletes (so Sonner shows "Undo" in the toast).
- For drag-and-drop reorder (`DealListContent.tsx:33-71`), they implement a manual optimistic state update via `setDealsByStage(...)` before the network round-trip, then `refetch()`.

---

## 4. Routing & Layout

### Route structure (`CRM.tsx:233-274`)
```tsx
<Admin layout={Layout} dashboard={Dashboard}>
  <CustomRoutes noLayout>           {/* auth pages, no admin chrome */}
    <Route path="/sign-up" element={<SignupPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/set-password" element={<SetPasswordPage />} />
    <Route path="/oauth/consent" element={<OAuthConsentPage />} />
  </CustomRoutes>
  <CustomRoutes>                     {/* inside layout */}
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/import" element={<ImportPage />} />
    <Route path="/changelog" element={<ChangelogPage />} />
  </CustomRoutes>
  <Resource name="deals" {...deals} />        {/* → /deals, /deals/:id, /deals/:id/show */}
  <Resource name="contacts" {...contacts} />
  <Resource name="companies" {...companies} />
  ...
</Admin>
```
- Resources auto-register `list`, `create`, `edit`, `show` routes.
- `CustomRoutes noLayout` is how they put login/signup/forgot-password outside the admin chrome.
- Mobile variant (`MobileAdmin`, `CRM.tsx:277-340`) registers different routes entirely — e.g. contacts only has `list` and `show`, with its own `MobileContactList`.

**Kavora mapping**: App Router file-system routing replaces this. Create `app/(auth)/login`, `app/(auth)/signup`, `app/(dashboard)/contacts/`, etc. Auth routes use a separate `(auth)` route group; dashboard routes share a layout via `app/(dashboard)/layout.tsx`.

### Layout (`src/components/admin/layout.tsx:24-68`)
```tsx
<SidebarProvider>
  <AppSidebar />
  <main className="ml-auto w-full max-w-full peer-data-[state=collapsed]:w-[calc(100%-var(--sidebar-width-icon)-1rem)] peer-data-[state=expanded]:w-[calc(100%-var(--sidebar-width))] sm:transition-[width] sm:duration-200 sm:ease-linear flex h-svh flex-col ...">
    <header className="flex h-16 md:h-12 shrink-0 items-center gap-2 px-4">
      <SidebarTrigger className="scale-125 sm:scale-100" />
      <div className="flex-1 flex items-center" id="breadcrumb" />
      <LocalesMenuButton />
      <ThemeModeToggle />
      <RefreshButton />
      <UserMenu />
    </header>
    <ErrorBoundary fallbackRender={({ error, resetErrorBoundary }) => <Error ... />}>
      <Suspense fallback={<Loading />}>
        <div className="flex flex-1 flex-col px-4 ">{props.children}</div>
      </Suspense>
    </ErrorBoundary>
  </main>
  <Notification />
</SidebarProvider>
```
- Header height: `h-16` on mobile, `md:h-12` on desktop.
- `id="breadcrumb"` is a slot the page fills in (each list page mounts its own breadcrumb into this div — see `ListView.tsx:131-143`).
- `RefreshButton` invalidates all queries (`ra-core` builtin).
- Error boundary wraps content, not the whole app.

### Sidebar (`src/components/admin/app-sidebar.tsx:38-87`)
- Built on shadcn/ui `<Sidebar variant="floating" collapsible="icon">`.
- Resources pulled dynamically from `useResourceDefinitions()` and rendered as `<ResourceMenuItem>`.
- Each `ResourceMenuItem` calls `useCanAccess({ resource, action: "list" })` and returns `null` if no access — purely declarative RBAC.
- Active state via `useMatch({ path: createPath(...), end: false })`.
- Mobile: sidebar becomes a drawer (`useSidebar().openMobile`), auto-closes on item click.

### `useIsMobile` (`src/hooks/use-mobile.ts`)
```ts
const MOBILE_BREAKPOINT = 768;
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => { setIsMobile(window.innerWidth < MOBILE_BREAKPOINT); };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return !!isMobile;
}
```
- Same hook shadcn/ui ships. 768px breakpoint.

---

## 5. List Page Patterns

### Architecture: `<List>` + `<ListContent>` split

Two-component split is the dominant pattern:
- `<ContactList>` (`ContactList.tsx:36-52`): the page shell. Wraps `<List>` (provides data + breadcrumb + filter chrome), then renders `<ContactListLayoutDesktop>`.
- `<ContactListContent>` (`ContactListContent.tsx:26-98`): renders the actual rows from `useListContext<Contact>()`. No data fetching.

This split means:
- Desktop and mobile can swap content (`ContactListContent` vs `ContactListContentMobile`).
- Easy to switch between table / card grid / kanban by replacing `<ContactListContent>`.

### Pagination (`CompanyList.tsx:18-27`)
```tsx
<List
  perPage={25}
  sort={{ field: "name", order: "ASC" }}
  actions={<CompanyListActions />}
  pagination={<ListPagination rowsPerPageOptions={[10, 25, 50, 100]} />}
>
```
- `perPage` default 25. `rowsPerPageOptions` configurable.

### Filtering (`ContactListFilter.tsx:20-161`)
- Sidebar of "filter categories" with `ToggleFilterButton`s. Each button has a `value: { field__op: value }` shape:
```tsx
<ToggleFilterButton label="Today" value={{ "last_seen@gte": endOfYesterday().toISOString() }} />
<ToggleFilterButton label="This week" value={{ "last_seen@gte": startOfWeek(new Date()).toISOString() }} />
<ToggleFilterButton label="Managed by me" value={{ sales_id: identity?.id }} />
<ToggleFilterButton label="Has open tasks" value={{ "nb_tasks@gt": 0 }} />
<ToggleFilterButton label="Tagged as X" value={{ "tags@cs": `{${record.id}}` }} />
```
- Operators like `@gte`, `@lte`, `@gt`, `@lt`, `@cs` (contains), `@neq`, `@is` are passed straight through to PostgREST. The same DSL is reusable with Drizzle + custom filter translator — or just normalize to a `{ field, op, value }[]` shape.
- Mobile: same `ToggleFilterButton` but rendered in a sheet triggered from the list header.

### Active filter pills (`ContactListFilter.tsx:163-267` + `ActiveFilterButton.tsx`)
- Mirrors the filter UI as pill-shaped chips above the list. Each chip is `<ActiveFilterButton>` (`misc/ActiveFilterButton.tsx:22-52`) which renders only if its filter is currently active; clicking removes it. Uses `lodash/matches` + `pickBy` for deep comparison (`ActiveFilterButton.tsx:54-72`).
- This is the "saved view" UX without actually persisting — for Kavora a Next.js Server Component can serialize these to URL search params.

### Bulk actions toolbar (`bulk-actions-toolbar.tsx:50-85`)
```tsx
<Card className="flex flex-col gap-2 md:gap-6 md:flex-row items-stretch sm:items-center p-2 px-4 w-[90%] sm:w-fit mx-auto fixed bottom-2 left-0 right-0 z-10 bg-zinc-100 dark:bg-zinc-900">
  <Button variant="ghost" onClick={handleUnselectAll}><X /></Button>
  <span>{selectedIds.length} rows selected</span>
  {children}
</Card>
```
- Returns `null` when `!selectedIds?.length` — no DOM cost when idle.
- Default children (`BulkActionsToolbarChildren`) are `SelectAllButton` + `BulkExportButton` + `BulkDeleteButton`.

### Shift-click range select (`ContactListContent.tsx:39-68`)
```ts
const handleToggleItem = useCallback((id, event) => {
  if (event.shiftKey && lastSelected.current) {
    const ids = contacts.map(c => c.id);
    const lastIndex = ids.indexOf(lastSelected.current);
    const index = ids.indexOf(id);
    const range = ids.slice(Math.min(lastIndex, index), Math.max(lastIndex, index) + 1);
    onSelect?.(isClickedItemSelected ? difference(selectedIds, range) : union(selectedIds, range));
  } else {
    onToggleItem(id);
  }
  lastSelected.current = id;
}, [contacts, selectedIds, onSelect, onToggleItem]);
```
- Genuinely nice UX touch. Lifts easily into any custom list.

### Table variant vs card grid
- `contacts` uses a **list-of-rows** layout (`ContactListContent.tsx:78-176`) — each row is a flexbox with avatar + name + role + status.
- `companies` uses a **CSS grid card layout** (`GridList.tsx:27-48`) — `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))`.
- `deals` uses **kanban columns** (see §9).
- Both share the same `<List>` wrapper — proof the split works.

### Loading states
- Desktop lists: `if (isPending) return null;` (`ContactList.tsx:59`) — they trust the `<Skeleton>` in `ContactListContent` to handle.
- Mobile lists: `useTimeout(1000)` + skeleton only after 1s to avoid flash (`ContactListContent.tsx:186-209`).

### Empty state (`ContactList.tsx:60-61` + `CompanyEmpty.tsx`)
```tsx
const hasFilters = filterValues && Object.keys(filterValues).length > 0;
if (!data?.length && !hasFilters) return <ContactEmpty />;
```
- If **zero records AND no filters applied** → rich empty state (`ContactEmpty`).
- If **zero records AND filters applied** → inline "No results" message inside the list.
- The distinction matters: onboarding empty state should teach, results-empty should let you clear filters.

### Deal layout (`DealList.tsx:86-115`)
```tsx
const DealLayout = () => {
  const location = useLocation();
  const matchCreate = matchPath("/deals/create", location.pathname);
  const matchShow = matchPath("/deals/:id/show", location.pathname);
  const matchEdit = matchPath("/deals/:id", location.pathname);
  // ...
  return (
    <div className="w-full">
      <DealListContent />          {/* the kanban */}
      <DealCreate open={!!matchCreate} />      {/* always-mounted, controlled by URL */}
      <DealEdit open={!!matchEdit && !matchCreate} id={matchEdit?.params.id} />
      <DealShow open={!!matchShow} id={matchShow?.params.id} />
    </div>
  );
};
```
- Create/Edit/Show dialogs are always mounted, their visibility derived from the current URL match. Closing a sheet pops back to `/deals` without unmounting. This is **how you keep form state when navigating with browser back** in a SPA — for Kavora this maps to "open create sheet via URL search param `?create=true`" with `nuqs` or `useSearchParams`.

---

## 6. Detail Page Patterns

### Two-column layout (`ContactShow.tsx:60-65` + `ContactEdit.tsx:43-58`)
- Both detail and edit use the same `<div className="mt-2 flex gap-8">` → primary content + aside.
- The aside (`ContactAside`) is a vertical stack of cards (info, related contacts, deals).

### Tab navigation driven by URL (`CompanyShow.tsx:97-107`)
```tsx
const tabMatch = useMatch("/companies/:id/show/:tab");
const currentTab = tabMatch?.params?.tab || "activity";

const handleTabChange = (value: string) => {
  if (value === currentTab) return;
  if (value === "activity") navigate(`/companies/${record?.id}/show`);
  else navigate(`/companies/${record?.id}/show/${value}`);
};

// ...
<Tabs defaultValue={currentTab} onValueChange={handleTabChange}>
  <TabsList className="grid w-full grid-cols-3">
    <TabsTrigger value="activity">Activity</TabsTrigger>
    <TabsTrigger value="contacts">{record.nb_contacts} contacts</TabsTrigger>
    {record.nb_deals ? <TabsTrigger value="deals">{record.nb_deals} deals</TabsTrigger> : null}
  </TabsList>
  <TabsContent value="activity">...</TabsContent>
  <TabsContent value="contacts">
    <ReferenceManyField reference="contacts_summary" target="company_id">
      ...
    </ReferenceManyField>
  </TabsContent>
</Tabs>
```
- Tab state IS the URL — refresh-safe, shareable, browser-back works.
- Conditional tab: `<TabsTrigger value="deals">{record.nb_deals ? ... : null}` — only render the tab if there's data.
- For Next.js: `useParams()` + `useRouter().push(`/companies/${id}/show/${tab}`)`; or use parallel routes (`@activity`, `@contacts`, `@deals`) for cleaner code.

### Mobile detail (`CompanyShow.tsx:55-89`)
- Completely different component (`CompanyShowContentMobile`).
- Header: `<MobileHeader><MobileBackButton to="/" /></MobileHeader>`.
- Body: vertical stack of info cards (`<CompanyInfo>`, `<AddressInfo>`, `<ContextInfo>`, `<AdditionalInfo>`) instead of tabs. Pattern: desktop tabs become mobile accordions/sections.
- The `useIsMobile()` hook decides which to render.

---

## 7. Form Patterns

### Form library: react-hook-form
- No Zod resolver. Validators are functions:
```tsx
<TextInput source="first_name" validate={required()} />
<TextInput source="last_name" validate={required()} />
<TextInput source="email_jsonb[].email" validate={email()} />
<TextInput source="linkedin_url" validate={isLinkedinUrl} />
```

### Form chrome (`ContactEdit.tsx:40-58`)
```tsx
const ContactEditContent = () => {
  const { isPending, record } = useEditContext<Contact>();
  if (isPending || !record) return null;
  return (
    <div className="mt-2 flex gap-8">
      <Form className="flex flex-1 flex-col gap-4" record={normalizeContactArrayFields(record)}>
        <Card>
          <CardContent>
            <ContactInputs />
            <FormToolbar />
          </CardContent>
        </Card>
      </Form>
      <ContactAside link="show" />
    </div>
  );
};
```
- `<Form>` from `ra-core` wraps react-hook-form; `record={record}` sets initial values.

### Sticky form toolbar (`layout/FormToolbar.tsx:4-12`)
```tsx
export const FormToolbar = () => (
  <div role="toolbar" className="sticky flex pt-4 pb-4 md:pb-0 bottom-0 bg-linear-to-b from-transparent to-card to-10% flex-row justify-end gap-2">
    <CancelButton />
    <SaveButton />
  </div>
);
```
- `role="toolbar"` for screen readers.
- `sticky bottom-0` with a subtle bottom gradient → "Save" always reachable.
- For Kavora: copy this exactly. Works in any shadcn `<form>`.

### Field arrays (`ContactInputs.tsx:145-197`)
```tsx
<ArrayInput source="email_jsonb" helperText={false}>
  <SimpleFormIterator inline disableReordering disableClear className="[&>ul>li]:border-b-0 [&>ul>li]:pb-0">
    <TextInput source="email" className="w-full" helperText={false} label={false} placeholder="Email" validate={email()} />
    <SelectInput source="type" className="w-24 min-w-24" choices={personalInfoTypes} defaultValue="Work" />
  </SimpleFormIterator>
</ArrayInput>
```
- `inline` lays out as a horizontal row (email + type dropdown).
- `disableReordering` removes drag handles when not needed.
- Mirrors RHF's `useFieldArray` API but with declarative JSON schema.
- For Kavora + react-hook-form: `useFieldArray({ name: "emails" })` + `<Input>` per index. Same UX, less magic.

### Smart autofill from paste (`ContactInputs.tsx:114-138`)
```ts
const { getValues, setValue } = useFormContext();
const handleEmailChange = (email: string) => {
  const { first_name, last_name } = getValues();
  if (first_name || last_name || !email) return;
  const [first, last] = email.split("@")[0].split(".");
  setValue("first_name", first.charAt(0).toUpperCase() + first.slice(1));
  setValue("last_name", last ? last.charAt(0).toUpperCase() + last.slice(1) : "");
};

const handleEmailPaste: ClipboardEventHandler<...> = (e) => {
  const email = e.clipboardData?.getData("text/plain");
  handleEmailChange(email);
};

const handleEmailBlur = (e: FocusEvent<...>) => {
  const email = e.target.value;
  handleEmailChange(email);
};

// <TextInput source="email" onPaste={handleEmailPaste} onBlur={handleEmailBlur} />
```
- Tiny UX touch worth lifting: paste an email like `john.doe@acme.com` into the email field and first/last names auto-fill.

### Optimistic field updates (`ContactInputs.tsx:243-269`)
```ts
const handleStatusChange = (nextStatus: string) => {
  if (nextStatus === record?.status) return;
  update("contacts", {
    id: record.id,
    data: { status: nextStatus },
    previousData: record,
  }, {
    mutationMode: "optimistic",
    onError: (error) => notify(...),
  });
};
```
- A single `<Select>` on the contact card updates the DB optimistically. No save button needed for "status"-class fields. Pattern: high-frequency low-risk fields get optimistic mutation; complex forms get save/cancel.

---

## 8. shadcn/ui Usage

They use **stock shadcn/ui** plus 14 Radix primitives. No custom `cva` variants beyond what's in stock shadcn.

### Primitives present (`src/components/ui/`)
`accordion, alert, avatar, badge, breadcrumb, button, card, checkbox, command, dialog, drawer, dropdown-menu, input, item, label, navigation-menu, pagination, popover, progress, radio-group, select, separator, sheet, sidebar, skeleton, sonner, spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip`

That's a complete shadcn/ui registry — every primitive you'd want for a CRM is here. **Kavora should generate the same set via `npx shadcn@latest add ...`**.

### Heavy-use primitives
- **Sheet** (`CreateSheet`/`EditSheet`) for all create/edit flows.
- **Dialog** (`DataImportDialog`) for modal flows that need a `Select` + `FileInput`.
- **Drawer** (Vaul) for mobile navigation patterns.
- **Sidebar** (`AppSidebar`) for nav chrome.
- **Command** (`cmdk`) — declared but no current story uses it. Opportunity.
- **Sonner** for notifications (see §12).

### Custom variants
- Almost none — they import `Button as is`. `Button` has stock variants; `Badge` is used a lot for status pills.
- Status-specific styling lives in `<Status>` (`misc/Status.tsx`) which takes a `status: string` prop and renders a colored Badge based on a status config. Worth replicating for Kavora's deal stages, contact statuses, etc.

### Theming
- Tailwind v4 with `tw-animate-css` plugin (animations) and CSS variables for colors.
- `Sidebar` ships with CSS custom properties `--sidebar-width` etc.
- No `themes/` folder. Theme is hardcoded in `index.css`.

---

## 9. Drag & Drop

### Library: `@hello-pangea/dnd` (`package.json:31`)

### Kanban pattern (`DealListContent.tsx` + `DealColumn.tsx` + `DealCard.tsx`)
Three-component split:
- `DragDropContext` (`DealListContent.tsx:74-84`): owns `onDragEnd` handler.
- `Droppable` (`DealColumn.tsx:33-48`): wraps each column, exposes `droppableProvided.innerRef`.
- `Draggable` (`DealCard.tsx:16-21`): wraps each card.

### Optimistic reorder with rebalancing (`DealListContent.tsx:88-244`)

The full drag algorithm (commented inline `// deal moved up, eg\n// dest src\n//  <------\n// [4, 7, 23, 5]`). The rebalancing logic:
- Each card has a numeric `index` field.
- On drop: fetch all deals in source column + destination column (always fetch full unfiltered column so hidden deals stay consistent).
- Shift indexes of deals between source.index and destination.index.
- Update the dragged deal's `index` + `stage`.
- This is correct but heavy (N round-trips per drop). For Kavora: replicate but use a **single batched Server Action** or `UPDATE deals SET index = index - 1 WHERE stage = ? AND index BETWEEN ? AND ?` instead of N individual updates.

```ts
const onDragEnd: OnDragEndResponder = (result) => {
  const { destination, source } = result;
  if (!destination) return;
  if (destination.droppableId === source.droppableId && destination.index === source.index) return;

  const sourceDeal = dealsByStage[source.droppableId][source.index]!;
  const destinationDeal = dealsByStage[destination.droppableId][destination.index] ?? {
    stage: destination.droppableId,
    index: undefined,
  };

  // Optimistic local update (so the card moves immediately)
  setDealsByStage(updateDealStageLocal(sourceDeal, { ... }, { ... }, dealsByStage));

  // Persist
  updateDealStage(sourceDeal, destinationDeal, dataProvider).then(() => refetch());
};
```

### Visual feedback (`DealCard.tsx:50-55`)
```tsx
<Card className={`py-3 transition-all duration-200 ${
  snapshot?.isDragging
    ? "opacity-90 transform rotate-1 shadow-lg"
    : "shadow-sm hover:shadow-md"
}`}>
```
- Dragged card: `rotate-1 shadow-lg`. Other cards: `shadow-sm hover:shadow-md`.
- Column highlight (`DealColumn.tsx:38-40`): `snapshot.isDraggingOver ? "bg-muted" : ""`.

---

## 10. Modal / Drawer / Sheet

### Decision matrix (observed in repo)
- **Create / Edit full form**: bottom Sheet (mobile) or full-page route (desktop). Both via `CreateSheet` / `EditSheet` (`misc/CreateSheet.tsx`, `misc/EditSheet.tsx`).
- **Confirmation / quick form**: Dialog (`DataImportDialog.tsx`).
- **Mobile navigation**: Drawer (Vaul) triggered from topbar hamburger.

### Sheet component (`misc/EditSheet.tsx:84-173`)
```tsx
<Sheet open={open} onOpenChange={onOpenChange}>
  <SheetContent side="bottom" className="h-dvh flex flex-col" aria-describedby={undefined}>
    <EditBase {...editBaseProps} redirect={redirectTo} mutationOptions={enhancedMutationOptions} mutationMode={mutationMode}>
      <Form defaultValues={defaultValues} className="h-dvh flex-1 flex flex-col">
        <SheetHeader className="border-b">...</SheetHeader>
        <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-4">{children}</div>
        <SheetFooter className="border-t flex flex-row w-full gap-4">
          <SaveButton className="flex-1 h-12" />
        </SheetFooter>
      </Form>
    </EditBase>
  </SheetContent>
</Sheet>
```
- `side="bottom"` on mobile, but always full-height (`h-dvh`).
- `aria-describedby={undefined}` — Dialog primitive complains about missing description on a Sheet.
- Auto-close on success: `onSuccess` callback calls `onOpenChange(false)` after `redirect()`.

### Sheet trigger pattern (`ContactCreateSheet.tsx:15-37`)
```tsx
export const ContactCreateSheet = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { identity } = useGetIdentity();
  return (
    <CreateSheet
      resource="contacts"
      title={translate("resources.contacts.action.new")}
      defaultValues={{
        sales_id: identity?.id,
        email_jsonb: defaultEmailJsonb,
        phone_jsonb: defaultPhoneJsonb,
      }}
      transform={cleanupContactForCreate}
      open={open}
      onOpenChange={onOpenChange}
    >
      <ContactInputs />
    </CreateSheet>
  );
};
```
- Pattern: each entity has a `*CreateSheet` wrapper that hard-codes `resource`, `defaultValues`, and `transform`. Consumers just toggle `open`/`onOpenChange`.
- For Kavora: build `app/(dashboard)/contacts/_components/CreateContactSheet.tsx` with the same props.

### Dialog (`DataImportDialog.tsx:42-146`)
```tsx
<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
  <DialogContent className="max-w-[calc(100%-2rem)] gap-6 p-6 sm:max-w-2xl sm:p-8">
    <Form key={resource.name} className="flex flex-col gap-6">  {/* key resets form on resource switch */}
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      ... <FileInput source="csv" accept={{ "text/csv": [".csv"] }} onChange={setFile}>
              <FileField source="src" title="title" target="_blank" />
            </FileInput>
    </Form>
    <div className="flex justify-start">
      <FormToolbar>
        <Button onClick={handleStart} disabled={!file}>{translate("crm.data_import.start")}</Button>
      </FormToolbar>
    </div>
  </DialogContent>
</Dialog>
```
- `key={resource.name}` resets the form when the dropdown selection changes.
- Inline `<Alert>` showing sample CSV download link.

---

## 11. Empty / Loading / Error States

### Loading — the `useTimeout` pattern (`ContactListContent.tsx:186-209`, `TasksListByDueDate.tsx:88-96`)
```tsx
const oneSecondHasPassed = useTimeout(1000);

if (isPending) {
  if (!oneSecondHasPassed) return null;        // Hide skeleton if load is fast
  return ( /* 5 skeleton rows */ );
}
```
- Don't flash a spinner if data loads in <1s. Returns `null` instead.

### Skeleton list pattern (`ContactListContent.tsx:194-207`)
```tsx
{[...Array(5)].map((_, index) => (
  <div key={index} className="flex flex-row items-center py-2 ...">
    <Skeleton className="w-10 h-10 rounded-full" />
    <div className="flex-1 min-w-0">
      <Skeleton className="w-32 h-5 mb-2" />
      <Skeleton className="w-48 h-4" />
    </div>
  </div>
))}
```
- Match the actual row's shape (avatar + 2 text lines). Don't use a generic spinner.

### Error + retry (`ContactListContent.tsx:212-230`)
```tsx
if (error && !contacts) {
  return (
    <div className="p-4">
      <div className="text-center text-muted-foreground mb-4">
        {translate("resources.contacts.list.error_loading")}
      </div>
      <div className="text-center mt-2">
        <Button onClick={() => refetch()}>
          <RotateCcw />
          {translate("crm.common.retry")}
        </Button>
      </div>
    </div>
  );
}
```
- Show error only when there's no cached data to display. If `error && contacts` (stale), render the stale data.

### Onboarding empty state (`DashboardStepper.tsx:32-164`)
- Multi-step progress (`<Progress value={(step / 3) * 100} />`).
- Each step: `<CheckCircle />` if done, `<Circle />` if pending.
- Final step's CTA opens a `<ContactCreateSheet>` or `<NoteCreateSheet>` rather than navigating.
- The dashboard itself picks which step to show based on what data exists (`Dashboard.tsx:38-44`):
```tsx
if (!totalContact) return <DashboardStepper step={1} />;
if (!totalContactNotes) return <DashboardStepper step={2} contactId={dataContact?.[0]?.id} />;
return /* full dashboard */;
```
- Replicate this for Kavora: empty CRM → "add your first contact" → "log your first activity" → full dashboard.

### Rich empty state (`DealEmpty.tsx:28-72`)
```tsx
<div className="flex flex-col justify-center items-center gap-12" style={{ height: `calc(100dvh - ${appbarHeight}px)` }}>
  <img src="./img/empty.svg" alt={translate("resources.deals.empty.title")} />
  ...
  <div className="flex space-x-8">
    <CreateButton label="resources.deals.action.create" />
    <DataImportButton resource="deals" />
  </div>
</div>
```
- Full-viewport height, image + headline + 2 CTAs.
- Conditional content: if there are no contacts yet, the empty state tells you to "add a contact first" instead of offering a Deal create button.

### Async-storage `appbarHeight` (`misc/useAppBarHeight.ts`)
- Computes the top header height to subtract from viewport so empty states fill the remaining space.

---

## 12. Notifications / Toast

### Sonner wrapper (`admin/notification.tsx:34-118`)
```tsx
export const Notification = (props: ToasterProps) => {
  const { notifications, takeNotification } = useNotificationContext();
  const takeMutation = useTakeUndoableMutation();
  const { theme } = useTheme();

  useEffect(() => {
    if (notifications.length) {
      const notification = takeNotification();
      if (notification) {
        const { message, type = "info", notificationOptions } = notification;
        const { messageArgs, undoable, autoHideDuration } = notificationOptions || {};
        // ... beforeunload guard for undoable mutations

        const mutation = takeMutation();

        const handleExited = () => {
          if (undoable && mutation) mutation({ isUndo: false });
          window.removeEventListener("beforeunload", beforeunload);
        };

        const handleUndo = () => {
          if (mutation) mutation({ isUndo: true });
          window.removeEventListener("beforeunload", beforeunload);
        };

        toast[type](finalMessage, {
          duration: autoHideDuration === null ? Infinity : autoHideDuration,
          action: undoable ? { label: translate("ra.action.undo"), onClick: handleUndo } : undefined,
          onDismiss: handleExited,
          onAutoClose: handleExited,
        });
      }
    }
  }, [notifications, takeMutation, takeNotification, translate]);

  return (
    <CloseNotificationContext.Provider value={() => toast.dismiss()}>
      <Toaster richColors theme={theme} closeButton position="bottom-center" {...props} />
    </CloseNotificationContext.Provider>
  );
};
```
- Three key features on top of stock Sonner:
  1. **Translation**: `message` can be a i18n key, gets resolved via `useTranslate()`.
  2. **Undo support**: any `useDelete` with `mutationMode: "undoable"` automatically gets an "Undo" button in the toast that re-runs the inverse mutation.
  3. **beforeunload guard**: while an undo toast is showing, prevents the user from accidentally navigating away and losing the undo.
- `<Toaster richColors closeButton position="bottom-center" />` is positioned bottom-center — out of the way of CTAs.

### Caller pattern (`Note.tsx:67`)
```ts
notify("resources.notes.deleted", {
  type: "info",
  undoable: true,
  messageArgs: { _: "Note deleted" },
});
```
- Pass the i18n key, fallback string in `_`, and any smart_count for pluralization.

### For Kavora
- Don't try to reimplement undo in Sonner. Lift this exact `Notification` wrapper as-is. Replace the `useNotificationContext` source with a thin Zustand store (or React Context) that mirrors the same API.
- Sonner setup: `npm i sonner`, then in `app/layout.tsx`:
```tsx
import { Toaster } from "sonner";
<Toaster richColors closeButton position="bottom-center" />
```
- Use `toast.promise(myAction(), { loading: "...", success: "...", error: "..." })` for multi-state toasts.

---

## 13. Auth & Route Guards

### Auth provider (`providers/supabase/authProvider.ts:91-171`)
```ts
export const getAuthProvider = (): AuthProvider => ({
  ...baseAuthProvider,
  login: async (params) => {
    if (params.ssoDomain) {
      const { error } = await getSupabaseClient().auth.signInWithSSO({ domain: params.ssoDomain });
      if (error) throw error;
      return;
    }
    return baseAuthProvider.login(params);
  },
  logout: async (params) => {
    clearCache();    // clears localStorage caches for is_initialized + current_sale
    return baseAuthProvider.logout(params);
  },
  checkAuth: async (params) => {
    if (window.location.pathname === "/set-password" || ...) return;  // bypass
    if (window.location.pathname === "/forgot-password" || ...) return;
    if (window.location.pathname === "/sign-up" || ...) return;

    const isInitialized = await getIsInitialized();
    if (!isInitialized) {
      await getSupabaseClient().auth.signOut();
      throw { redirectTo: "/sign-up", message: false };   // force signup if no users exist
    }
    return baseAuthProvider.checkAuth(params);
  },
  canAccess: async (params) => {
    const sale = await getSale();
    if (sale == null) return false;
    const role = sale.administrator ? "admin" : "user";
    return canAccess(role, params);
  },
  // ... OAuth consent helpers
});
```
- `canAccess` reads `sale.administrator` from the user record and delegates to a pure `canAccess(role, params)` function (`commons/canAccess.ts`). Simple RBAC, no JWT claims.
- `isInitialized` flag — a flag in the `init_state` table that signals "first user signed up; redirect everyone else to login". Cached in `localStorage` (`IS_INITIALIZED_CACHE_KEY`).
- `current_sale` cache avoids re-fetching the user on every `checkAuth` call.

### Localstorage caching (lines 24-89)
- Two keys: `RaStore.auth.is_initialized`, `RaStore.auth.current_sale`.
- Cleared on logout.
- Survives full page reloads.

### Login page (`login/LoginPage.tsx:24-156`)
- Split layout: 2-column on `lg:`, single column below.
- Left: dark `bg-zinc-900` panel with logo + branding.
- Right: 350px-wide centered form on `lg:`, full width below.
- Google Workspace SSO button rendered conditionally on `googleWorkplaceDomain`.
- Error notification on `login` rejection via `useNotify()`.

### For Kavora
- Next.js App Router: auth gate via middleware.ts checking Supabase session cookie. Redirect unauthenticated users from `/dashboard/*` to `/login`. Already a standard pattern.
- RBAC: a `canAccess(role, params)` pure function on the server, plus a server-side `<RequireRole>` wrapper for protected pages. Don't replicate the localStorage caching (Server Components handle re-fetch cheaply).

---

## 14. Realtime

**Not implemented.** Confirmed by:
- `grep -rn "channel\|postgres_changes\|subscription" src/` → no hits
- No `supabase.channel()` or `realtime` usage anywhere.

All updates are pull-based after mutations (TanStack Query invalidation). For a notification feed or "X is editing this row right now" UX, Kavora would need to add Supabase Realtime separately. Patterns worth researching (not in this repo):
- `supabase.channel('contacts').on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, payload => queryClient.invalidateQueries(['contacts']))`
- `useChannel` hook wrapping `supabase.channel().subscribe()` with React lifecycle.

---

## 15. Testing Strategy

### Unit / Component tests: Vitest + browser
- `vitest.config.ts:32-55` configures real-browser tests via `@vitest/browser-playwright` (Chromium).
- Custom CDP `setTimezone` command — the timezone is overridable per-test, useful for testing date-relative UI ("today", "this week").
- Test files are colocated (`*.test.tsx` next to source). Examples:
  - `src/components/atomic-crm/contacts/ContactList.test.tsx` (uses `StoryWrapper`)
  - `src/components/atomic-crm/dataImport/DataImport.test.tsx`
  - `src/components/atomic-crm/providers/commons/i18nProvider.test.ts`

### Test wrapper (`src/test/StoryWrapper.tsx`)
- A single component that wraps everything a Story or test needs: Admin context, data provider, auth, theme, notifications.
- Reused for both Storybook stories and Vitest unit tests.

### Mocking Supabase
- They use the `fakerest` data provider (`providers/fakerest/dataProvider.ts`) in tests and stories — generates fake data with `@faker-js/faker`.
- Tests don't mock Supabase; they swap in the fake REST provider entirely.

### E2E: Playwright (`e2e/`)
- 5 specs: `adminAccountManagerFilter.spec.ts`, `bulkContactTags.spec.ts`, `onboarding.spec.ts`, `userAddingATask.spec.ts`, plus `fixtures.ts`.
- `playwright.config.ts` (not deeply reviewed) presumably points at the demo build.

### Test pyramid (observed)
- Unit + component tests are the bulk (colocated `*.test.tsx`).
- ~5 E2E specs covering critical user journeys (onboarding, bulk actions, filtering, task creation).
- No snapshot tests.

### For Kavora
- Vitest + browser mode (Chromium) is the same setup. Consider copying the timezone override CDP helper.
- The `StoryWrapper` + shared `fakerest` provider is the elegant piece — stories and tests share one render harness. For Kavora: build a `<TestProviders>` server component that injects Drizzle fixtures.

---

## 16. Storybook

### Configuration (`.storybook/main.ts`)
```ts
stories: ["../src/**/*.stories.@(ts|tsx)"],
addons: [],
framework: { name: "@storybook/react-vite" },
viteFinal: (config) => { ...config.resolve.alias["@"] = path.resolve(__dirname, "../src"); return config; }
```
- Zero addons — they didn't even install the a11y addon. `preview.ts` only sets `layout: "fullscreen"`.

### Story convention
- Co-located `*.stories.tsx` files (e.g. `ContactList.stories.tsx` next to `ContactList.tsx`).
- Stories use `StoryWrapper` (`src/test/StoryWrapper.tsx`) to get Admin context.
- Many stories also double as test fixtures (`*.test.tsx`).

### Component contract via JSDoc
- Every component has a `@example` block in its JSDoc. E.g. `UserMenu.tsx`, `List.tsx`, `DataTable.tsx`.
- This acts as a soft "contract doc" — devs copy-paste the example into a story.

### For Kavora
- Adopt the colocation convention: `components/contacts-table.stories.tsx` next to `contacts-table.tsx`.
- Add `@storybook/addon-a11y` (they didn't) for accessibility auditing.
- Adopt the `@example` JSDoc convention.

---

## 17. Theming & Accessibility

### Dark mode (`admin/theme-mode-toggle.tsx`, `admin/theme-provider.tsx`, `admin/theme-context.ts`)
- Three modes: `light`, `dark`, `system`.
- Implementation: `useStore<Theme>("theme", "system")` (persisted to localStorage via `ra-core`'s store) → `useEffect` adds `light`/`dark` class to `document.documentElement`.
- `useTheme()` returns `{ theme, setTheme }` — context-based.
- Sonner's `<Toaster theme={theme}>` adapts to current theme.
- No `next-themes` actually used despite the dep — they rolled their own.

### Color tokens
- Tailwind v4 CSS variables in `index.css` (e.g. `--background`, `--foreground`, `--primary`, `--muted`, `--muted-foreground`, `--border`).
- Charts (`DealsChart.tsx:128-141`) read directly from `var(--color-muted-foreground)` so charts respect the theme.

### Sidebar CSS variables (`ui/sidebar.tsx:28-31`)
```ts
const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"
```
- Cookie `sidebar_state` persists expanded/collapsed.
- `Cmd/Ctrl+B` toggles.

### Accessibility observations
- `role="toolbar"` on `FormToolbar`.
- `aria-label` on icon-only buttons (`Task.tsx:158`).
- `aria-describedby={undefined}` on Sheet (`EditSheet.tsx:133`) — Radix Sheet complains about missing description.
- `sr-only` close button label on Sheet (`sheet.tsx:74-75`).
- Sheet has `focus-visible:ring-2` on close button.
- **`@radix-ui/react-tooltip` everywhere** for icon-only actions.
- **`<TooltipProvider>` wraps each interactive block individually** rather than the whole app — slight perf cost but more localized.
- No global skip-to-content link observed.

### For Kavora
- Adopt CSS variables approach (Tailwind v4 in shadcn/ui does this out of the box).
- Adopt `<TooltipProvider>` per interactive block.
- Add a skip-link in `app/layout.tsx`.
- Consider `@radix-ui/react-visually-hidden` for icon-only buttons.

---

## 18. What to Borrow for Kavora

| # | Pattern | Reference | Effort | Why for Kavora |
|---|---|---|---|---|
| 1 | **`<Sidebar variant="floating" collapsible="icon">` with `Cmd/Ctrl+B`** | `ui/sidebar.tsx:54-87`, `admin/app-sidebar.tsx:38-87` | S | Production-ready chrome. Cookie-persists state, mobile-aware, full keyboard nav. Drop into a Next.js client component in 30 min. |
| 2 | **`useIsMobile()` + render different content, not different CSS** | `hooks/use-mobile.ts`, `CRM.tsx:233-340` (separate `<DesktopAdmin>` and `<MobileAdmin>`) | M | We currently try to make every component responsive. A "mobile variant" per page (different layout, same data) is much less fighting with Tailwind. |
| 3 | **`<List>` + `<ListContent>` split** | `contacts/ContactList.tsx:36-76` + `ContactListContent.tsx:26-98` | S | Lets us swap table vs card grid vs mobile rows without rewriting data fetching. |
| 4 | **`Sheet` (`side="bottom"`) as the create/edit form container, with `aria-describedby={undefined}`** | `misc/EditSheet.tsx:84-173`, `misc/CreateSheet.tsx` | S | Save + Cancel lives in a sticky footer; closing on success auto-pops back to list. shadcn `<Sheet>` works as-is. |
| 5 | **`BulkActionsToolbar` as a fixed bottom-center Card** | `admin/bulk-actions-toolbar.tsx:50-85` | S | Tiny UX win: appears only when rows selected, fixed bottom, doesn't push page content. |
| 6 | **Toggle-filter sidebar with PostgREST-style operators (`@gte`, `@cs`, etc.) + pill summary on mobile** | `contacts/ContactListFilter.tsx:20-267`, `misc/ActiveFilterButton.tsx` | M | Translate operators to Drizzle `and(gte(...), contains(...))`. Pill summary using `lodash/matches` for deep compare is reusable as-is. |
| 7 | **Sonner wrapper with undo support + beforeunload guard** | `admin/notification.tsx:34-118` | S | Lift verbatim. Every destructive action becomes undoable with ~2 extra lines. |
| 8 | **`useTimeout(1000)` to avoid skeleton flash** | `ContactListContent.tsx:186-209`, `TasksListByDueDate.tsx:88-96` | S | Don't show a skeleton if the data loads fast. Returns `null` for the first second, skeleton after. |
| 9 | **Sticky bottom form toolbar with gradient** | `layout/FormToolbar.tsx:4-12` | S | "Save" is always reachable on long forms. One `<div>` to copy. |
| 10 | **Onboarding `DashboardStepper`** | `dashboard/DashboardStepper.tsx:32-164` | M | Multi-step "what to do next" empty state. Picks which step to show based on what data exists. Perfect first-run UX. |
| 11 | **`@hello-pangea/dnd` kanban with optimistic local state** | `deals/DealListContent.tsx:33-71` + `DealCard.tsx`, `DealColumn.tsx` | M | Reuse for Kavora's pipeline view. Replace the N-update loop with a single batched Server Action. |
| 12 | **`@tanstack/react-query` + `PersistQueryClientProvider` for offline-tolerant lists** | `CRM.tsx:294-301`, `ContactListMobile.tsx:101-114` | M | Mobile users on flaky networks get cached data. Wire to a Next.js Server Action cache key strategy. |
| 13 | **Tab state IS the URL** | `companies/CompanyShow.tsx:97-107` | S | Replace with Next.js `useParams` + `router.push()`. Refresh-safe, shareable. |
| 14 | **Shift-click range select** | `contacts/ContactListContent.tsx:39-68` | S | Lift the `lastSelected.current` + `lodash/difference, union` pattern. |
| 15 | **Smart autofill from email paste** | `contacts/ContactInputs.tsx:114-138` | S | 25 lines, delightful UX. Adapt to "company name → logo fetch" or similar. |
| 16 | **Always-mounted dialogs/sheets driven by URL match** | `deals/DealList.tsx:86-115` (`matchPath` + `matchCreate`) | S | Closing a sheet pops back to the list URL without unmounting the dialog. Implementable via `useSearchParams` + `?create=true`. |

---

## 19. What to Skip

| Pattern | Why skip for Kavora |
|---|---|
| `ra-core` `dataProvider` abstraction, `<Resource>`, `<EditBase>`, `<ShowBase>`, `<ListBase>`, `useGetList`, `useUpdate`, `RecordContextProvider`, `ResourceContext` | Next.js Server Components + Server Actions + Drizzle is the equivalent. Don't try to replicate the abstraction; just borrow the *shapes* (e.g. `DataTable`'s column-sort / row-select API). |
| `react-router` v7 routes declared in `<CRM>` via `<Resource>` / `<CustomRoutes>` | App Router file-system routing replaces this. |
| `email_jsonb` / `phone_jsonb` JSONB columns | Normalize into `contact_emails` and `contact_phones` tables — easier queries, easier validation, easier exports. |
| `@nivo/bar` chart library (~200kB gzipped) | Use Recharts or Tremor. Lighter, better React integration. |
| Two entirely separate `<DesktopAdmin>` and `<MobileAdmin>` components | Our route groups can share a single component tree. Use `useIsMobile()` only where layouts truly differ (e.g. sidebar). |
| `localStorage` caching of `isInitialized` and `current_sale` | Server Components + Supabase session cookies give us this for free. Don't reimplement. |
| `withLifecycleCallbacks` from `ra-core` | Next.js middleware + Server Actions + Drizzle triggers are the equivalents. |
| `@supabase/supabase-js` direct usage in components | Use a thin wrapper (`lib/supabase/server.ts` for cookies, `lib/supabase/client.ts` for browser). They put the raw client in components. |
| `lodash` everywhere | Most uses (`matches`, `pickBy`, `union`, `difference`, `get`, `isEqual`) are ~5 lines each. Bundle size win is ~70kB. |
| `react-i18n-polyglot` | We already have `next-intl`. |
| `next-themes` | They declared it but didn't use it. We can skip. |

---

## 20. Open Questions

1. **Supabase Realtime** — atomic-crm deliberately omits it. Kavora's "activity feed" use case probably needs it. Need a separate spike: what's the cost (connection limits, RLS overhead), and does it play nicely with RSC?
2. **Multi-tenancy / row-level security** — atomic-crm uses Supabase RLS implicitly (all queries go through `supabaseDataProvider`), but there's no org-switcher UI. Kavora needs this; need to design the `current_org_id` cookie pattern.
3. **Optimistic update batching for drag-reorder** — their `updateDealStage` issues N updates per drop. For Kavora, what does a batched Server Action for this look like with Drizzle's `db.update().where(between(...))`?
4. **Server Component data fetching equivalents** — every component in atomic-crm calls `useGetList` (client). Kavora's pages should fetch via RSC and pass data down. What's the boundary? (Likely: top-level route fetches via RSC → pass as props → client components for interactions only.)
5. **shadcn-admin-kit as a paid product** — many components are from a paid Marmelab product. The free OSS repo (`shadcn-admin-kit` on GitHub) ships some of them. We can copy the open-source ones verbatim. Worth auditing which are MIT vs paid.
6. **Form library choice** — atomic-crm uses `react-hook-form` without Zod. Kavora already uses RHF + Zod. Their form component primitives (`<TextInput>`, `<SelectInput>`, etc.) wrap RHF — we can build shadcn-flavored equivalents on top of our existing setup.
7. **`RecordRepresentation` / `RecordContext`** — atomic-crm leans on these for "show this record's name wherever it appears". For Kavora with Server Components, the equivalent is just passing `displayName` as a prop computed from the fetched record. No provider needed.

---

## File reference index (for the next reader)

The most useful files to skim first, in order:

1. `src/App.tsx` — entry point (10 lines)
2. `src/components/atomic-crm/root/CRM.tsx` — top-level composition (340 lines)
3. `src/components/admin/layout.tsx` — dashboard chrome
4. `src/components/admin/app-sidebar.tsx` — sidebar nav
5. `src/components/admin/list.tsx` — list page wrapper + empty state
6. `src/components/admin/data-table.tsx` — table primitive with sort/select/columns
7. `src/components/admin/notification.tsx` — Sonner wrapper with undo
8. `src/components/atomic-crm/contacts/ContactList.tsx` — list page composition
9. `src/components/atomic-crm/contacts/ContactListContent.tsx` — list rows + shift-click + skeletons
10. `src/components/atomic-crm/contacts/ContactListFilter.tsx` — filter sidebar + pill summary
11. `src/components/atomic-crm/contacts/ContactShow.tsx` — detail page layout + tabs
12. `src/components/atomic-crm/contacts/ContactEdit.tsx` + `ContactInputs.tsx` — form patterns
13. `src/components/atomic-crm/deals/DealListContent.tsx` + `DealCard.tsx` + `DealColumn.tsx` — kanban
14. `src/components/atomic-crm/dataImport/DataImportDialog.tsx` — full dialog example
15. `src/components/atomic-crm/login/LoginPage.tsx` — auth UI
16. `src/components/atomic-crm/providers/supabase/dataProvider.ts` — Supabase data wiring
17. `src/components/atomic-crm/providers/supabase/authProvider.ts` — Supabase auth wiring
18. `src/components/atomic-crm/dashboard/DashboardStepper.tsx` — onboarding UX
19. `src/components/ui/sidebar.tsx` — shadcn sidebar (768 lines)
20. `vite.config.ts` + `vitest.config.ts` — build + test setup
