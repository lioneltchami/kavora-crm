# AI Automation Agency — Research for Kavora CRM

**Purpose:** Capture what an AI automation agency actually sells in 2026, what CRM capabilities that requires, and how to evolve Kavora from a single-tenant CRM into the platform Kavora Systems runs its client engagements on.

**Reading order:** skim this README first, then drill into the source reports when implementing.

---

## Source reports

| Report | Covers | Word count |
|---|---|---|
| [`research-ai-agency-services.md`](./research-ai-agency-services.md) | The service catalog agencies sell, pricing, competitor scan (GoHighLevel / Vendasta / Vapi / Retell / Synthflow / Bland) | ~2,470 |
| [`research-multi-tenant-architecture.md`](./research-multi-tenant-architecture.md) | Data isolation patterns, Clerk Organizations, Twilio subaccounts, migration effort estimate | ~1,580 |
| [`research-ai-agent-ops.md`](./research-ai-agent-ops.md) | Observability, multi-channel rollout, RAG architecture, billing models | ~1,670 |

---

## Headline conclusions (convergence across all 3 reports)

1. **Multi-tenancy is the single biggest gap.** Kavora is single-tenant (`KAVORA_ORG_ID = "kavora"` hardcoded). Every other recommendation hangs off `tenant_id`.
2. **Schema is already 80% pre-wired.** `orgId` is on every table; ARCHITECTURE.md anticipates the move. RLS just needs to be enabled.
3. **Keep Clerk; enable Clerk Organizations.** ~4-6 hours of TS, no DB migration. Avoids rewriting session checks.
4. **Twilio per-tenant subaccount from day one.** TCPA/10DLC compliance is per-subaccount; one shared account is a compliance risk.
5. **Service catalog uses 4 billing archetypes.** Subscription/retainer, usage bucket, one-off project, **hybrid** (the winner). Voice: $0.07–$0.12/min cost, ~2× markup.
6. **Stay on Postgres + pgvector for RAG.** Migrate to Pinecone only when a tenant exceeds ~500k chunks.

---

## Implementation phases

### Phase A — Multi-tenant core (3-5 working days, 1 dev; 1.5-2.5 days with 3 parallel agents)
- Turn `KAVORA_ORG_ID` into a real `organizations` row + `currentOrgId()` session helper
- Enable Clerk Organizations plugin
- Enable RLS on all 17 tables (`0007_enable_rls.sql`)
- Tighten Drizzle connection role so policies fire
- pgTAP harness for RLS coverage (mandatory — missed policy = cross-tenant leak)

### Phase B — Per-tenant resources (1-2 weeks)
- Twilio sub-account provisioning on tenant onboarding
- Webhook routing: `To` number → subaccount → verify signature against subaccount auth token
- `tenant_integrations` table (encrypted credentials via Supabase Vault or pgcrypto)
- Per-tenant RAG: `kb_documents` + `kb_chunks` keyed by `orgId`

### Phase C — Service catalog + billing (1 week)
- `services`, `service_subscriptions` tables
- `usage_events` + daily rollup cron
- `/tenant/[id]/usage` dashboard
- Monthly invoice cron (Stripe payment links)

### Phase D — Channel expansion (parked, build seams now)
- WhatsApp Business API, web chat widget, IG DM, Slack/Teams bots — all plug into the multi-tenant + service catalog primitives from A-C.

---

## Open decisions before Phase A starts

1. **Timing** — ship v1.9 (multi-tenant core) right after Clerk live keys land, or park and validate the agency model with one client first?
2. **Billing** — Stripe (current default, full tax/VAT) or Clerk Billing (newer, USD-only today, simpler)?
3. **Twilio** — buy a Twilio master account + Subaccounts API now, or wait until a paying client?

---

## Status

- **Phase A — Multi-tenant core: SHIPPED 2026-09-24** (commit `62fb045`)
  - 18 org-scoped tables have RLS enabled with full SELECT/INSERT/UPDATE/DELETE policies
  - Clerk Organizations wired (webhook handles `organization.*` + `organizationMembership.*` events)
  - pgTAP isolation harness: **32/32 tests pass** on live Supabase DB with non-superuser role
  - Two-pool design: `db` (RLS-firing, default for app code) + `adminDb` (bypasses RLS, for sessionless contexts)
  - All webhook + background-job paths switched to `adminDb` to prevent silent RLS-blocked writes
  - KAVORA_ORG_ID cleaned up across 20+ files (now `@deprecated`, kept only for seed + tests)
  - Per-tenant orgId threaded through Twilio `contact-lookup` helpers
  - 15/15 vitest tests pass; typecheck + build clean
  - Migrations 0001-0009 applied; runner idempotent
- **Phase B — Per-tenant resources: NOT STARTED** — pending first paying client
- **Phase C — Service catalog + billing: NOT STARTED** — pending first paying client

---

## Cross-references

- [`../atomic-crm/apply-to-kavora.md`](../atomic-crm/apply-to-kavora.md) — Tier 1-3 roadmap for atomic-CRM-derived features (ships alongside agency pivot, not in place of it)
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — pre-wires `orgId` everywhere; anticipates multi-tenant move
