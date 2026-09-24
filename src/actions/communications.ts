"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  smsMessages,
  calls,
  contacts,
  contactPhones,
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

async function resolveContactPhoneE164(
  contactId: string,
  orgId: string,
): Promise<string | null> {
  const primaryPhoneRows = await db
    .select({ phone: contactPhones.phoneE164 })
    .from(contactPhones)
    .innerJoin(contacts, eq(contacts.id, contactPhones.contactId))
    .where(
      and(
        eq(contactPhones.contactId, contactId),
        eq(contacts.orgId, orgId),
        isNull(contacts.deletedAt),
        eq(contactPhones.isPrimary, true),
      ),
    )
    .orderBy(desc(contactPhones.createdAt))
    .limit(1);
  if (primaryPhoneRows[0]?.phone) return primaryPhoneRows[0].phone;

  const legacyRows = await db
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.orgId, orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  return legacyRows[0]?.phone ?? null;
}

export async function sendSmsToContact(opts: { contactId: string; body: string }) {
  if (!twilioConfigured) throw new Error("Twilio not configured");
  const { ctx } = await requireDbUser();
  const parsed = sendSmsSchema.parse(opts);

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, parsed.contactId),
        eq(contacts.orgId, ctx.orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  if (!contactRows[0]) throw new Error("Contact not found");

  const toPhone = await resolveContactPhoneE164(parsed.contactId, ctx.orgId);
  if (!toPhone) throw new Error("Contact has no phone number");

  const fromRow = await db
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.orgId, ctx.orgId), eq(phoneNumbers.status, "active")))
    .limit(1);
  const from = fromRow[0]?.number;
  if (!from) throw new Error("No active phone number — buy one in Settings");

  const result = await sendSms({ from, to: toPhone, body: parsed.body });

  const insertedSms = await db
    .insert(smsMessages)
    .values({
      orgId: ctx.orgId,
      contactId: parsed.contactId,
      phoneNumberId: fromRow[0]?.id ?? null,
      twilioMessageSid: result.sid,
      direction: "outbound",
      fromNumber: from,
      toNumber: toPhone,
      body: parsed.body,
      status: "queued",
    })
    .returning({ id: smsMessages.id });
  const smsId = insertedSms[0]?.id;

  await db.insert(activities).values({
    orgId: ctx.orgId,
    type: "sms",
    contactId: parsed.contactId,
    refId: smsId ?? null,
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
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, parsed.contactId),
        eq(contacts.orgId, ctx.orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  if (!contactRows[0]) throw new Error("Contact not found");

  const toPhone = await resolveContactPhoneE164(parsed.contactId, ctx.orgId);
  if (!toPhone) throw new Error("Contact has no phone number");

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

  const insertedCall = await db
    .insert(calls)
    .values({
      orgId: ctx.orgId,
      contactId: parsed.contactId,
      phoneNumberId: fromRow[0]?.id ?? null,
      twilioCallSid: result.sid,
      direction: "outbound",
      fromNumber: from,
      toNumber: toPhone,
      status: "queued",
    })
    .returning({ id: calls.id });
  const callId = insertedCall[0]?.id;

  await db.insert(activities).values({
    orgId: ctx.orgId,
    type: "call",
    contactId: parsed.contactId,
    refId: callId ?? null,
    summary: "Outbound call placed",
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

