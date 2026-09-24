"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ilike, or, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  contacts,
  contactEmails,
  contactPhones,
  type Contact,
  type ContactEmail,
  type ContactPhone,
} from "@/db/schema";
import { contactsSummaryView, type ContactSummary } from "@/db/views";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { toE164 } from "@/lib/phone";

const contactChannelEnum = z.enum(["work", "home", "other"]);

const emailInputSchema = z.object({
  email: z.string().email().max(320),
  type: contactChannelEnum.default("work"),
  isPrimary: z.boolean().default(false),
});

const phoneInputSchema = z.object({
  phone: z.string().min(7).max(32),
  type: contactChannelEnum.default("work"),
  isPrimary: z.boolean().default(false),
});

const emailAddSchema = emailInputSchema.extend({
  contactId: z.string().uuid(),
});

const phoneAddSchema = phoneInputSchema.extend({
  contactId: z.string().uuid(),
});

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
}): Promise<ContactSummary[]> {
  const { ctx } = await requireDbUser();
  const limit = opts.limit ?? 100;

  const whereParts = [eq(contactsSummaryView.org_id, ctx.orgId)];
  if (opts.status && ["lead", "active", "customer", "archived"].includes(opts.status)) {
    whereParts.push(eq(contactsSummaryView.status, opts.status));
  }
  if (opts.q && opts.q.trim().length > 0) {
    const q = `%${opts.q.trim()}%`;
    whereParts.push(
      or(
        ilike(contactsSummaryView.first_name, q),
        ilike(contactsSummaryView.last_name, q),
        ilike(contactsSummaryView.email, q),
        ilike(contactsSummaryView.phone, q),
      )!,
    );
  }

  return db
    .select()
    .from(contactsSummaryView)
    .where(and(...whereParts))
    .orderBy(desc(contactsSummaryView.updated_at))
    .limit(limit);
}

export async function getContact(id: string): Promise<Contact | null> {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, id),
        eq(contacts.orgId, ctx.orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getContactEmailsAndPhones(contactId: string): Promise<{
  emails: ContactEmail[];
  phones: ContactPhone[];
}> {
  const { ctx } = await requireDbUser();
  const owned = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.orgId, ctx.orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  if (owned.length === 0) return { emails: [], phones: [] };

  const [emails, phones] = await Promise.all([
    db
      .select()
      .from(contactEmails)
      .where(eq(contactEmails.contactId, contactId)),
    db
      .select()
      .from(contactPhones)
      .where(eq(contactPhones.contactId, contactId)),
  ]);
  return { emails, phones };
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

  const rawEmails = formData.get("emails");
  const rawPhones = formData.get("phones");
  const emails = rawEmails
    ? z.array(emailInputSchema).parse(JSON.parse(String(rawEmails)))
    : [];
  const phonesRaw = rawPhones
    ? z.array(phoneInputSchema).parse(JSON.parse(String(rawPhones)))
    : [];
  const phones = phonesRaw.map((p) => {
    const e164 = toE164(p.phone);
    if (!e164) throw new Error(`Invalid phone number: ${p.phone}`);
    return { ...p, phone: e164 };
  });

  const primaryEmail = emails.find((e) => e.isPrimary)?.email ?? parsed.email ?? null;
  const primaryPhoneRaw =
    phones.find((p) => p.isPrimary)?.phone ?? parsed.phone ?? null;
  const primaryPhone = primaryPhoneRaw ? (toE164(primaryPhoneRaw) ?? null) : null;

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(contacts)
      .values({
        orgId: ctx.orgId,
        firstName: parsed.firstName,
        lastName: parsed.lastName ?? null,
        email: primaryEmail || null,
        phone: primaryPhone,
        companyId: parsed.companyId ?? null,
        source: parsed.source ?? null,
        status: parsed.status,
        ownerUserId: dbRow.id,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("Failed to create contact");

    const emailsToInsert = emails.length > 0
      ? emails
      : primaryEmail
        ? [{ email: primaryEmail, type: "work" as const, isPrimary: true }]
        : [];
    if (emailsToInsert.length > 0) {
      await tx.insert(contactEmails).values(
        emailsToInsert.map((e) => ({
          contactId: row.id,
          email: e.email,
          type: e.type,
          isPrimary: e.isPrimary,
        })),
      );
    }
    const phonesToInsert = phones.length > 0
      ? phones
      : primaryPhone
        ? [{ phone: primaryPhone, type: "work" as const, isPrimary: true }]
        : [];
    if (phonesToInsert.length > 0) {
      await tx.insert(contactPhones).values(
        phonesToInsert.map((p) => ({
          contactId: row.id,
          phoneE164: p.phone,
          type: p.type,
          isPrimary: p.isPrimary,
        })),
      );
    }
    return row;
  });

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.created",
    entity: "contact",
    entityId: created.id,
    meta: { firstName: created.firstName, nbEmails: emails.length, nbPhones: phones.length },
  });

  revalidatePath("/contacts");
  return created;
}

