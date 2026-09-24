import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { smsMessages, activities, KAVORA_ORG_ID } from "@/db/schema";
import { buildWebhookUrl } from "@/lib/twilio/client";
import { verifyTwilioWebhook } from "@/lib/twilio/signature";
import { smsInboundAck } from "@/lib/twilio/twiml";
import { readTwilioParams } from "@/lib/twilio/webhook-params";
import {
  findOrCreateContactByPhone,
  findPhoneNumberByE164,
} from "@/lib/twilio/contact-lookup";
import { enqueueInboundSms } from "@/lib/queue/enqueue";

export const runtime = "nodejs";

/**
 * POST /api/twilio/sms — Twilio hits this on inbound SMS.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);

  if (!verifyTwilioWebhook(req, params)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const { MessageSid, From, To, Body } = params;
  if (!MessageSid || !From || !To) {
    return new NextResponse("Missing required Twilio params", { status: 400 });
  }

  const [{ contactId, phoneE164 }, phoneNumberRow] = await Promise.all([
    findOrCreateContactByPhone(From, { autoCreate: true }),
    findPhoneNumberByE164(To),
  ]);

  const insertedSms = await db
    .insert(smsMessages)
    .values({
      orgId: KAVORA_ORG_ID,
      contactId,
      phoneNumberId: phoneNumberRow?.id ?? null,
      twilioMessageSid: MessageSid,
      direction: "inbound",
      fromNumber: phoneE164 ?? From,
      toNumber: To,
      body: Body ?? "",
      status: "delivered",
      deliveredAt: new Date(),
    })
    .onConflictDoNothing({ target: smsMessages.twilioMessageSid })
    .returning({ id: smsMessages.id });
  let smsId = insertedSms[0]?.id;
  if (!smsId) {
    const existing = await db
      .select({ id: smsMessages.id })
      .from(smsMessages)
      .where(and(eq(smsMessages.twilioMessageSid, MessageSid), eq(smsMessages.orgId, KAVORA_ORG_ID)))
      .limit(1);
    smsId = existing[0]?.id;
  }
  if (smsId && contactId) {
    const existingActivity = await db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.refId, smsId), eq(activities.type, "sms")))
      .limit(1);
    if (!existingActivity[0]) {
      await db.insert(activities).values({
        orgId: KAVORA_ORG_ID,
        type: "sms",
        contactId,
        refId: smsId,
        summary: (Body ?? "").slice(0, 200),
        occurredAt: new Date(),
      });
    }
  }

  await enqueueInboundSms({ messageSid: MessageSid });

  return new NextResponse(smsInboundAck(), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

