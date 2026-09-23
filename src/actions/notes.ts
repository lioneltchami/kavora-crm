"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notes, activities } from "@/db/schema";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const noteSchema = z.object({
  contactId: z.string().uuid().optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  body: z.string().min(1).max(8000),
});

export async function listNotesForContact(contactId: string) {
  const { ctx } = await requireDbUser();
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.contactId, contactId), eq(notes.orgId, ctx.orgId)))
    .orderBy(desc(notes.createdAt));
}

export async function listNotesForDeal(dealId: string) {
  const { ctx } = await requireDbUser();
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.dealId, dealId), eq(notes.orgId, ctx.orgId)))
    .orderBy(desc(notes.createdAt));
}

export async function createNote(formData: FormData) {
  const { ctx, dbRow } = await requireDbUser();
  const parsed = noteSchema.parse({
    contactId: formData.get("contactId") || null,
    dealId: formData.get("dealId") || null,
    body: formData.get("body"),
  });
  const inserted = await db
    .insert(notes)
    .values({
      orgId: ctx.orgId,
      contactId: parsed.contactId ?? null,
      dealId: parsed.dealId ?? null,
      authorUserId: dbRow.id,
      body: parsed.body,
    })
    .returning();
  const created = inserted[0];
  if (!created) throw new Error("Failed to create note");

  await db.insert(activities).values({
    orgId: ctx.orgId,
    type: "note",
    contactId: parsed.contactId ?? null,
    dealId: parsed.dealId ?? null,
    refId: created.id,
    summary: parsed.body.slice(0, 200),
  });

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "note.created",
    entity: "note",
    entityId: created.id,
  });

  if (parsed.contactId) revalidatePath(`/contacts/${parsed.contactId}`);
  if (parsed.dealId) revalidatePath(`/deals/${parsed.dealId}`);
  return created;
}
