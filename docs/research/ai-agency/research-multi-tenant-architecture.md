# Kavora CRM — Multi-Tenant Architecture Research

**Date:** 2026-09-24
**Audience:** Lionel (Kavora Systems / AI automation agency)
**Scope:** Patterns, tradeoffs, and migration path to convert the single-tenant Kavora CRM into a multi-tenant platform serving 5–20+ clients (eventually 100+).

---

## 1. Executive summary

- **Data isolation: Row-Level Security (RLS) on a shared schema.** Supabase exposes this; every Kavora table already carries `orgId`. Lowest-effort, lowest-cost path that scales to 100+ tenants without ballooning Postgres billing.
- **Auth: Keep Clerk, enable Clerk Organizations.** The existing Clerk webhook already syncs users; adding Clerk Orgs gives an "Active Organization" concept without changing the DB model.
- **Twilio: per-tenant subaccount.** Isolates billing + TCPA/10DLC regulatory footprint per client; one credential leak doesn't expose every customer.
- **LLM keys (Anthropic / OpenAI / Voyage / Deepgram):** shared by default, optional per-tenant override in `organizations` for clients who bring their own credits or want usage isolation.
- **Effort: ~3–5 working days (1 dev), 18–25 commits, ~30–45 files.** Top risks: missed RLS policies (current schema has none enabled) and rewriting the Twilio webhook to look up the right subaccount by `To` number.

---

## 2. Data isolation pattern comparison

| Pattern | Isolation strength | Cost model | Migration effort | Operational risk |
|---|---|---|---|---|
| **Row-Level Security (RLS)** on shared schema | Strong *if* policies are correct. Postgres rejects row reads that violate the policy for the connected role. ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security)) | One DB — Supabase Pro/Team bills per project, not per tenant. 100 tenants ≈ cost of 1. | **Low.** Schema already shaped for it (`orgId` on every table). | High *if* you forget `where orgId = current_org()` on a hand-rolled query. |
| **Schema-per-tenant** | Strong (cross-tenant joins impossible). Postgres schemas namespace objects inside one DB ([PostgreSQL schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)). | Same single DB. Cost = dev ergonomics; ORM qualifies `tenant.contacts`. | **High.** Rewrite every Drizzle query to use `search_path` switching or schema-qualified names; migrations per schema. | Medium. `search_path` injection is a real footgun; `SET LOCAL search_path` inside a transaction is the safe pattern. |
| **Database-per-tenant** | Strongest (separate Postgres processes). | **Worst.** Supabase charges per project; each tenant = one project = one bill. 100 clients untenable without high revenue per client. | **Highest.** Connection pooler, migrations, backups, observability all fan out. | Highest. Operational toil grows linearly. |

