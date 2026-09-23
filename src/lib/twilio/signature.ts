import "server-only";
import { validateRequest } from "twilio";
import { TWILIO_AUTH_TOKEN } from "./client";
import { env } from "@/lib/env";

/**
 * Verify a Twilio webhook signature.
 *
 * Twilio sends `X-Twilio-Signature`. The expected signature is computed from:
 *   - the full URL Twilio requested (pathname + search/query string)
 *   - the sorted, URL-encoded POST params concatenated with their values
 * Both are HMAC-SHA1'd with the subaccount auth token.
 *
 * Returns true if the request is authentic; false otherwise.
 *
 * IMPORTANT: Always call this on every Twilio webhook before processing.
 *            Always include the query string in the URL — Twilio signs URLs
 *            with their full search component.
 */
export function verifyTwilioSignature(opts: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!TWILIO_AUTH_TOKEN) {
    console.error("[twilio] TWILIO_AUTH_TOKEN missing — cannot verify signatures");
    return false;
  }
  if (!opts.signature) return false;
  return validateRequest(TWILIO_AUTH_TOKEN, opts.signature, opts.url, opts.params);
}

/**
 * Build the public URL Twilio signed from a Next.js Request.
 *
 * Twilio resolves the webhook hostname via DNS, so the URL we sign against
 * MUST be the public-facing one. In production we require
 * NEXT_PUBLIC_APP_URL — refusing to guess protects us from accidentally
 * signing against the wrong host (e.g. an internal proxy).
 *
 * In dev (`NODE_ENV !== "production"`), fall back to the request's own host
 * so ngrok / local tunnels work without configuration.
 */
export function publicUrlFromRequest(req: Request): string {
  const u = new URL(req.url);
  const publicBase = env.NEXT_PUBLIC_APP_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}${u.pathname}${u.search}`;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is required in production for Twilio signature verification. " +
        "Without it we cannot safely reconstruct the signed URL.",
    );
  }
  // Dev only: derive from the request itself.
  return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
}

/**
 * Convenience: verify a Twilio webhook from a Next.js Request in one call.
 * Always include the query string in the verification URL.
 */
export function verifyTwilioWebhook(req: Request, params: Record<string, string>): boolean {
  return verifyTwilioSignature({
    signature: req.headers.get("x-twilio-signature"),
    url: publicUrlFromRequest(req),
    params,
  });
}
