import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { calls, activities, KAVORA_ORG_ID } from "@/db/schema";
import { buildWebhookUrl } from "@/lib/twilio/client";
import { verifyTwilioWebhook } from "@/lib/twilio/signature";
import { voiceInbound } from "@/lib/twilio/twiml";
import { readTwilioParams } from "@/lib/twilio/webhook-params";
import {
  findOrCreateContactByPhone,
  getInboundRoutingTargets,
  findPhoneNumberByE164,
} from "@/lib/twilio/contact-lookup";

export const runtime = "nodejs";

/**
 * POST /api/twilio/voice — Twilio hits this on inbound calls.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);

  if (!verifyTwilioWebhook(req, params)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const { CallSid, From, To } = params;
  if (!CallSid || !From || !To) {
    return new NextResponse("Missing required Twilio params", { status: 400 });
  }

  const { contactId, phoneE164 } = await findOrCreateContactByPhone(From, { autoCreate: true });
  const phoneNumberRow = await findPhoneNumberByE164(To);

  // Insert the call row idempotently, then insert the linked activity row
  // so AI summaries (Phase 3) have a parent to attach to.
  const insertedCalls = await db
    .insert(calls)
    .values({
      orgId: KAVORA_ORG_ID,
      contactId,
      phoneNumberId: phoneNumberRow?.id ?? null,
      twilioCallSid: CallSid,
      direction: "inbound",
      fromNumber: phoneE164 ?? From,
      toNumber: To,
      status: "ringing",
      startedAt: new Date(),
    })
    .onConflictDoNothing({ target: calls.twilioCallSid })
    .returning({ id: calls.id });
  let callId = insertedCalls[0]?.id;
  if (!callId) {
    const existing = await db
      .select({ id: calls.id })
      .from(calls)
      .where(and(eq(calls.twilioCallSid, CallSid), eq(calls.orgId, KAVORA_ORG_ID)))
      .limit(1);
    callId = existing[0]?.id;
  }
  if (callId) {
    await db.insert(activities).values({
      orgId: KAVORA_ORG_ID,
      type: "call",
      contactId,
      refId: callId,
      summary: `Inbound call from ${phoneE164 ?? From}`,
      occurredAt: new Date(),
    });
  }

  const targets = await getInboundRoutingTargets();
  const twiml = voiceInbound({
    routingTargets: targets,
    recordingStatusCallbackUrl: buildWebhookUrl("/api/twilio/recording"),
  });

  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

