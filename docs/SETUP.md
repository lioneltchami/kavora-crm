# Setup

Step-by-step provisioning for every external service Kavora CRM needs, plus local development.

> **Time estimate:** 60–90 minutes the first time. ~10 minutes for subsequent env changes.

---

## 1. Supabase (Postgres + Storage + pgvector)

1. Create a project at [supabase.com](https://supabase.com).
2. **Database → Connection string → Transaction pooler** → copy as `DATABASE_URL`.
3. **Database → Connection string → Direct connection** → copy as `DIRECT_URL`.
4. **Settings → API → Project URL** → `NEXT_PUBLIC_SUPABASE_URL`.
5. **Settings → API → service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (server-only, never expose).
6. **Storage → Create bucket** named `call-recordings`, **private** (not public).
7. After the first migration, in the SQL editor run the migration in `src/db/migrations/0001_init.sql` (or use `pnpm db:migrate` against the direct URL).

---

## 2. Clerk (Auth)

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. Copy publishable + secret keys to `.env.local`.
3. **Webhooks → Add endpoint** → URL `<your-domain>/api/webhooks/clerk`, subscribe to `user.created`, `user.updated`, `user.deleted`. Copy the **Signing Secret** to `CLERK_WEBHOOK_SECRET`.
4. In **Paths**, set sign-in/sign-up to `/sign-in` and `/sign-up`.
5. (Optional) Enable Google + email/password providers.

---

## 3. Twilio (the working number)

We use a **subaccount + API key** for blast-radius isolation. Do NOT use your master auth token.

1. In Twilio Console → **Account → Subaccounts → Create new**.
2. Inside the subaccount: **Account → API keys & tokens → Create new API key**. Copy SID + Secret.
3. **Phone Numbers → Manage → Buy a number** OR let the CRM do it: skip this if you'll buy from `/settings/phone-numbers/buy`.
4. Note the **subaccount Account SID** (`AC…`) and the **subaccount Auth Token** (used only for webhook signature verification).
5. Fill in:
   ```
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_API_KEY_SID=SK...
   TWILIO_API_KEY_SECRET=...
   TWILIO_AUTH_TOKEN=...
   NEXT_PUBLIC_APP_URL=https://your-deployment-domain
   ```

### US call recording consent

Default TwiML plays *"This call may be recorded for quality and training."* before any agent pickup. Colorado is a one-party-consent state, but customers in two-party states (CA, FL, WA, …) need to hear this. Edit `src/lib/twilio/twiml.ts` (`CONSENT_MESSAGE`) to customize.

---

## 4. Anthropic (LLM — call summaries + outreach drafts)

1. Get an API key at [console.anthropic.com](https://console.anthropic.com).
2. Set `ANTHROPIC_API_KEY=sk-ant-...`.
3. Defaults: `claude-haiku-4-5` for summaries/scoring, `claude-sonnet-4-5` for outreach drafts.

---

## 5. Deepgram (call transcription)

1. Get an API key at [console.deepgram.com](https://console.deepgram.com).
2. Set `DEEPGRAM_API_KEY=...`.
3. We use the `nova-2` model with `smart_format=true`.

---

## 6. Embeddings (pgvector)

Pick **one**:

**Voyage (recommended, cheaper, better retrieval):**
- Get an API key at [dash.voyageai.com](https://dash.voyageai.com).
- Set `VOYAGE_API_KEY=...`, leave defaults `EMBEDDING_MODEL=voyage-3`, `EMBEDDING_DIMS=1024`.

**OpenAI:**
- Set `OPENAI_API_KEY=sk-...`. We use `text-embedding-3-small` (1536 dims — change schema if you go this route).

---

## 7. Trigger.dev (background jobs)

Only required for **prod**. In dev, jobs run inline.

1. Create a project at [cloud.trigger.dev](https://cloud.trigger.dev).
2. Copy `TRIGGER_SECRET_KEY=tr_dev_...` and `TRIGGER_PROJECT_ID=proj_...`.
3. Deploy tasks: `npx trigger.dev deploy` (uses `trigger.config.ts`).

---

## 8. Optional: Sentry + PostHog + SendGrid

- **Sentry** — `SENTRY_DSN` for error tracking, `SENTRY_AUTH_TOKEN` for release source maps.
- **PostHog** — `NEXT_PUBLIC_POSTHOG_KEY` for product analytics.
- **SendGrid** — for outbound email (Phase 5+). `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`.

---

## Local development

```bash
pnpm install
cp .env.example .env.local          # fill in values
pnpm db:migrate                     # runs migrations against DIRECT_URL
pnpm dev                            # http://localhost:3000
```

### Expose Twilio webhooks to your local machine

Twilio webhooks need a public URL. Use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
ngrok http 3000
# then set NEXT_PUBLIC_APP_URL=https://<your-ngrok>.ngrok-free.app
```

After buying a number from `/settings/phone-numbers/buy`, Twilio's webhook URLs will be auto-wired to that domain.

### Useful scripts

```bash
pnpm dev                # Next.js dev server
pnpm build              # production build
pnpm start              # production server
pnpm typecheck          # tsc --noEmit
pnpm lint               # next lint
pnpm db:generate        # regenerate SQL from schema.ts
pnpm db:migrate         # apply migrations
pnpm db:push            # dev-mode schema push
pnpm db:studio          # Drizzle Studio (DB browser)
pnpm format             # prettier
```

---

## First-time verification

After standing everything up, exercise the critical path:

1. Sign in via Clerk — confirm a row in `users` is created.
2. Go to **Settings → Phone numbers → Buy** and purchase a number.
3. Call the number from your cell.
4. Confirm your cell rings, the call is recorded, and a `calls` row appears.
5. Send an SMS to the number — confirm it appears in `/inbox` and is tied to a contact.
6. Add a contact manually if needed, then click **Call** on the contact page — confirm your cell rings with "Press 1 to connect."
7. Click **Draft outreach** on the contact page (requires Anthropic + Voyage/OpenAI keys).

If all 7 pass, the "working number" acceptance criteria are met.
