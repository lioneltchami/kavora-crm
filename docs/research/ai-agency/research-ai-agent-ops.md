# AI Agent Operations & Observability — Research for Kavora CRM

**Author:** research worker (delegated)
**Scope:** AI-agent deployment, monitoring, multi-channel rollout, per-tenant RAG, and pricing models for an agency that resells AI agents to clients.
**Date:** 2026-09-24

---

## 1. Executive Summary

- **Agencies need a "control plane" per tenant.** Production observability for AI agents is not a single dashboard — it is four layered views (cost, quality, knowledge freshness, runtime health). LangSmith, Cresta, and Observe.AI all converge on this stack ([docs.langchain.com/langsmith/observability](https://docs.langchain.com/langsmith/observability); [cresta.com](https://cresta.com/); [observe.ai](https://www.observe.ai/)).
- **Channels expand faster than people track them.** Voice, SMS, web chat, email autoresponders, WhatsApp/IG DM, and Slack/Teams bots all need their own conversation tables and CRM touchpoints — even Anthropic's "routing" pattern assumes an LLM-driven classifier already knows which channel a request is on ([anthropic.com/engineering/building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents)).
- **Per-tenant RAG is solved but only with deliberate architecture.** Pinecone namespaces and pgvector-with-`tenant_id` columns are the two mature patterns; both need the same upstream discipline (per-tenant document storage, embedding pipeline isolation, re-index jobs on churn) ([docs.pinecone.io/guides/get-started/overview](https://docs.pinecone.io/guides/get-started/overview.md)).
- **Billing models are converging on hybrid (retainer + usage).** Pure pass-through-token, per-minute voice, per-resolution, and flat retainer each create wrong incentives for agencies; the leading platforms stack a small base + usage + overage ([langchain.com/pricing](https://www.langchain.com/pricing)).
- **Kavora's three highest-leverage adds:** (1) per-tenant observability tables and dashboards, (2) per-tenant vector store with namespace isolation, (3) usage metering + invoicing primitives.

---

## 2. Monitoring + Observability Matrix

When an agency deploys AI agents on behalf of clients, the operational questions are: *did it work, did it cost what we expected, and is the knowledge still accurate?* Three reference platforms answer these in similar shapes.

| What to track per tenant | LangSmith | Cresta | Observe.AI | Kavora today |
|---|---|---|---|---|
| Conversation volume + token cost | ✅ traces + token usage per run ([docs.langchain.com/langsmith/observability](https://docs.langchain.com/langsmith/observability)) | ✅ "automated QA across 100% of conversations" ([cresta.com](https://cresta.com/)) | ✅ Voice AI volume + chat AI volume ([observe.ai](https://www.observe.ai/)) | ❌ partial — `sms_messages` and `calls` rows only |
| LLM latency, errors, retries | ✅ trace-level spans, dashboards | ✅ real-time guidance implies latency-aware | ✅ "orchestrate voice and chat workflows" | ❌ no span/timing data stored |
| Quality / resolution / escalation rate | ✅ "automate evals" + Online Evaluations | ✅ Conversation Intelligence + Quality Management | ✅ "improve QA, analyze conversations" | ⚠️ only AI summaries (no scoring) |
| Hallucination / failure rate | ✅ "automatically detect recurring issues" via Engine ([docs.langchain.com/langsmith/observability](https://docs.langchain.com/langsmith/observability)) | ✅ Knowledge Agent surfaces incorrect answers | ✅ governed AI workflows | ❌ none |
| Knowledge base freshness | ⚠️ via custom evaluation | ✅ Knowledge Agent ([cresta.com](https://cresta.com/)) | ⚠️ partial | ❌ no KB today |
| CSAT / human feedback | ✅ inline annotation queues + attach-user-feedback | ✅ CSAT dashboards | ✅ CSAT, agent assist | ❌ no feedback loop |
| Per-tenant cost attribution | ✅ spend by workspace | ✅ per-tenant invoice | ✅ enterprise seats | ❌ single Anthropic key, no split |

**Takeaway for Kavora:** the gap is not "build an agent platform" — the gap is the **data model**. Add `agent_runs`, `llm_traces`, `evaluations`, and `token_usage` tables keyed by `tenant_id`, then expose a per-tenant dashboard. LangSmith's "Engines that find and fix failures" is the north star ([docs.langchain.com/langsmith/observability](https://docs.langchain.com/langsmith/observability)).

---

## 3. Multi-Channel Deployment Matrix

Channels AI agencies deploy to in 2026, mapped against Kavora's current build.

| Channel | Complexity | Kavora today | Gap |
|---|---|---|---|
| SMS / MMS via Twilio | Low | ✅ (single number, `sms_messages` table) | Need per-tenant Twilio subaccounts + numbers |
| Voice (IVR / inbound) | Medium | ✅ (`calls` table, Deepgram transcription) | Need multi-tenant routing + per-tenant phone numbers |
| AI-drafted email outreach | Low | ✅ (Claude Sonnet, RAG citations) | None |
| Web chat widget (Intercom-style) | Medium | ❌ | Need widget SDK + `chat_threads` table + presence handoff |
| Email autoresponder (inbound) | Medium | ❌ | Need inbound mailbox + auto-reply worker |
| WhatsApp Business API | Medium | ❌ | Twilio WhatsApp sandbox or 360dialog; per-tenant WABA |
| Instagram DM | Medium-High | ❌ | Meta Graph API approval; per-tenant IG account linking |
| Slack / Teams internal bot | Low-Medium | ❌ | Bolt a per-tenant OAuth + slash-command webhook |
| Custom API / webhook integrations | High | ❌ | Generic `inbound_events` + `outbound_webhooks` tables |

**Pattern guidance.** Anthropic's routing pattern ([anthropic.com/engineering/building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents)) — "Directing different types of customer service queries (general questions, refund requests, technical support) into different downstream processes, prompts, and tools" — applies directly. Build one classifier, fan out to channel-specific workers, store the originating channel on the conversation row.

**For each new channel the CRM needs at minimum:** `channel`, `external_thread_id`, `tenant_id`, `contact_id`, `direction (inbound|outbound)`, `raw_payload (jsonb)`, `agent_run_id (nullable)`, `created_at`. Anything less and you cannot bill or debug it.

---

## 4. Knowledge Base Architecture

When "a client signs up for a chatbot that knows their business," three layers have to be tenant-scoped — **vector store**, **document storage**, **embedding pipeline**. Skipping any one of them creates a leak risk or a freshness bug.

### Vector store options

| Option | Per-tenant isolation | Cost model | Kavora fit |
|---|---|---|---|
| **Pinecone namespaces** | One index, many namespaces — recommended in Pinecone docs for AI-agent knowledge retrieval ([docs.pinecone.io/guides/get-started/overview](https://docs.pinecone.io/guides/get-started/overview.md)) | Per-pod, shared across tenants | ✅ fastest to ship; pay attention to pod sizing |
| **Pinecone serverless with `tenant_id` metadata filter** | One serverless index, filter at query time | Per-read unit + storage | ✅✅ best cost-per-tenant at small scale |
| **pgvector with `tenant_id` column** | One DB, RLS or app-layer `WHERE tenant_id = $1` | Single Postgres instance | ✅ already Postgres-based; add `tenant_id uuid not null` and partial indexes |
| **Per-tenant Pinecone indexes** | Full isolation, full cost | One index per client | ⚠️ expensive past 50 tenants |

### Document storage
- **S3 with `s3://kavora-clients/{tenant_id}/raw/` prefix** is the industry default; enforce via IAM policy, not application code.
- Track every chunk back to its source doc with `source_uri`, `chunk_index`, `embedding_model`, `embedding_model_version`, `indexed_at` — without those you cannot answer "is the KB stale for tenant X?"

### Embedding pipeline
- Per-tenant cron (Trigger.dev, like the existing lead-scoring job) that re-embed on source-doc change.
- Store embeddings with `tenant_id` *and* `embedding_model_version` so a model upgrade does not silently mix old and new vectors.

**Recommendation for Kavora:** stay on Postgres and add a `vector(1536)` column + IVFFLAT index on a new `kb_chunks(tenant_id, doc_id, chunk, embedding)` table. This avoids a new vendor, keeps tenant isolation in one transactional system, and lets the existing Trigger.dev cron handle re-indexing. Migrate to Pinecone only when a tenant's corpus exceeds ~500k chunks or when latency crosses 800ms.

---

## 5. Billing Models

| Model | What it bills | Incentive | CRM feature needed |
|---|---|---|---|
| **Per-message chat** | One unit per AI reply | Discourages long multi-turn; OK for support | `agent_runs` row + `unit_count` column |
| **Per-minute voice** | Minutes of audio handled | Encourages short calls; punishes hold time | `calls.duration_seconds` already there, add rate × duration |
| **Per-token LLM (pass-through)** | Input + output tokens at cost | No agency margin; punishes long context | `token_usage(input_tokens, output_tokens, model)` table |
| **Per-token LLM (markup)** | Tokens × multiplier | Margin but unpredictable client bill | Same table + `markup_pct` per tenant |
| **Per-resolution** | Counted only when intent achieved | Aligns agency + client, but hard to detect "resolved" | `resolutions` event table + client-defined resolution rules |
| **Per-seat (white-label dashboard)** | Monthly per logged-in user | Predictable; punishes automation wins | `seats` table, `tenant_id × user_id × period` |
| **Flat retainer + overage** | Base subscription, metered overage above it | Smooth cash flow; rewards scale | Sum of all above + a `billing_period` rollup |

The LangChain pricing page exposes this hybrid shape — Developer / Plus / Enterprise tiers with usage-based add-ons ([langchain.com/pricing](https://www.langchain.com/pricing)). Cresta and Observe.AI follow the same template: enterprise sales-led, with usage as the expansion lever.

**Recommendation for Kavora:** ship the **hybrid** model — a flat monthly platform fee (covers seats + dashboard + Slack alerts) plus metered usage (LLM tokens, voice minutes, SMS segments). Most agencies selling AI agents want predictable ARR plus the upside when a client scales. Pure usage-only creates churn anxiety; pure retainer kills expansion.

---

## 6. Recommendations — Top 3 Features for Kavora

### 1. Per-tenant observability data model + dashboard (highest leverage)
Add four tables keyed by `tenant_id`: `agent_runs`, `llm_traces`, `evaluations`, `token_usage`. Build one `/dashboard/[tenant_id]` page that exposes volume, cost, latency p50/p95, resolution rate, and a feed of recent failures. This is the table-stakes feature agencies use to prove ROI to clients and to bill usage. Reference design: [docs.langchain.com/langsmith/observability](https://docs.langchain.com/langsmith/observability).

### 2. Per-tenant knowledge base with RAG
Add `kb_sources`, `kb_documents`, `kb_chunks` (with `pgvector` embedding column) all keyed by `tenant_id`. Wire the existing RAG citation path on AI-drafted outreach to retrieve only `WHERE tenant_id = $1`. Schedule a Trigger.dev job to re-embed on document change. This unlocks the "chatbot that knows your business" pitch without a new vendor.

### 3. Usage metering + invoicing primitives
Add a `usage_events` table (event_type, quantity, unit_cost_cents, markup_pct, tenant_id, occurred_at) and a monthly rollup query. Generate PDF invoices via the existing Vercel/Trigger stack. Offer three billing tiers in `tenants.plan` (Starter / Growth / Scale) and gate features by tier. This is what turns Kavora from a tool into a billable service that agencies can resell.

**Out of scope for now (park):** web chat widget, WhatsApp/IG DM, Slack/Teams bots. Build the channel SDK after the observability + KB + billing primitives ship, because every new channel will plug into all three.

---

## Sources

- Anthropic — Building Effective Agents — https://www.anthropic.com/engineering/building-effective-agents
- LangSmith Observability docs — https://docs.langchain.com/langsmith/observability
- LangChain Plans and Pricing — https://www.langchain.com/pricing
- Pinecone Documentation Overview — https://docs.pinecone.io/guides/get-started/overview.md
- Cresta — https://cresta.com/
- Observe.AI — https://www.observe.ai/
