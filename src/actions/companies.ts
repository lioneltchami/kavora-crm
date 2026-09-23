"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const companySchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(200).optional().nullable(),
  industry: z.string().max(120).optional().nullable(),
  size: z.string().max(64).optional().nullable(),
});

export async function listCompanies(opts: { q?: string; limit?: number } = {}) {
  const { ctx } = await requireDbUser();
  const limit = opts.limit ?? 100;
  const whereParts = [eq(companies.orgId, ctx.orgId)];
  if (opts.q && opts.q.trim()) {
    const q = `%${opts.q.trim()}%`;
    whereParts.push(or(ilike(companies.name, q), ilike(companies.domain, q))!);
  }
  return db
    .select()
    .from(companies)
    .where(and(...whereParts))
    .orderBy(desc(companies.updatedAt))
    .limit(limit);
}

export async function getCompany(id: string) {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), eq(companies.orgId, ctx.orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCompany(formData: FormData) {
  const { ctx } = await requireDbUser();
  const parsed = companySchema.parse({
    name: formData.get("name"),
    domain: formData.get("domain") || null,
    industry: formData.get("industry") || null,
    size: formData.get("size") || null,
  });

  const inserted = await db
    .insert(companies)
    .values({
      orgId: ctx.orgId,
      name: parsed.name,
      domain: parsed.domain ?? null,
      industry: parsed.industry ?? null,
      size: parsed.size ?? null,
    })
    .returning();
  const created = inserted[0];
  if (!created) throw new Error("Failed to create company");

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "company.created",
    entity: "company",
    entityId: created.id,
  });

  revalidatePath("/companies");
  return created;
}

export async function updateCompany(id: string, formData: FormData) {
  const { ctx } = await requireDbUser();
  const parsed = companySchema.partial().parse({
    name: formData.get("name") || undefined,
    domain: formData.get("domain") || undefined,
    industry: formData.get("industry") || undefined,
    size: formData.get("size") || undefined,
  });

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.name !== undefined) update.name = parsed.name;
  if (parsed.domain !== undefined) update.domain = parsed.domain ?? null;
  if (parsed.industry !== undefined) update.industry = parsed.industry ?? null;
  if (parsed.size !== undefined) update.size = parsed.size ?? null;

  await db
    .update(companies)
    .set(update)
    .where(and(eq(companies.id, id), eq(companies.orgId, ctx.orgId)));

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "company.updated",
    entity: "company",
    entityId: id,
    meta: { fields: Object.keys(update) },
  });

  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
}
