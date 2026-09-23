# Phase 2 — Twilio working number review

## ponytail

src/lib/twilio/signature.ts:33-43: delete: `getTwilioSignatureParts` is exported but no caller imports it. Drop the helper and the import chain callers fake. Nothing replaces it.
src/actions/communications.ts:139-152: delete: `listInboxThreads` is dead — not called by `/inbox` or anywhere else in the repo. Delete.
src/components/calls/recording-player.tsx:1-33: delete: defined but never imported (`grep -r RecordingPlayer src/` returns zero usages). `/calls` page references "recording →" text only. Delete until the page actually mounts it.
src/components/inbox/sms-composer.tsx:38: native: hard-coded `maxLength={1600}` duplicates the Twilio SMS cap. Use one constant; do not re-derive.
src/actions/communications.ts:154: delete: `void KAVORA_ORG_ID;` is a dead-import suppression. Remove the import.
src/actions/settings.ts:97: delete: same — `void KAVORA_ORG_ID;` covers an unused import. Remove it.
src/lib/twilio/provisioning.ts:24-63: shrink: 40-line `unknown` cast block duplicates the `.local` and `.tollFree` shapes. One local type + a single `list` call keyed on a lookup beats the duplicated casts.
src/lib/twilio/twiml.ts:75-95: yagni: `voiceOutboundDialGate` accepts `callerId` and `recordingStatusCallbackUrl` it never uses (see L92-93 `void` markers). Drop the params from both the signature and the caller in `dial-gate/route.ts:30-34`.
src/lib/twilio/twiml.ts:39: yagni: `callerId: undefined` is a no-op argument; delete.
src/lib/twilio/webhook-params.ts:9-15: shrink: `Object.fromEntries([...fd.entries()].filter(([,v]) => typeof v === "string"))`, one line.
src/lib/twilio/twiml.ts:22: yagni: `CONSENT_MESSAGE` constant exists but is also re-typed inline at L32, L57, L82, L90, L107, L128 in similar `<Say>` blocks. Pick one.
src/app/api/twilio/recording/route.ts:25-28: shrink: the early-return `if (!CallSid || !RecordingUrl || RecordingStatus !== "completed")` could be a guard at the top — already is, but the same pattern recurs in voice/sms. Extract one helper if a third instance appears.
src/app/api/twilio/voicemail/route.ts:1-21: yagni: handler returns TwiML but never inspects the dial-action payload (`DialCallStatus`, recording SID, duration). At minimum log or persist; otherwise the action callback is decorative.
net: -80 lines possible.

## Standards

All eight public webhook routes export `runtime = "nodejs"` and verify `X-Twilio-Signature` on every entry — that part of the AGENTS contract is met. Idempotency is honoured: `voice/route.ts:50`, `sms/route.ts:51`, `dial-gate-bootstrap/route.ts:53` all use `onConflictDoNothing` on the Twilio SID column, and the schema enforces unique indexes on `twilioCallSid` / `twilioMessageSid` (`db/schema.ts:398, 439`). The Twilio client uses API Key SID + Secret (subaccount, not master token) per the Security & Compliance section (`lib/twilio/client.ts:18-22`); recordings are fetched with the same subaccount credentials (`storage.ts:33-37`); the bucket path is served via signed URLs only (`recording-url/route.ts:37-39`); no PII (phone numbers, recording URLs) is logged anywhere.

Standards breaches:

- `actions/settings.ts:22` reads `process.env.TWILIO_ACCOUNT_SID` directly. AGENTS.md forbids that: "Env — only access via `import { env } from "@/lib/env"`". Use `env.TWILIO_ACCOUNT_SID` and the `twilioConfigured` guard that `communications.ts:28` already uses.
- `actions/communications.ts:154` and `actions/settings.ts:97` both contain `void KAVORA_ORG_ID;` to suppress unused-import lint. That is a Mysterious Name smell — the import looks load-bearing but isn't. Delete the import.
- `app/api/twilio/dial-gate/route.ts:14-20` computes the verification URL as `buildWebhookUrl("/api/twilio/dial-gate")` while Twilio's `<Gather>` posts to `…/dial-gate?customer=…` (set in `twiml.ts:85`). Twilio signs the URL **including** the query string, so the signatures will never match and every "press 1" call will return 401. Same shape problem in `voiceOutboundDialGate` consumers — fix by reconstructing the URL from `new URL(req.url)`.
- `app/api/twilio/recording-url/route.ts:27-31` loads a `calls` row by `callId` without an org filter — a signed URL is minted for any row in any org. In v1 single-tenant this is moot, but the smell is "Feature Envy reaching past the auth boundary"; add `eq(calls.orgId, ctx.orgId)`.
- `db/schema.ts:177` indexes `(orgId, phone)` for contact lookup but does not mark it unique. `contact-lookup.ts:39-49` races on concurrent auto-create. A `uniqueIndex` makes it `onConflictDoNothing`-able.
- `twiml.ts:39-117` mixes absolute URLs (`recordingStatusCallbackUrl` passed in) with hard-coded relative paths (`action: "/api/twilio/voicemail"`, `statusCallback: "/api/twilio/status"`). Twilio accepts relative TwiML URLs, but the inconsistency makes URL-construction errors invisible. Pick one style.
- `sms-composer.tsx:38` hard-codes `maxLength={1600}` instead of deriving from the Twilio limit or schema.