export async function updateContact(id: string, formData: FormData) {
  const { ctx } = await requireDbUser();
  const parsed = contactSchema.partial().parse({
    firstName: formData.get("firstName") || undefined,
    lastName: formData.get("lastName") || null,
    email: formData.get("email") || null,
    phone: formData.get("phone") || null,
    companyId: formData.get("companyId") || null,
    source: formData.get("source") || null,
    status: formData.get("status") || undefined,
  });

  const rawEmails = formData.get("emails");
  const rawPhones = formData.get("phones");
  const hasChannelArrays =
    typeof rawEmails === "string" || typeof rawPhones === "string";

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.firstName !== undefined) update.firstName = parsed.firstName;
  if (parsed.lastName !== undefined) update.lastName = parsed.lastName;
  if (!hasChannelArrays) {
    if (parsed.email !== undefined) update.email = parsed.email || null;
    if (parsed.phone !== undefined)
      update.phone = parsed.phone ? toE164(parsed.phone) : null;
  }
  if (parsed.companyId !== undefined) update.companyId = parsed.companyId ?? null;
  if (parsed.source !== undefined) update.source = parsed.source ?? null;
  if (parsed.status !== undefined) update.status = parsed.status;

  await db.transaction(async (tx) => {
    await tx
      .update(contacts)
      .set(update)
      .where(and(eq(contacts.id, id), eq(contacts.orgId, ctx.orgId)));

    if (hasChannelArrays) {
      const emailsRaw: unknown = rawEmails ? JSON.parse(rawEmails as string) : [];
      const phonesRaw: unknown = rawPhones ? JSON.parse(rawPhones as string) : [];
      const emailsParsed = z.array(emailInputSchema).parse(
        Array.isArray(emailsRaw) ? emailsRaw : [],
      );
      const phonesParsed = z.array(phoneInputSchema).parse(
        Array.isArray(phonesRaw) ? phonesRaw : [],
      );
      const phonesNormalized = phonesParsed.map((p) => {
        const e164 = toE164(p.phone);
        if (!e164) throw new Error(`Invalid phone number: ${p.phone}`);
        return { ...p, phone: e164 };
      });
      const primaryEmail =
        emailsParsed.find((e) => e.isPrimary)?.email ??
        emailsParsed[0]?.email ??
        null;
      const primaryPhone =
        phonesNormalized.find((p) => p.isPrimary)?.phone ??
        phonesNormalized[0]?.phone ??
        null;

      await tx.delete(contactEmails).where(eq(contactEmails.contactId, id));
      await tx.delete(contactPhones).where(eq(contactPhones.contactId, id));
      if (emailsParsed.length > 0) {
        await tx.insert(contactEmails).values(
          emailsParsed.map((e) => ({
            contactId: id,
            email: e.email,
            type: e.type,
            isPrimary: e.isPrimary,
          })),
        );
      }
      if (phonesNormalized.length > 0) {
        await tx.insert(contactPhones).values(
          phonesNormalized.map((p) => ({
            contactId: id,
            phoneE164: p.phone,
            type: p.type,
            isPrimary: p.isPrimary,
          })),
        );
      }
      await tx
        .update(contacts)
        .set({ email: primaryEmail, phone: primaryPhone })
        .where(and(eq(contacts.id, id), eq(contacts.orgId, ctx.orgId)));
      return;
    }

    const newEmail = parsed.email !== undefined ? parsed.email || null : undefined;
    const newPhone =
      parsed.phone !== undefined ? (parsed.phone ? toE164(parsed.phone) : null) : undefined;

    if (newEmail !== undefined) {
      await tx
        .update(contactEmails)
        .set({ isPrimary: false })
        .where(
          and(eq(contactEmails.contactId, id), eq(contactEmails.isPrimary, true)),
        );
      if (newEmail) {
        const existing = await tx
          .select({ id: contactEmails.id })
          .from(contactEmails)
          .where(
            and(eq(contactEmails.contactId, id), eq(contactEmails.email, newEmail)),
          )
          .limit(1);
        if (existing[0]) {
          await tx
            .update(contactEmails)
            .set({ isPrimary: true })
            .where(eq(contactEmails.id, existing[0].id));
        } else {
          await tx.insert(contactEmails).values({
            contactId: id,
            email: newEmail,
            type: "work",
            isPrimary: true,
          });
        }
      }
    }

    if (newPhone !== undefined) {
      await tx
        .update(contactPhones)
        .set({ isPrimary: false })
        .where(
          and(eq(contactPhones.contactId, id), eq(contactPhones.isPrimary, true)),
        );
      if (newPhone) {
        const existing = await tx
          .select({ id: contactPhones.id })
          .from(contactPhones)
          .where(
            and(
              eq(contactPhones.contactId, id),
              eq(contactPhones.phoneE164, newPhone),
            ),
          )
          .limit(1);
        if (existing[0]) {
          await tx
            .update(contactPhones)
            .set({ isPrimary: true })
            .where(eq(contactPhones.id, existing[0].id));
        } else {
          await tx.insert(contactPhones).values({
            contactId: id,
            phoneE164: newPhone,
            type: "work",
            isPrimary: true,
          });
        }
      }
    }
  });

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

