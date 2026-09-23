import "server-only";
import twilio from "twilio";
import { env, twilioConfigured } from "@/lib/env";

/**
 * Twilio REST client. Uses API Key + Secret (NOT the master auth token) so that
 * if any one integration is compromised, blast radius is the subaccount only.
 */
let cachedClient: ReturnType<typeof twilio> | null = null;

export function getTwilioClient() {
  if (!twilioConfigured) {
    throw new Error(
      "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, " +
        "TWILIO_API_KEY_SECRET, and TWILIO_AUTH_TOKEN in your environment.",
    );
  }
  if (!cachedClient) {
    cachedClient = twilio(env.TWILIO_API_KEY_SID!, env.TWILIO_API_KEY_SECRET!, {
      accountSid: env.TWILIO_ACCOUNT_SID!,
    });
  }
  return cachedClient;
}

/** Subaccount SID — used for webhook signature verification. */
export const TWILIO_ACCOUNT_SID = env.TWILIO_ACCOUNT_SID ?? "";

/** Auth token for the subaccount — used ONLY for X-Twilio-Signature verification. */
export const TWILIO_AUTH_TOKEN = env.TWILIO_AUTH_TOKEN ?? "";

/** Public app URL — used to build webhook URLs when provisioning a number. */
export const APP_URL = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export function buildWebhookUrl(path: string): string {
  return `${APP_URL.replace(/\/$/, "")}${path}`;
}
