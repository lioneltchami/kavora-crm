"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiStyles, aiDrafts } from "@/db/schema";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { draftOutreach, type MultiDraftResult } from "@/lib/ai/draft";

const draftSchema = z.object({
  contactId: z.string().uuid(),
  channel: z.enum(["email", "sms"]),
  intent: z.string().min(1).max(500),
});

export async function draftOutreachAction(opts: {
  contactId: string;
  channel: "email" | "sms";
  intent: string;
}): Promise<
  | (MultiDraftResult & { ok: true })
  | { ok: false; reason: "ai_not_configured" | "no_contact" }
> {
  const { ctx } = await requireDbUser();
  const parsed = draftSchema.parse(opts);
  const result = await draftOutreach({
    orgId: ctx.orgId,
    contactId: parsed.contactId,
    authorUserId: ctx.userId,
    channel: parsed.channel,
    intent: parsed.intent,
  });
  if (!result) return { ok: false, reason: "ai_not_configured" };

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "ai.draft",
    entity: "contact",
    entityId: parsed.contactId,
    meta: {
      channel: parsed.channel,
      model: result.model,
      retrievedCount: result.retrievedContextIds.length,
      candidateCount: result.candidates.length,
    },
  });

  return { ok: true, ...result };
}

export async function listDraftsForContact(contactId: string) {
  const { ctx } = await requireDbUser();
  return db
    .select()
    .from(aiDrafts)
    .where(and(eq(aiDrafts.contactId, contactId), eq(aiDrafts.orgId, ctx.orgId)))
    .orderBy(desc(aiDrafts.createdAt));
}

const styleSchema = z.object({
  examples: z.array(z.string().min(1)).max(20),
  notes: z.string().max(2000).optional().nullable(),
});

export async function saveVoiceStyle(formData: FormData) {
  const { ctx } = await requireDbUser();
  const examplesRaw = formData.getAll("example").map((e) => String(e));
  const parsed = styleSchema.parse({
    examples: examplesRaw.filter(Boolean),
    notes: formData.get("notes") || null,
  });

  await db
    .insert(aiStyles)
    .values({
      orgId: ctx.orgId,
      userId: ctx.userId,
      examples: parsed.examples,
      notes: parsed.notes ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiStyles.userId,
      set: {
        examples: parsed.examples,
        notes: parsed.notes ?? null,
        updatedAt: new Date(),
      },
    });

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "ai.style_saved",
    entity: "user",
    entityId: ctx.userId,
    meta: { exampleCount: parsed.examples.length },
  });
}

export async function getMyVoiceStyle() {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select()
    .from(aiStyles)
    .where(and(eq(aiStyles.userId, ctx.userId), eq(aiStyles.orgId, ctx.orgId)))
    .limit(1);
  return rows[0] ?? null;
}
