import "server-only";
import { z } from "zod";

/**
 * Centralized, validated env access. Throws on boot if a required var is missing
 * in production; in dev, we collect errors and log them but allow the app to boot
 * with a degraded subset (useful for partial demos).
 */

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),
  DATABASE_APP_ROLE: z.string().optional(),
  DATABASE_APP_ROLE_PASSWORD: z.string().optional(),
  DATABASE_URL_TEST: z.string().url().optional(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // AI
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_HAIKU: z.string().default("claude-haiku-4-5"),
  ANTHROPIC_MODEL_SONNET: z.string().default("claude-sonnet-4-5"),

  DEEPGRAM_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("voyage-3"),
  EMBEDDING_DIMS: z.coerce.number().int().default(1024),

  // Trigger.dev
  TRIGGER_SECRET_KEY: z.string().optional(),
  TRIGGER_PROJECT_ID: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),

  // Email (optional v2)
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[env] invalid environment variables:", parsed.error.flatten().fieldErrors);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Invalid environment");
  }
}

export const env = parsed.success ? parsed.data : (process.env as unknown as z.infer<typeof envSchema>);

/** True if Twilio is configured enough to send/receive. */
export const twilioConfigured = Boolean(
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN,
);

/** True if Anthropic is configured. */
export const anthropicConfigured = Boolean(env.ANTHROPIC_API_KEY);

/** True if Deepgram is configured. */
export const deepgramConfigured = Boolean(env.DEEPGRAM_API_KEY);

/** True if we have any embeddings provider. */
export const embeddingsConfigured = Boolean(env.VOYAGE_API_KEY || env.OPENAI_API_KEY);
