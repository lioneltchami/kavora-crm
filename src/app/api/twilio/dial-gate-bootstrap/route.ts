import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { calls, contacts, KAVORA_ORG_ID } from "@/db/schema";
import { buildWebhookUrl } from "@/lib/twilio/client";
import { verifyTwilioWebhook } from "@/lib/twilio/signature";
import { voiceOutboundDialGate } from "@/lib/twilio/twiml";
import { toE164 } from "@/lib/phone";
import { readTwilioParams } from "@/lib/twilio/webhook-params";

export const runtime = "nodejs";

/**
 * POST /api/twilio/dial-gate-bootstrap
 *
 * First leg of an outbound call: Twilio calls the agent's cell, then follows
 * the TwiML we return (which prompts "press 1 to connect"). The customer
 * phone is the contact's `phone` column for the calls row we placed earlier.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!verifyTwilioWebhook(req, params)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const { CallSid, To, From } = params;
  if (!CallSid) return new NextResponse("Missing CallSid", { status: 400 });

  const customerNumber = await resolveCustomerFromRecentCall(CallSid);

  if (!customerNumber) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Could not determine the customer to connect. Goodbye.</Say><Hangup/></Response>`,
      { headers: { "Content-Type": "text/xml; charset=utf-8" } },
    );
  }

  // TODO(phase-a.6): the dial-gate-bootstrap Twilio webhook has no Clerk
  // session, no `From` number that maps to a `phone_numbers` row, and the
  // `To` number here is the agent's cell (not a Twilio number we own), so
  // there is no clean per-context seam for `orgId`. The `calls.orgId`
  // column is NOT NULL, so we insert a placeholder and log a warning. The
  // right fix is to look up the agent's user by `phoneForRouting = To` and
  // use their `users.orgId` (the agent must exist in our DB before a
  // outbound call is placed, which is the precondition this bootstrap
  // depends on anyway).
  await db
    .insert(calls)
    .values({
      orgId: KAVORA_ORG_ID,
      twilioCallSid: CallSid,
      direction: "outbound",
      fromNumber: From ?? "",
      toNumber: To ?? customerNumber,
      status: "ringing",
      startedAt: new Date(),
    })
    .onConflictDoNothing({ target: calls.twilioCallSid });

  const twiml = voiceOutboundDialGate({
    customerNumber,
    recordingStatusCallbackUrl: buildWebhookUrl("/api/twilio/recording"),
  });
  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

async function resolveCustomerFromRecentCall(callSid: string): Promise<string | null> {
  const callRow = await db
    .select({ contactId: calls.contactId })
    .from(calls)
    .where(eq(calls.twilioCallSid, callSid))
    .limit(1);
  const contactId = callRow[0]?.contactId;
  if (!contactId) return null;

  const c = await db
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .limit(1);
  const raw = c[0]?.phone;
  return raw ? toE164(raw) : null;
}