**Recommendation: RLS.** The schema was *deliberately* pre-wired with `orgId` on every table ([schema.ts:80-91](https://github.com/Kavora-Systems/kavora-crm/blob/main/src/db/schema.ts)) and ARCHITECTURE.md already anticipates this move. RLS gives you one connection pool, one `pgvector` index, zero fan-out for Trigger.dev jobs. Move to schema-per-tenant only if you sign clients with hard regulatory isolation requirements (e.g., healthcare) — at which point the cost is justified.

---

## 3. Auth comparison

| Provider | Multi-tenant model | Org switcher UX | Invite flow | Pricing for agencies |
|---|---|---|---|---|
| **Clerk Organizations** | First-class. Active org concept; user can belong to many orgs. Policies, roles, verified-domain auto-join. ([Clerk Organizations](https://clerk.com/docs/guides/organizations/overview)) | `<OrganizationSwitcher />` component, polished UX. | Invite links with email verification, role assignment, SSO via Verified Domains. | Per-MAU + Organizations is a paid add-on (~$0.30/org/mo on production tiers). Predictable. |
| **Auth0 Organizations** | First-class. Orgs live inside one Auth0 *tenant*; per-org branding, connections, members, roles. ([Auth0 Organizations](https://auth0.com/docs/manage-users/organizations)) | Custom — build yourself or use Universal Login + RBAC. | Same primitives. | B2B pricing is enterprise sales-driven; more expensive than Clerk at low tenant counts. |
| **Supabase Auth** | No first-class org primitive — model `organizations` yourself. | DIY: cookie + middleware + dropdown. | DIY. | Cheapest (free up to 50k MAU on Pro), but you re-implement the switcher, invites, SSO. |

**Recommendation: keep Clerk, turn on Organizations.** The Clerk SDK is already wired (`@clerk/nextjs` in [package.json](https://github.com/Kavora-Systems/kavora-crm/blob/main/package.json)) and the webhook at `src/app/api/webhooks/clerk/route.ts` already syncs users. Adding Clerk Orgs means: (a) enabling the Organizations plugin in the Clerk dashboard, (b) reading `org_id` from the session JWT instead of hardcoding "kavora" in `KAVORA_ORG_ID` ([schema.ts:813](https://github.com/Kavora-Systems/kavora-crm/blob/main/src/db/schema.ts)), (c) rendering `<OrganizationSwitcher />` in the dashboard chrome. ~**4–6 hours of work**, all in TS, no DB migrations. If billing primitives matter later, [Clerk Billing](https://clerk.com/docs/guides/billing/overview) bundles subscriptions (USD-only today, no tax/VAT yet).

---

## 4. Per-tenant resources matrix

| Resource | Model | Complexity | Recommendation |
|---|---|---|---|
| **Twilio phone numbers** | One Twilio *subaccount* per tenant, with its own Account SID + Auth Token + 10DLC brand. ([Twilio subaccount docs](https://help.twilio.com/articles/360038652173)) | **High.** Programmatic subaccount provisioning; webhooks must resolve inbound `To` number to subaccount via lookup table. | Do it. TCPA/10DLC brand vetting is per-subaccount — sharing one Twilio account across clients is a compliance risk. `tenant_twilio_credentials` table; provision on signup. |
| **LLM keys (Anthropic / OpenAI / Voyage / Deepgram)** | Shared platform key in env vars + optional per-tenant override in `organizations.<vendor>_api_key` (encrypted via Supabase Vault or pgcrypto). | **Medium.** Adds a key-resolution step in `src/lib/ai/*`. | Default shared; allow per-tenant override for enterprise tiers who want usage isolation or BYO credits. |
| **Custom domains (white-label)** | One hostname per tenant via Vercel domain assignment; `host` header → org resolution at the middleware. | **Medium.** Vercel must allowlist customer domains; cert provisioning is automatic. | Defer the domain plumbing. Bake the `host → orgId` lookup into `middleware.ts` now so the seam is there. |
| **Branding (logo, colors, email templates)** | Add `theme` jsonb to `organizations`; render via CSS variables on `<html>` data attribute. Per-tenant Handlebars partials for email. | **Low–Medium.** | Add `theme` jsonb + small settings UI now — obvious paid-tier feature. |
| **Per-tenant knowledge base (RAG)** | Namespace the vector search by `orgId` at retrieval time. Schema already has `orgId` on `embeddings` ([schema.ts:611](https://github.com/Kavora-Systems/kavora-crm/blob/main/src/db/schema.ts)). | **Low.** | Ship in v1 of multi-tenant — just enforce the `where` clause at retrieval. |
| **Webhook endpoints** | One URL per tenant in `organizations.webhook_url`. Trigger.dev job fans out outbound webhooks per tenant; inbound Twilio continues to one Vercel endpoint and routes by `To` number. | **Medium.** Signed payloads per tenant. | Start with optional per-tenant webhooks in v1 — critical for clients on Make/Zapier. |

---

## 5. Migration effort estimate (single-tenant → multi-tenant)

**Phase 0 — Foundations (already in place):** `organizations` table exists as a single-row stub ([schema.ts:80-91](https://github.com/Kavora-Systems/kavora-crm/blob/main/src/db/schema.ts)), every business table carries `orgId`, Clerk webhook syncs users. Free.

**Phase 1 — Turn "kavora" into a real org row + read `orgId` from session.** ~3–5 commits, 5–8 files (auth lib, schema, ~6 dashboard pages). Insert `('kavora', 'Kavora')`; replace the `KAVORA_ORG_ID` constant ([schema.ts:813](https://github.com/Kavora-Systems/kavora-crm/blob/main/src/db/schema.ts)) with `auth().orgId` and a `currentOrgId()` helper. **Risk: low.**

**Phase 2 — Enable Clerk Organizations + RLS.** ~6–8 commits, 12–18 files. Turn on Clerk Organizations; update the Clerk webhook to read `org_id`; add `<OrganizationSwitcher />`. Migration `0007_enable_rls.sql` enables RLS on all 17 tables with per-table policies mirroring [Supabase's recommended pattern](https://supabase.com/docs/guides/database/postgres/row-level-security) using `(select auth.org_id()::text)` from JWT. Tighten the Drizzle pool to a non-superuser DB role so policies actually fire. Touches every Server Action file in `src/actions/`. **Risk: highest** — missed policy = cross-tenant leak. pgTAP test harness is mandatory.

**Phase 3 — Per-tenant Twilio subaccounts.** ~4–6 commits, 6–8 files. New `tenant_twilio_credentials` table (encrypted via Supabase Vault or pgcrypto); `provisionTwilioSubaccount()` service. Every Twilio webhook route resolves the inbound `To` number → subaccount SID → verifies signature against that subaccount's auth token. Adds a settings page for Twilio status + manual key rotation. **Risk: high** — webhook signature verification is security-critical.

**Phase 4 — Tenant onboarding + per-tenant resources.** ~4–6 commits, 8–12 files. `createOrganization` Server Action; 3–4-step onboarding wizard (org name → Twilio subaccount provisioning → branding → invite team); `theme` jsonb on `organizations`; per-tenant webhook URLs with HMAC signing. **Risk: medium.**

**Total: 18–25 commits, ~30–45 files, 3–5 working days for one experienced dev.** Highest-risk hotspots in order: (1) RLS policy gaps, (2) Twilio webhook signature routing, (3) Drizzle connection role. Phase 2 is where you want a second pair of eyes and a thorough test suite before flipping the switch in production.

---

## 6. Recommendations: top 3 decisions to make now vs later

### Decide NOW (block multi-tenant launch)
1. **Lock the data isolation pattern: RLS on shared schema.** Already 80% in place; the schema was pre-wired for it. Picking RLS keeps the project on a single Supabase plan and reuses the existing pgvector index. Reversibility cost of switching later is high.
2. **Lock the auth provider: Clerk Organizations, not a swap.** The Clerk webhook already works; user-sync just needs to also sync `org_id`. Swapping mid-flight would mean rewriting every Server Action's session check. The "Active Organization" concept in [Clerk](https://clerk.com/docs/guides/organizations/overview) maps 1:1 to a CRM dashboard.
3. **Lock Twilio isolation: per-tenant subaccount from day one.** Even at 3 clients, sharing one Twilio account mixes 10DLC brand registrations and compliance posture. Twilio's subaccount API is stable ([Twilio subaccounts](https://help.twilio.com/articles/360038652173)); building it later means migrating numbers and re-doing A2P brand registration.

### Defer (decide later, build seams now)
- **Per-tenant LLM keys.** Add the override column now (`organizations.anthropic_api_key` nullable); ship on shared keys. Add override UI when a client asks.
- **Custom domains / white-label.** Defer the Vercel domain plumbing; resolve `host` header to orgId in `middleware.ts` from day one so the seam is there.
- **Per-tenant observability.** Shared for now; add a `tenant_id` tag and ship tenant-scoped dashboards only when an enterprise client demands it.

---

## References

- PostgreSQL — *Schemas*: https://www.postgresql.org/docs/current/ddl-schemas.html
- Supabase Docs — *Row Level Security*: https://supabase.com/docs/guides/database/postgres/row-level-security
- Clerk Docs — *Organizations*: https://clerk.com/docs/guides/organizations/overview
- Clerk Docs — *Billing*: https://clerk.com/docs/guides/billing/overview
- Auth0 Docs — *Organizations*: https://auth0.com/docs/manage-users/organizations
- Twilio Help — *How do I create a Subaccount?*: https://help.twilio.com/articles/360038652173
- Kavora CRM codebase: `src/db/schema.ts`, `src/lib/twilio/client.ts`, `docs/ARCHITECTURE.md`
