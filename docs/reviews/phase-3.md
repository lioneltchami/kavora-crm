# Phase 3 review — Call intelligence

Reviewer scope: `src/lib/ai/transcribe.ts`, `src/lib/ai/summarize.ts`, `src/lib/queue/enqueue.ts`. Shared-file notes tagged `[advisory — shared file]` (embed.ts is shared with Phase 4; trigger/inbound-sms.ts is shared with Phase 5).

No code modified.

---

## ponytail

Hunt is light. The slice is mostly thin glue.

- `enqueue.ts:32` `yagni`: triple `as any` cast around `tasks.trigger(id as any, {} as any)` adds zero type safety. Drop the casts — fix the call signature instead (see Standards §4). No line count change after fix, but safety improves.
- `transcribe.ts:45` `shrink`: full-row `.select().from(calls)` is wider than needed — only `id` and `orgId` are read. Swap to a partial select. ~1 line, but tightens the projection.
- `summarize.ts:19-25` `shrink`: `cachedClient` + `getClient()` is a 5-line memoization for one SDK constructor. Acceptable; not deleting.
- `embed.ts:17-24, 26-52` `keep`: dual `embedWithVoyage` / `embedWithOpenAI` looks like duplication but is the explicit provider-abstraction deliverable from the spec. Not YAGNI.

Lean already. Ship.

---

## Standards (AGENTS.md)

Five AGENTS.md rules, three are honored, two are not.

1. **Env via `@/lib/env`** — honored. `transcribe.ts:5`, `summarize.ts:3`, `enqueue.ts:8`, and `embed.ts:4` all import through `env`. No raw `process.env` reads.
2. **Embedding provider in `src/lib/ai/embed.ts`, `resolveProvider()`-style branch** — honored. Caller-facing surface (`embedActivity`) doesn't change when Voyage/OpenAI swap.
3. **❌ "Don't use raw `pg.Pool.query` inside the action layer"** — violated by `embed.ts:96-110` (raw `pool.query(...)` for the pgvector insert). Reasonable exception: Drizzle still ships no first-class pgvector type, and the file acknowledges it. Suggest tightening by routing through `db.execute(sql\`…\`)` for tracing parity, even with a raw cast column. Not blocking.
4. **❌ "AI prompts — wrap retrieved context in `<context>` tags"** — Phase 3 has no RAG retrieval yet, so rule doesn't bite here. Worth a forward note for Phase 4.
5. **Audit log** — every server action is supposed to end with `logAudit(...)`. None of `summarize.ts`, `transcribe.ts`, `embed.ts`, or the queue dispatcher writes to `audit_log`. For AI calls this is part of the spec compliance row (plan: "All AI actions appear in the audit log") — Phase 3 fails that acceptance line.

Provider keys handled defensively: `deepgramConfigured`, `anthropicConfigured`, `embeddingsConfigured` all exist in `env.ts`; the three libs early-return `null` on missing keys. Graceful no-op OK.

---

## Spec (Flow E + AI Features + State/concurrency)

Six spec checks, three pass, three fail.