/**
 * Soft-delete a contact by stamping `deleted_at`. Reversible for the duration
 * of the undo window via `restoreContact`. Does NOT redirect — the caller (the
 * `undoable` toast) decides whether to navigate.
 */
export async function softDeleteContact(id: string) {
  const { ctx } = await requireDbUser();
  const affected = await db
    .update(contacts)
    .set({ deletedAt: new Date() })
    .where(and(eq(contacts.id, id), eq(contacts.orgId, ctx.orgId)))
    .returning({ id: contacts.id });
  if (affected.length === 0) return;
  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.soft_deleted",
    entity: "contact",
    entityId: id,
  });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
}

/**
 * Reverse of `softDeleteContact`. Clears `deleted_at` so the row reappears in
 * the list / detail views that filter on `deleted_at IS NULL`.
 */
export async function restoreContact(id: string) {
  const { ctx } = await requireDbUser();
  const affected = await db
    .update(contacts)
    .set({ deletedAt: null })
    .where(and(eq(contacts.id, id), eq(contacts.orgId, ctx.orgId)))
    .returning({ id: contacts.id });
  if (affected.length === 0) return;
  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.restored",
    entity: "contact",
    entityId: id,
  });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
}

async function clearPrimaryEmails(contactId: string, orgId: string): Promise<void> {
  await db
    .update(contactEmails)
    .set({ isPrimary: false })
    .where(
      and(eq(contactEmails.contactId, contactId), eq(contactEmails.isPrimary, true)),
    );
  await db
    .update(contacts)
    .set({ email: null })
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId)));
}

async function clearPrimaryPhones(contactId: string, orgId: string): Promise<void> {
  await db
    .update(contactPhones)
    .set({ isPrimary: false })
    .where(
      and(eq(contactPhones.contactId, contactId), eq(contactPhones.isPrimary, true)),
    );
  await db
    .update(contacts)
    .set({ phone: null })
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId)));
}

async function syncContactPrimaryFromEmails(
  contactId: string,
  orgId: string,
): Promise<void> {
  const rows = await db
    .select({ email: contactEmails.email })
    .from(contactEmails)
    .where(
      and(eq(contactEmails.contactId, contactId), eq(contactEmails.isPrimary, true)),
    )
    .limit(1);
  await db
    .update(contacts)
    .set({ email: rows[0]?.email ?? null })
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId)));
}

async function syncContactPrimaryFromPhones(
  contactId: string,
  orgId: string,
): Promise<void> {
  const rows = await db
    .select({ phone: contactPhones.phoneE164 })
    .from(contactPhones)
    .where(
      and(eq(contactPhones.contactId, contactId), eq(contactPhones.isPrimary, true)),
    )
    .limit(1);
  await db
    .update(contacts)
    .set({ phone: rows[0]?.phone ?? null })
    .where(and(eq(contacts.id, contactId), eq(contacts.orgId, orgId)));
}

