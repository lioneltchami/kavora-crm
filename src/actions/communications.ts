"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  smsMessages,
  calls,
  contacts,
  users,
  phoneNumbers,
  activities,
} from "@/db/schema";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sendSms, placeOutboundCall } from "@/lib/twilio/provisioning";
import { toE164 } from "@/lib/phone";
import { twilioConfigured } from "@/lib/env";

const sendSmsSchema = z.object({
  contactId: z.string().uuid(),
  body: z.string().min(1).max(1600),
});

export async function sendSmsToContact(opts: { contactId: string; body: string }) {
  if (!twilioConfigured) throw new Error("Twilio not configured");
  const { ctx } = await requireDbUser();
  const parsed = sendSmsSchema.parse(opts);

  const contactRows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, parsed.contactId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  const contact = contactRows[0];
  if (!contact?.phone) throw new Error("Contact has no phone number");

  const fromRow = await db
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.orgId, ctx.orgId), eq(phoneNumbers.status, "active")))
    .limit(1);
  const from = fromRow[0]?.number;
  if (!from) throw new Error("No active phone number — buy one in Settings");

  const result = await sendSms({ from, to: contact.phone, body: parsed.body });

  await db.insert(smsMessages).values({
    orgId: ctx.orgId,
    contactId: parsed.contactId,
    phoneNumberId: fromRow[0]?.id ?? null,
    twilioMessageSid: result.sid,
    direction: "outbound",
    fromNumber: from,
    toNumber: contact.phone,
    body: parsed.body,
    status: "queued",
  });

  await db.insert(activities).values({
    orgId: ctx.orgId,
    type: "sms",
    contactId: parsed.contactId,
    summary: `SMS: ${parsed.body.slice(0, 100)}`,
  });

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "sms.sent",
    entity: "contact",
    entityId: parsed.contactId,
  });

  revalidatePath(`/contacts/${parsed.contactId}`);
  revalidatePath("/inbox");
  return { sid: result.sid };
}

const callSchema = z.object({
  contactId: z.string().uuid(),
});

export async function startOutboundCall(opts: { contactId: string }) {
  if (!twilioConfigured) throw new Error("Twilio not configured");
  const { ctx, dbRow } = await requireDbUser();
  const parsed = callSchema.parse(opts);

  const contactRows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, parsed.contactId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  const contact = contactRows[0];
  if (!contact?.phone) throw new Error("Contact has no phone number");

  const agents = await db
    .select({ phone: users.phoneForRouting })
    .from(users)
    .where(and(eq(users.orgId, ctx.orgId), eq(users.id, dbRow.id)));
  const agentPhone = agents[0]?.phone ? toE164(agents[0].phone) : null;
  if (!agentPhone) throw new Error("Set your phone number in Settings → Team first");

  const fromRow = await db
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.orgId, ctx.orgId), eq(phoneNumbers.status, "active")))
    .limit(1);
  const from = fromRow[0]?.number;
  if (!from) throw new Error("No active phone number — buy one in Settings");

  const result = await placeOutboundCall({ from, to: agentPhone });

  await db.insert(calls).values({
    orgId: ctx.orgId,
    contactId: parsed.contactId,
    phoneNumberId: fromRow[0]?.id ?? null,
    twilioCallSid: result.sid,
    direction: "outbound",
    fromNumber: from,
    toNumber: contact.phone,
    status: "queued",
  });

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "call.started",
    entity: "contact",
    entityId: parsed.contactId,
  });

  revalidatePath(`/contacts/${parsed.contactId}`);
  return { sid: result.sid };
}

