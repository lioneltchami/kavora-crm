"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { phoneNumbers, users } from "@/db/schema";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { env, twilioConfigured } from "@/lib/env";
import {
  searchAvailableNumbers,
  purchaseNumber,
  releaseNumber as twilioReleaseNumber,
} from "@/lib/twilio/provisioning";
import { toE164 } from "@/lib/phone";

export async function listAvailableNumbers(opts: {
  country?: string;
  areaCode?: string;
  type?: "local" | "tollfree";
}) {
  if (!twilioConfigured) return [];
  return searchAvailableNumbers(opts);
}

export async function buyPhoneNumber(opts: {
  phoneNumber: string;
  friendlyName?: string;
}) {
  const { ctx } = await requireDbUser();
  const result = await purchaseNumber(opts);
  const inserted = await db
    .insert(phoneNumbers)
    .values({
      orgId: ctx.orgId,
      twilioSid: result.sid,
      number: result.phoneNumber,
      friendlyName: result.friendlyName ?? null,
      capabilities: result.capabilities,
      voiceUrl: result.voiceUrl,
      smsUrl: result.smsUrl,
    })
    .returning();
  const created = inserted[0];
  if (!created) throw new Error("Failed to insert phone number");
  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "phone_number.purchased",
    entity: "phone_number",
    entityId: created.id,
  });
  revalidatePath("/settings/phone-numbers");
  return created;
}

export async function releasePhoneNumber(id: string) {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.id, id), eq(phoneNumbers.orgId, ctx.orgId)))
    .limit(1);
  if (!rows[0]) throw new Error("Phone number not found");
  await twilioReleaseNumber(rows[0].twilioSid);
  await db
    .update(phoneNumbers)
    .set({ status: "released" })
    .where(eq(phoneNumbers.id, id));
  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "phone_number.released",
    entity: "phone_number",
    entityId: id,
  });
  revalidatePath("/settings/phone-numbers");
}

const routingSchema = z.object({
  phoneForRouting: z.string().optional().nullable(),
});

export async function updateMyRoutingPhone(formData: FormData) {
  const { ctx, dbRow } = await requireDbUser();
  const parsed = routingSchema.parse({
    phoneForRouting: formData.get("phoneForRouting") || null,
  });
  const e164 = parsed.phoneForRouting ? toE164(parsed.phoneForRouting) : null;
  await db
    .update(users)
    .set({ phoneForRouting: e164, updatedAt: new Date() })
    .where(eq(users.id, dbRow.id));
  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "user.routing_phone_updated",
    entity: "user",
    entityId: dbRow.id,
    meta: { phoneForRouting: e164 ? "[set]" : "[cleared]" },
  });
  revalidatePath("/settings/team");
}