## Spec

Acceptance for "Working number" specifically, mapped to the diff:

- ✅ "Real US number purchased via settings page" — `phone-numbers/buy/page.tsx` calls `buyPhoneNumber` → `provisioning.purchaseNumber`. Wired automatically.
- ✅ "Inbound call rings at least one team member's cell" — `voiceInbound` walks `getInboundRoutingTargets()` and `<Dial><Number>` chains them.
- ⚠️ "Recording appears on contact page" — recording **download** to Supabase Storage is implemented (`recording/route.ts:31-42`) and `RecordingPlayer` exists, but `/calls` page does not mount `RecordingPlayer` (`calls/page.tsx:87` shows a static "recording →" string instead). The 90-second transcript + AI summary target is correctly deferred to Phase 3.
- ✅ "SMS inbound → inbox tied to contact or created" — `sms/route.ts:34` auto-creates via `findOrCreateContactByPhone({autoCreate:true})`. `inbox/page.tsx` renders the row.
- ⚠️ "Replying to that SMS from `/inbox` delivers to original sender" — `SmsComposer` is mounted only on `/contacts/[id]` (`grep` confirms). The `/inbox` page has no composer and groups nothing by contact; it is a flat 100-row feed. The acceptance line for inbox is **unmet as written**; current `/inbox` is a list, not a thread.
- ✅ "Outbound call rings user's cell with press-1 gate" — `placeOutboundCall` → `dial-gate-bootstrap` → `voiceOutboundDialGate` → `dial-gate` → `voiceConnectToCustomer`. **However**, `dial-gate/route.ts:14-20` signature-verifies against `…/dial-gate` while Twilio posts to `…/dial-gate?customer=…`, so signature verification will fail in production. Currently works only against `twilio.test()` in unit tests, which Twilio recommends against for prod parity.
- ✅ "All webhooks reject unsigned requests" — verified per route, modulo the dial-gate URL bug above.
- ⚠️ `placeOutboundCall` (`provisioning.ts:151-158`) hands Twilio `to=agentPhone` with `url=dial-gate-bootstrap`. `dial-gate-bootstrap` then looks up the customer by `CallSid → calls.contactId → contacts.phone` (`dial-gate-bootstrap/route.ts:65-80`). The `calls` row is inserted by `startOutboundCall` **before** Twilio invokes bootstrap, so this works — but it relies on a tight race against Twilio's webhook fan-out. A `customer` POST param (or `SendDigits`) would remove the coupling.

## Summary

1. **Fix `/api/twilio/dial-gate` signature mismatch** — reconstruct the URL from `new URL(req.url)` before `verifyTwilioSignature`; the current verification URL omits the `?customer=…` query string Twilio actually posts to. Same risk class would catch the next caller that adds a query param.
2. **Make `/inbox` a real thread view** — group by `contactId`, show full conversation, mount `SmsComposer` (or a thread-reply form) so the "reply from inbox delivers to original sender" acceptance is met, not deferred.
4. **Mount `RecordingPlayer` in `/calls`** — currently defined and unused; without it the listing shows a placeholder string and no audio. Either wire it into the row or delete the component.
3. **Eliminate the outbound-call race** — pass the customer number as a Twilio custom parameter (`customer=…` in the bootstrap POST or `SendDigits`) instead of looking up the contact row inside `dial-gate-bootstrap`.
4. **Reach-standards: use `env`, not `process.env`** — `actions/settings.ts:22` directly reads `process.env.TWILIO_ACCOUNT_SID`. AGENTS.md is explicit; replace with the `twilioConfigured` guard already used in `communications.ts`.
5. **Tighten the data model for idempotency** — make `contacts(orgId, phone)` unique so `findOrCreateContactByPhone` cannot race-create duplicates on parallel inbound webhooks; require an org check on `recording-url` so the signed URL is bound to the caller's tenant.