1. **Flow E step 1 — Deepgram STT pipeline** ✅. `transcribe.ts:58-71` posts to `api.deepgram.com/v1/listen` with `nova-2`, smart_format, punctuate. Signed URL path fetched from private Supabase bucket. `transcriptStatus` flipped to `failed` on error. Solid.
2. **Flow E step 2 — Claude Haiku structured summary → `ai_summaries`** ❌. `summarizeCallTranscript({ transcript, contactName })` is implemented but **no caller exists in this phase**. `enqueue.ts:71-93` runs only `transcribeCall` + DB update + `embedActivity`. `trigger/inbound-sms.ts:48-68` does the same. **`ai_summaries` is never written for calls**, the contact timeline never sees the structured `summary / nextActions / sentiment / topics`, and the model provenance the schema persists (`model` column) is unused. This is the headline gap.
3. **Flow E step 3 — Embed transcript + summary into pgvector** ⚠️ partial. Embed pipeline exists and inserts via parameterized query (`$6::vector`, no string concat), but `embedActivity` is called with `content: result.transcript` only. The "blend summary in" pattern SMS uses (`"${body}\n\nSummary: ${summary.summary}\nNext actions: ..."`) is missing on the call side. Plan's RAG-corpus line ("covers `calls.transcript` … `ai_summaries.summary`") is not met.
4. **PII redaction** ❌. Plan: "PII redaction: a small prompt-instructed pass strips obvious PII (SSN, full card numbers) before sending transcript to LLM; original stays in DB." `summarizeCallTranscript` and `summarizeSms` ship raw `body` / `transcript` straight to Claude. SSN/card strings baked into the prompt. Spec gap.
5. **State/concurrency — webhook + AI retries** ❌. Plan: "AI job retries — Trigger.dev retries 3x; failures logged to Sentry …". `transcribeCallTask` carries no `idempotencyKey` and `embedActivity` only inserts (no upsert by `(org_id, source_type, source_id, chunk_index)`). Retries → duplicate pgvector chunks. `calls.transcript` is last-write-wins (acceptable), but the embedding index doubles. Spec gap.
6. **Dispatch path — Trigger.dev prod** ❌ silent. `enqueue.ts:32` calls `tasks.trigger(id, {})` where `id` is a per-record suffix like `"transcribe-call:CA123…"`. In Trigger.dev v3 `tasks.trigger` resolves the first arg against the registered task ID (`"transcribe-call"` / `"inbound-sms-handler"`); this call will mis-resolve in prod. Inline fallback masks the bug locally (Trigger secret absent → runs `fn()` inline); with secrets set, the trigger call no-ops server-side and `fn()` is never invoked, so calls become silently unindexed.

`max_tokens` budgets are set (`400` sms, `600` call) and the transcript is capped at 12 000 chars before the LLM — cost control passes for `< $0.05/call` and `< $0.001/msg`.

`[advisory — shared file]` `embed.ts:42-45`: `embedWithOpenAI` hardcodes `"text-embedding-3-small"` while `EMBEDDING_MODEL` env exists. Provider abstraction isn't symmetric.

`[advisory — shared file]` `embed.ts:111-150` `retrieveSimilar` lives here but is Phase-4-owned; flagging only that it relies on the same unparameterized-but-bounded vector literal pattern.

`[advisory — shared file]` `trigger/inbound-sms.ts:40` SMS embed content lacks the `Next actions` blend that `enqueue.ts:65` adds — divergence between the two paths.

---

## Summary

1. **Call summary is unwired.** `summarizeCallTranscript` exists, never gets called. `ai_summaries` is never populated for calls, contact timeline loses structured summary/sentiment/topics/nextActions, and the RAG corpus is missing the planned "call summary" layer. Wire `summarizeCallTranscript` between the DB update and `embedActivity` in both `enqueue.ts` and `trigger/inbound-sms.ts`, and persist the result.
2. **PII redaction is missing.** Both summarize functions ship raw transcripts/body — including raw phone numbers already in the user prompt — to Claude. Plan mandates a prompt-instructed PII strip (SSN / card). Add the redaction pre-pass before the `messages.create` call.
3. **`tasks.trigger` is calling the wrong id.** `enqueue.ts:32` passes `"transcribe-call:CA…"` instead of the registered task ID. Trigger.dev resolves IDs against the registered task catalog, so prod jobs silently misfire and fall through (sometimes, not always). Pass the registered ID plus a separate `idempotencyKey` derived from the SID.
4. **Embed re-runs double-index.** No idempotency on `embedActivity`, no upsert, no `idempotencyKey` on the trigger task. Either add `(org_id, source_type, source_id)` partial-unique + `ON CONFLICT … DO UPDATE`, or delete-by-source-id before re-embed. Otherwise retries poison the RAG index.
5. **Embed content loses the summary for calls.** Only SMS blends body+summary into the embedded string. Calls embed raw transcript. Spec says "transcript + summary"; align the two paths and the result from fix #1.