export async function addContactEmail(input: {
  contactId: string;
  email: string;
  type?: "work" | "home" | "other";
  isPrimary?: boolean;
}): Promise<ContactEmail> {
  const { ctx } = await requireDbUser();
  const parsed = emailAddSchema.parse(input);

  const owned = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, parsed.contactId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  if (owned.length === 0) throw new Error("Contact not found");

  const inserted = await db
    .insert(contactEmails)
    .values({
      contactId: parsed.contactId,
      email: parsed.email,
      type: parsed.type,
      isPrimary: parsed.isPrimary,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Failed to insert contact email");

  if (parsed.isPrimary) {
    await clearPrimaryEmails(parsed.contactId, ctx.orgId);
    await db
      .update(contactEmails)
      .set({ isPrimary: true })
      .where(eq(contactEmails.id, row.id));
    await db
      .update(contacts)
      .set({ email: parsed.email })
      .where(and(eq(contacts.id, parsed.contactId), eq(contacts.orgId, ctx.orgId)));
  }

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.email.added",
    entity: "contact_email",
    entityId: row.id,
    meta: { contactId: parsed.contactId, isPrimary: parsed.isPrimary },
  });

  revalidatePath(`/contacts/${parsed.contactId}`);
  return row;
}

export async function removeContactEmail(input: { emailId: string }): Promise<void> {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select({
      id: contactEmails.id,
      contactId: contactEmails.contactId,
      wasPrimary: contactEmails.isPrimary,
    })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(and(eq(contactEmails.id, input.emailId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  const target = rows[0];
  if (!target) return;

  const affected = await db
    .delete(contactEmails)
    .where(eq(contactEmails.id, input.emailId))
    .returning({ id: contactEmails.id });
  if (affected.length === 0) return;

  if (target.wasPrimary) {
    await syncContactPrimaryFromEmails(target.contactId, ctx.orgId);
  }

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.email.removed",
    entity: "contact_email",
    entityId: input.emailId,
    meta: { contactId: target.contactId },
  });

  revalidatePath(`/contacts/${target.contactId}`);
}

export async function setPrimaryContactEmail(input: {
  emailId: string;
}): Promise<void> {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select({
      id: contactEmails.id,
      contactId: contactEmails.contactId,
      email: contactEmails.email,
    })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(and(eq(contactEmails.id, input.emailId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  const target = rows[0];
  if (!target) return;

  await clearPrimaryEmails(target.contactId, ctx.orgId);
  const updated = await db
    .update(contactEmails)
    .set({ isPrimary: true })
    .where(eq(contactEmails.id, target.id))
    .returning({ id: contactEmails.id });
  if (updated.length === 0) return;

  await db
    .update(contacts)
    .set({ email: target.email })
    .where(and(eq(contacts.id, target.contactId), eq(contacts.orgId, ctx.orgId)));

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.email.primary_set",
    entity: "contact_email",
    entityId: target.id,
    meta: { contactId: target.contactId },
  });

  revalidatePath(`/contacts/${target.contactId}`);
}

export async function addContactPhone(input: {
  contactId: string;
  phone: string;
  type?: "work" | "home" | "other";
  isPrimary?: boolean;
}): Promise<ContactPhone> {
  const { ctx } = await requireDbUser();
  const parsed = phoneAddSchema.parse(input);
  const phoneE164 = toE164(parsed.phone);
  if (!phoneE164) throw new Error("Invalid phone number");

  const owned = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, parsed.contactId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  if (owned.length === 0) throw new Error("Contact not found");

  const inserted = await db
    .insert(contactPhones)
    .values({
      contactId: parsed.contactId,
      phoneE164,
      type: parsed.type,
      isPrimary: parsed.isPrimary,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("Failed to insert contact phone");

  if (parsed.isPrimary) {
    await clearPrimaryPhones(parsed.contactId, ctx.orgId);
    await db
      .update(contactPhones)
      .set({ isPrimary: true })
      .where(eq(contactPhones.id, row.id));
    await db
      .update(contacts)
      .set({ phone: phoneE164 })
      .where(and(eq(contacts.id, parsed.contactId), eq(contacts.orgId, ctx.orgId)));
  }

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.phone.added",
    entity: "contact_phone",
    entityId: row.id,
    meta: { contactId: parsed.contactId, isPrimary: parsed.isPrimary },
  });

  revalidatePath(`/contacts/${parsed.contactId}`);
  return row;
}

export async function removeContactPhone(input: { phoneId: string }): Promise<void> {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select({
      id: contactPhones.id,
      contactId: contactPhones.contactId,
      wasPrimary: contactPhones.isPrimary,
    })
    .from(contactPhones)
    .innerJoin(contacts, eq(contacts.id, contactPhones.contactId))
    .where(and(eq(contactPhones.id, input.phoneId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  const target = rows[0];
  if (!target) return;

  const affected = await db
    .delete(contactPhones)
    .where(eq(contactPhones.id, input.phoneId))
    .returning({ id: contactPhones.id });
  if (affected.length === 0) return;

  if (target.wasPrimary) {
    await syncContactPrimaryFromPhones(target.contactId, ctx.orgId);
  }

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.phone.removed",
    entity: "contact_phone",
    entityId: input.phoneId,
    meta: { contactId: target.contactId },
  });

  revalidatePath(`/contacts/${target.contactId}`);
}

export async function setPrimaryContactPhone(input: {
  phoneId: string;
}): Promise<void> {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select({
      id: contactPhones.id,
      contactId: contactPhones.contactId,
      phone: contactPhones.phoneE164,
    })
    .from(contactPhones)
    .innerJoin(contacts, eq(contacts.id, contactPhones.contactId))
    .where(and(eq(contactPhones.id, input.phoneId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  const target = rows[0];
  if (!target) return;

  await clearPrimaryPhones(target.contactId, ctx.orgId);
  const updated = await db
    .update(contactPhones)
    .set({ isPrimary: true })
    .where(eq(contactPhones.id, target.id))
    .returning({ id: contactPhones.id });
  if (updated.length === 0) return;

  await db
    .update(contacts)
    .set({ phone: target.phone })
    .where(and(eq(contacts.id, target.contactId), eq(contacts.orgId, ctx.orgId)));

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.phone.primary_set",
    entity: "contact_phone",
    entityId: target.id,
    meta: { contactId: target.contactId },
  });

  revalidatePath(`/contacts/${target.contactId}`);
}

export async function setContactEmailsAndPhones(input: {
  contactId: string;
  emails: Array<{
    email: string;
    type?: "work" | "home" | "other";
    isPrimary?: boolean;
  }>;
  phones: Array<{
    phone: string;
    type?: "work" | "home" | "other";
    isPrimary?: boolean;
  }>;
}): Promise<void> {
  const { ctx } = await requireDbUser();
  const emailsParsed = z.array(emailInputSchema).parse(input.emails);
  const phonesParsed = z.array(phoneInputSchema).parse(input.phones);

  const phonesNormalized = phonesParsed.map((p) => {
    const e164 = toE164(p.phone);
    if (!e164) throw new Error(`Invalid phone number: ${p.phone}`);
    return { ...p, phone: e164 };
  });

  const owned = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), eq(contacts.orgId, ctx.orgId)))
    .limit(1);
  if (owned.length === 0) throw new Error("Contact not found");

  const primaryEmail =
    emailsParsed.find((e) => e.isPrimary)?.email ??
    emailsParsed[0]?.email ??
    null;
  const primaryPhone =
    phonesNormalized.find((p) => p.isPrimary)?.phone ??
    phonesNormalized[0]?.phone ??
    null;

  await db.transaction(async (tx) => {
    await tx
      .delete(contactEmails)
      .where(eq(contactEmails.contactId, input.contactId));
    await tx
      .delete(contactPhones)
      .where(eq(contactPhones.contactId, input.contactId));

    if (emailsParsed.length > 0) {
      await tx.insert(contactEmails).values(
        emailsParsed.map((e) => ({
          contactId: input.contactId,
          email: e.email,
          type: e.type,
          isPrimary: e.isPrimary,
        })),
      );
    }
    if (phonesNormalized.length > 0) {
      await tx.insert(contactPhones).values(
        phonesNormalized.map((p) => ({
          contactId: input.contactId,
          phoneE164: p.phone,
          type: p.type,
          isPrimary: p.isPrimary,
        })),
      );
    }

    await tx
      .update(contacts)
      .set({ email: primaryEmail, phone: primaryPhone, updatedAt: new Date() })
      .where(
        and(eq(contacts.id, input.contactId), eq(contacts.orgId, ctx.orgId)),
      );
  });

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.channels.replaced",
    entity: "contact",
    entityId: input.contactId,
    meta: { nbEmails: emailsParsed.length, nbPhones: phonesParsed.length },
  });

  revalidatePath(`/contacts/${input.contactId}`);
}
