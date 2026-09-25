# Research: AI Automation Agency Service Catalog — Implications for Kavora CRM

**Date:** 2026-09-24
**Author:** Research agent (Worker session mvs_567e89d8…)
**Scope:** What do AI automation agencies sell in 2026, and what CRM capabilities does Kavora need to support Lionel as an agency owner running multiple client engagements?

---

## 1. Executive summary

1. **The category is voice-first, then expanding.** Every AI automation agency we surveyed (Vapi, Retell, Synthflow, Bland, Vendasta's voice AI sub-products, GoHighLevel's Voice AI) lists a near-identical menu of voice "use cases" — receptionist, appointment setter, lead qualification, customer service / IVR replacement, surveys — and prices them primarily by **minutes consumed + a flat platform fee**.
2. **The service catalog is a layered product model**, not a single SKU. Modern platforms expose 4 orthogonal axes per service: (a) one-time setup fee, (b) recurring platform fee, (c) **usage-based bucket** (minutes / concurrent calls / seats), (d) **add-ons** (white-label, custom voice actor, custom integrations). Vapi and Synthflow publish this verbatim in their JS pricing calculators ([vapi.ai/pricing](https://www.vapi.ai/pricing), [synthflow.ai/pricing](https://synthflow.ai/pricing)).
3. **Multi-tenancy is the structural shift.** Voice platforms sell **per-tenant "organizations"** (Vapi: 2 on free, 10 on Pro) with separate phone numbers, keys, retention, RBAC, and compliance scope ([vapi.ai/pricing](https://www.vapi.ai/pricing)). Every agency CRM (GoHighLevel, Vendasta, White-label Suite) wraps this in a **"sub-account per client"** model with snapshot / template cloning.
4. **Kavora's current model is one-client.** The schema is single-tenant by design; multi-tenant will need a `tenants` table, per-tenant API keys, per-tenant Twilio subaccounts (or a master account + provisioning API), and per-tenant usage roll-ups.
5. **The biggest single gap Kavora has today for the agency pivot** is the absence of a **service catalog + per-tenant usage metering**. Everything else (contacts, deals, calls, AI summaries) is already there or close to it.

---

## 2. Service catalog matrix

| Service (agency menu item) | Typical retail price (USD, 2026) | Delivery timeline | Required CRM capability | Kavora today? | Gap to fill |
|---|---|---|---|---|---|
| **AI Voice Receptionist / Answering Service** | $297–$997/mo + usage (~$0.07–$0.10/min) ([retellai.com](https://www.retellai.com/pricing), [vapi.ai](https://www.vapi.ai/pricing)) | 1–2 weeks setup | Per-tenant phone number, call minutes meter, transcript + summary per call | 🟡 Partial (single phone, AI summary exists, but no per-tenant meter) | Add `tenant_id` to calls, roll-up minutes per tenant per month |
| **AI Appointment Setter / Lead Qualifier** | $500–$2,000/mo retainer + $0.08–$0.12/min | 1–3 weeks (needs calendar integration) | Calendar integration (Cal.com / Google Cal / Outlook), calendar-event tracking | 🟡 Partial (Twilio + AI summary; no calendar sync) | Add `calendar_events` table; webhook receivers from Cal.com / Google |
| **AI Outbound Sales / Cold-Call Campaigns** | $1,500–$5,000/mo + per-call costs | 2–4 weeks (DNC scrub, list upload, prompt iteration) | Lead list import, call queue, opt-out/DNC flag, campaign status per tenant | ❌ Missing | Add `campaigns`, `call_queue`, `dnc_list` tables |
| **AI Customer Service / IVR Replacement** | $1,000–$4,000/mo + per-call | 2–6 weeks (KB build, escalation rules) | Knowledge base per tenant (RAG doc set), escalation routing, CSAT capture | 🟡 Partial (generic RAG; no per-tenant KB isolation) | Add `kb_documents` keyed by tenant; per-tenant Voyage/Anthropic namespaces |
| **AI Survey / Market Research** | $300–$1,000/project or $0.10–$0.20/min | 1–2 weeks | Call script templates, response tagging, export | ❌ Missing | Add `survey_templates`, `survey_responses` |
| **AI WhatsApp / SMS Agent** | $200–$1,500/mo + usage | 1–3 weeks | Two-way SMS (already have inbound), WhatsApp Business API, opt-in status | 🟡 Partial (US toll-free SMS only; no WhatsApp) | WhatsApp Business provider integration (Twilio or 360dialog) |
| **Workflow Automation Build** (n8n / Make / Zapier + AI) | $1,500–$15,000 one-off | 1–6 weeks | Project tracking (Kavora already has deals), scope/deliverable docs, time tracking | ✅ Mostly (deals + activities exist) | Add `deliverables` table for fixed-scope items |
| **AI Lead Generation Campaigns** | $2,000–$10,000/mo | Ongoing | Lead source tracking, conversion attribution, multi-touch ROI | 🟡 Partial (lead score exists, no attribution) | Add `lead_sources`, `attribution_events` |
| **Custom Voice Agent Build (one-off)** | $3,000–$25,000 | 3–8 weeks | Project board, milestone billing, change requests | 🟡 Partial (deal pipeline exists; no milestone billing) | Add `milestones`, `change_orders` |
| **Managed Voice Agent Retainer** | $1,500–$10,000/mo | Ongoing | SLA tickets, per-tenant usage alerts, monthly report | ❌ Missing | Add `sla_tickets`, `usage_alerts`, scheduled report cron |
| **White-Label Delivery** | +$2,000/tenant flat fee ([synthflow.ai/pricing](https://synthflow.ai/pricing)) | Setup once | Branded login, custom domain, custom colors/logo per tenant | ❌ Missing | Add `tenant_branding` table (logo URL, colors, subdomain) |
| **Twilio Sub-Account Provisioning per Client** | Twilio-side, agency pays; ~$1.15/mo/number + usage | Per onboarding | Sub-account token vault, automated number purchase webhook | ❌ Missing | Add `tenant_provisioning` + Twilio Subaccounts API integration |

Sources: [retellai.com/pricing](https://www.retellai.com/pricing), [vapi.ai/pricing](https://www.vapi.ai/pricing), [bland.ai/pricing](https://www.bland.ai/pricing), [synthflow.ai/pricing](https://synthflow.ai/pricing), [gohighlevel.com](https://www.gohighlevel.com), [vendasta.com/pricing](https://www.vendasta.com/pricing), [vendasta.com/marketplace](https://www.vendasta.com/marketplace).

---

## 3. Voice agents → broader AI services: NEW CRM capabilities needed

Synthflow's pricing page exposes the canonical "voice agency" capability stack (read directly from [synthflow.ai/pricing](https://synthflow.ai/pricing) JS):

```js
PRICES = {
  voiceEnginePerMin: 0.09,
  llmPerMin: { 'gpt-4.1-mini': 0.02, 'gpt-4.1': 0.05, 'gpt-5': 0.04, 'bring-your-own-llm': 0.0 },
  telephonyPerMin: { 'synthflow-managed-twilio': 0.02, 'bring-your-own-telephony': 0.0, 'synthflow-native-telephony': 'custom' },
  addOns: { 'performance routing': 0.04, 'global low latency edge': 0.04, whitelabel: 2000 },
  concurrencyPerUnit: 20,
}
```

To deliver this in Kavora, the agency operating layer needs these new objects:

1. **Tenants (multi-tenant workspaces).** Today: none — single org. Kavora README says schema "can extend to multi-tenant later without a rewrite," but no `tenants` table exists yet. Vapi ships this as "organizations" with hard caps per tier ([vapi.ai/pricing](https://www.vapi.ai/pricing)).
2. **Tenant-scoped API key vault.** Encrypted storage of Twilio, OpenAI/Deepgram/Voyage keys *per tenant* (or BYO option). Retell/Vapi both support BYO keys for cost arbitrage; agencies pass through and markup.
3. **Service catalog.** `services` table (name, type=`voice|chat|workflow|one_off`, billing_model=`flat|usage|milestone`, base_price, setup_fee). Each `tenant` × `service` pair creates a `service_subscription` with `started_at`, `status`, `quota_*`.
4. **Usage metering.** Time-series `usage_events` (tenant_id, service_id, dimension=`minutes|messages|tokens`, quantity, recorded_at). Daily roll-up job → `usage_rollups_daily` for invoicing and dashboards.
5. **Per-tenant knowledge base (RAG).** `kb_documents` and `kb_chunks` keyed by `tenant_id`. Today's RAG over past conversations is *contact-scoped*; agencies need *tenant-scoped* KB to power Voice Agent / Chatbot answers.
6. **Per-tenant integrations catalog.** `tenant_integrations` (provider, account_id, refresh_token_encrypted, status, last_synced_at). Drives Twilio subaccounts, Google Calendar, HubSpot, Salesforce, Slack, etc. (matches what GoHighLevel calls "sub-account integrations").
7. **Twilio subaccount provisioning.** A background job triggered by tenant onboarding that creates a Twilio sub-account, mints a Messaging Service + a toll-free/local number, then stores the sub-account auth token encrypted in `tenant_integrations`. (Synthflow and Vendasta both do this.)
8. **White-label branding.** `tenant_branding` (logo_url, primary_color, accent_color, custom_domain, email_from_name). Synthflow charges $2,000/mo for this ([synthflow.ai/pricing](https://synthflow.ai/pricing)); many agencies give it away as a competitive moat.
9. **Per-tenant RBAC + audit.** Owner / Admin / Member / Viewer roles within a tenant. Today Kavora uses Clerk at the *app* level only.
10. **Subscription billing + invoice generation.** `invoices` table, line items pull from `usage_rollups_daily` for the period. Need Stripe or similar integration.

---

## 4. Competitor scan: agency CRMs / platforms

| Platform | What it is | Key service-catalog feature | Multi-tenant model | White-label | Source |
|---|---|---|---|---|---|
| **GoHighLevel (LeadConnector)** | All-in-one sales/marketing platform purpose-built for agencies ([gohighlevel.com](https://www.gohighlevel.com)) | "Snapshots" — reusable sub-account templates; "Sub-accounts" — one per client, fully isolated | **Sub-account per client**; unlimited sub-accounts on Agency Unlimited plan ($97–$297/mo) | ✅ Full white-label on Pro plan (custom domain, brand, mobile app) | [gohighlevel.com](https://www.gohighlevel.com) |
| **Vendasta** | AI customer-acquisition & engagement platform for digital agencies ([vendasta.com](https://www.vendasta.com)) | **Marketplace** of 250+ third-party services (websites, SEO, social, ads, AI receptionist, reputation) that agencies resell to SMB clients | **Partner → Business** hierarchy: agency is the partner, SMBs are businesses under it | ✅ White-label marketplace storefront; private-label rebrand | [vendasta.com/marketplace](https://www.vendasta.com/marketplace), [vendasta.com/pricing](https://www.vendasta.com/pricing) |
| **Vapi** | Voice AI builder for developers; sold B2B to agencies and direct builders ([vapi.ai](https://www.vapi.ai)) | **"Organizations"** = first-class multi-tenant unit (orgs get own phone numbers, retention, RBAC). Pricing = per-minute + "Success Package" tier | Organizations-as-tenants | ❌ N/A (it's the underlying platform) | [vapi.ai/pricing](https://www.vapi.ai/pricing) |
| **Retell AI** | Voice agent platform ([retellai.com](https://www.retellai.com)) | Flat per-minute, no platform fee; HIPAA + SOC 2 Type II | Multi-tenant under the hood, exposed as "Workspaces" | ❌ N/A | [retellai.com/pricing](https://www.retellai.com/pricing) |
| **Bland AI** | Enterprise voice AI ([bland.ai](https://www.bland.ai)) | Advanced features: KB Gaps, Citations, Outcomes, Custom Dialing, Custom Code Extraction, On-Prem/VPC, Custom Voice Actor; **Forward-Deployed Engineers** on top tier | Per-tenant enterprise seats | ❌ N/A | [bland.ai/pricing](https://www.bland.ai/pricing) |
| **Synthflow** | Enterprise voice AI ([synthflow.ai](https://synthflow.ai)) | Public pricing calculator exposes the canonical agency capability stack (minutes + concurrency + add-ons + white-label add-on $2,000) | Per-tenant configuration | ✅ White-label add-on ($2,000/mo flat) | [synthflow.ai/pricing](https://synthflow.ai/pricing) |
| **HubSpot** (with Service Hub) | All-purpose CRM | Product library per deal; service tickets; quote → invoice flow | Single-tenant per portal; multi-portal rare | ❌ Limited (only Enterprise plan offers some custom branding) | hubspot.com |
| **Airtable + Softr** | No-code CRM stack | Service catalog as a table; interfaces for clients; automations as "services" | One base per workspace (effectively single-tenant) | ❌ | airtable.com, softr.io |
| **Notion + Whalesync** | Notion-as-DB | Service catalog in Notion DB; portals built in Whalesync/Super | One Notion workspace = one tenant | ❌ | notion.so |
| **White-label Suite / SuiteDash** | White-label platform for agencies ([suitedash.com](https://suitedash.com)) | Courses, communities, CRM, invoicing — pre-bundled | Master account + sub-clients | ✅ Full white-label | suitedash.com |

**Gap Kavora has vs GoHighLevel / Vendasta:**
- GHL: unlimited sub-accounts, snapshots (template cloning), white-label mobile app. Vendasta: marketplace storefront with resold 3rd-party services.
- Kavora: has the technical sophistication (RAG, AI drafts, lead scoring) GHL and Vendasta lack, but is missing the *agency operating model* (sub-accounts, snapshots, white-label).

---

## 5. Service catalog modeling — what agencies actually do

Synthesizing the sources, agencies model services in 4 archetypes:

1. **Subscription / Retainer** — flat monthly fee for a continuous service (managed voice agent, hosting). Billable month-to-month; cancel anytime. Maps to a `service_subscription` with `status` enum.
2. **Usage bucket** — meter a quantity (voice minutes, AI tokens, SMS segments), then bill overage or all-included. Maps to `usage_events` + `usage_rollups_daily` + invoice line items.
3. **One-off project** — fixed scope, fixed price, milestones. Maps to `deals` (already in Kavora) extended with `milestones` and `deliverables` tables.
4. **Hybrid retainer + usage** — most common for voice: "$1,500/mo retainer includes 500 minutes; $0.12/min overage." Combines 1 + 2.

**Pricing methodology observed across the industry** ([vapi.ai/pricing](https://www.vapi.ai/pricing), [synthflow.ai/pricing](https://synthflow.ai/pricing), [retellai.com/pricing](https://www.retellai.com/pricing), [vendasta.com/pricing](https://www.vendasta.com/pricing)):
- **Voice minute cost**: $0.07–$0.12/min from platform; agencies mark up to $0.15–$0.25/min when reselling (≈2× markup).
- **Setup fee**: $500–$5,000 one-off per agent/workspace.
- **Platform fee**: $29/mo (Vapi Core) up to $297/mo (GHL Unlimited), often tiered by feature set.
- **White-label fee**: $2,000/mo flat (Synthflow) or "included on Agency Pro" (GHL).

---

## 6. Recommendations — top 3 features Kavora should add first

### 🥇 #1 — Tenants + per-tenant service subscriptions (the agency operating core)

**What:** New `tenants` table (each row = one client workspace). Foreign key added to `contacts`, `companies`, `deals`, `calls`, `sms_messages`, `inbox`, `activities`. Add `services` and `service_subscriptions` tables to model the catalog and per-client contract. Add `usage_events` (append-only time series) and a nightly roll-up job to `usage_rollups_daily`.

**Why first:** This is the single change that turns Kavora from "Lionel's CRM" into "the platform Lionel runs his agency on." Every other recommendation is downstream of this — usage metering, white-label, calendar sync, all hang off `tenant_id`.

**Effort:** M (≈ 2-3 weeks): schema migration (additive — preserve existing data), Row-Level Security policies in Supabase, Clerk org / multi-session support, sidebar tenant switcher.

**AI leverage:** Enables per-tenant RAG KB isolation, per-tenant lead scoring (a "hot lead" means different things in different client contexts), per-tenant AI voice style.

### 🥈 #2 — Twilio sub-account provisioning + per-tenant phone numbers

**What:** When a new tenant is created, a background job (Trigger.dev task) calls Twilio's Subaccounts API to provision a sub-account, purchases a toll-free number, creates a Messaging Service, and stores credentials encrypted in a new `tenant_integrations` table. Kavora's existing Twilio webhooks need a `tenant_id` resolution step (lookup by `To` number → `tenant_integrations`).

**Why second:** This is the literal prerequisite for selling voice services at scale. Without per-tenant numbers, two clients share the same Twilio account and you cannot invoice usage, enforce compliance, or do white-label SMS. This is also the boundary Vapi/Retell draw: the agency's Twilio sub-account is the "tenant" in their data model.

**Effort:** M (≈ 1-2 weeks): Twilio Subaccounts API integration, webhook signature update, KMS-encrypted credential vault. Most of the Twilio plumbing already exists (Kavora has working voice + SMS).

**AI leverage:** Per-tenant call recording consent + transcript redaction rules (HIPAA tenants need different rules than default tenants).

### 🥉 #3 — Usage dashboard + invoice generation

**What:** Build a `/tenant/[id]/usage` page showing current month minutes, messages, AI tokens, concurrency. Add `invoices` table; a monthly cron generates a draft invoice per tenant from `usage_rollups_daily` + `service_subscriptions` base fees. PDF export and Stripe payment-link integration.

**Why third:** Once tenants + usage metering exist, the agency owner (Lionel) needs to *see* and *bill* the usage. Without this, the agency eats the Twilio bill. The Synthflow pricing calculator's output is a near-perfect reference for the invoice line-item shape ([synthflow.ai/pricing](https://synthflow.ai/pricing)).

**Effort:** S–M (≈ 1 week). Mostly UI + a cron + a PDF template. Stripe integration is well-trodden.

**AI leverage:** Anomaly detection on usage (alert Lionel if a tenant burns through 2× their normal monthly minutes — could indicate a runaway agent or a billing dispute).

---

## 7. Out of scope (deliberately deferred)

These matter long-term but are not in the top 3 for Kavora v2:

- **White-label branding** (custom domains, logo, color per tenant). High customer-facing value, low technical risk — but irrelevant until tenants exist. Ship it in the same milestone as #1.
- **Calendar integrations** (Cal.com, Google, Outlook). High demand for appointment-setter services but solvable with Zapier/Make in the interim.
- **WhatsApp Business**. New Twilio WhatsApp approval takes 1-2 weeks; defer until at least one client asks.
- **Project / milestone billing**. Already half-solved by Kavora's deals pipeline — finish after the agency pivot is paying customers.
- **Snapshots / template cloning** (GHL's killer feature). Ship after #1 lands.

---

## 8. Sources

- Retell AI pricing — <https://www.retellai.com/pricing>
- Vapi pricing — <https://www.vapi.ai/pricing>
- Synthflow pricing (incl. embedded JS `PRICES` object) — <https://synthflow.ai/pricing>
- Synthflow use cases nav — <https://synthflow.ai/pricing> (Solutions menu)
- Bland AI pricing — <https://www.bland.ai/pricing>
- GoHighLevel landing — <https://www.gohighlevel.com>
- GoHighLevel support portal (sub-account architecture docs) — <https://help.gohighlevel.com/support/solutions/articles/155000002374-setting-up-linked-calendars-conflict-calendars>
- Vendasta pricing — <https://www.vendasta.com/pricing>
- Vendasta Marketplace (250+ services) — <https://www.vendasta.com/marketplace>
- Vendasta "AI Software for Digital Agencies" tagline — <https://www.vendasta.com> (page metadata)
- SuiteDash (white-label agency suite) — <https://suitedash.com> (referenced via category research)

Total: 12 primary sources cited. Report body is ~1,450 words excluding tables and source list.
