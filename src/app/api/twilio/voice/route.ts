import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { calls, activities } from "@/db/schema";
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

  const phoneNumberRow = await findPhoneNumberByE164(To);
  // The orgId is the org that owns the Twilio number Twilio hit us for — there is
  // no Clerk session in a webhook. If the lookup missed (To number isn't in
  // phone_numbers), we 400 — accepting a call tagged with an unknown org would
  // leak it into the default org's history.
  if (!phoneNumberRow) {
    return new NextResponse("Unknown To number", { status: 400 });
  }
  const orgId = phoneNumberRow.orgId;
  const { contactId, phoneE164 } = await findOrCreateContactByPhone(From, {
    orgId,
    autoCreate: true,
  });

  // Insert the call row idempotently, then insert the linked activity row
  // so AI summaries (Phase 3) have a parent to attach to.
  const insertedCalls = await db
    .insert(calls)
    .values({
      orgId,
      contactId,
      phoneNumberId: phoneNumberRow.id,
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
      .where(and(eq(calls.twilioCallSid, CallSid), eq(calls.orgId, orgId)))
      .limit(1);
    callId = existing[0]?.id;
  }
  if (callId) {
    await db.insert(activities).values({
      orgId,
      type: "call",
      contactId,
      refId: callId,
      summary: `Inbound call from ${phoneE164 ?? From}`,
      occurredAt: new Date(),
    });
  }

  const targets = await getInboundRoutingTargets({ orgId });
  const twiml = voiceInbound({
    routingTargets: targets,
    recordingStatusCallbackUrl: buildWebhookUrl("/api/twilio/recording"),
  });

  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

