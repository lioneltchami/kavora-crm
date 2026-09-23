"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, and, ilike, or, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contacts, type Contact } from "@/db/schema";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { toE164 } from "@/lib/phone";

const contactSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().max(120).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  source: z.string().max(120).optional().nullable(),
  status: z.enum(["lead", "active", "customer", "archived"]).default("lead"),
});

export async function listContacts(opts: {
  q?: string;
  status?: "lead" | "active" | "customer" | "archived";
  limit?: number;
}): Promise<Contact[]> {
  const { ctx } = await requireDbUser();
  const limit = opts.limit ?? 100;

  const whereParts = [eq(contacts.orgId, ctx.orgId)];
  if (opts.status) whereParts.push(eq(contacts.status, opts.status));
  if (opts.q && opts.q.trim().length > 0) {
    const q = `%${opts.q.trim()}%`;
    whereParts.push(
      or(
        ilike(contacts.firstName, q),
        ilike(contacts.lastName, q),
        ilike(contacts.email, q),
        ilike(contacts.phone, q),
      )!,
    );
  }

  return db
    .select()
    .from(contacts)
    .where(and(...whereParts))
    .orderBy(desc(contacts.updatedAt))
    .limit(limit);
}

export async function getContact(id: string): Promise<Contact | null> {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createContact(formData: FormData) {
  const { ctx, dbRow } = await requireDbUser();
  const parsed = contactSchema.parse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName") || null,
    email: formData.get("email") || null,
    phone: formData.get("phone") || null,
    companyId: formData.get("companyId") || null,
    source: formData.get("source") || null,
    status: formData.get("status") || "lead",
  });

  const phoneE164 = parsed.phone ? toE164(parsed.phone) : null;

  const inserted = await db
    .insert(contacts)
    .values({
      orgId: ctx.orgId,
      firstName: parsed.firstName,
      lastName: parsed.lastName ?? null,
      email: parsed.email || null,
      phone: phoneE164,
      companyId: parsed.companyId ?? null,
      source: parsed.source ?? null,
      status: parsed.status,
      ownerUserId: dbRow.id,
    })
    .returning();
  const created = inserted[0];
  if (!created) throw new Error("Failed to create contact");

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.created",
    entity: "contact",
    entityId: created.id,
    meta: { firstName: created.firstName },
  });

  revalidatePath("/contacts");
  return created;
}

export async function updateContact(id: string, formData: FormData) {
  const { ctx } = await requireDbUser();
  const parsed = contactSchema.partial().parse({
    firstName: formData.get("firstName") || undefined,
    lastName: formData.get("lastName") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    companyId: formData.get("companyId") || undefined,
    source: formData.get("source") || undefined,
    status: formData.get("status") || undefined,
  });

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.firstName !== undefined) update.firstName = parsed.firstName;
  if (parsed.lastName !== undefined) update.lastName = parsed.lastName;
  if (parsed.email !== undefined) update.email = parsed.email || null;
  if (parsed.phone !== undefined) update.phone = parsed.phone ? toE164(parsed.phone) : null;
  if (parsed.companyId !== undefined) update.companyId = parsed.companyId ?? null;
  if (parsed.source !== undefined) update.source = parsed.source ?? null;
  if (parsed.status !== undefined) update.status = parsed.status;

  await db
    .update(contacts)
    .set(update)
    .where(and(eq(contacts.id, id), eq(contacts.orgId, ctx.orgId)));

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.updated",
    entity: "contact",
    entityId: id,
  });

  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
}

export async function deleteContact(id: string) {
  const { ctx } = await requireDbUser();
  await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.orgId, ctx.orgId)));
  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.deleted",
    entity: "contact",
    entityId: id,
  });
  revalidatePath("/contacts");
  redirect("/contacts");
}
