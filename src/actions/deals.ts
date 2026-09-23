"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  deals,
  pipelines,
  pipelineStages,
  activities,
  type Deal,
} from "@/db/schema";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const dealSchema = z.object({
  title: z.string().min(1).max(200),
  contactId: z.string().uuid().optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  valueCents: z.coerce.number().int().min(0).default(0),
  currency: z.string().length(3).default("USD"),
  expectedCloseDate: z.string().optional().nullable(),
});

export async function listDeals(opts: { pipelineId?: string; status?: "open" | "won" | "lost" } = {}) {
  const { ctx } = await requireDbUser();
  const whereParts = [eq(deals.orgId, ctx.orgId)];
  if (opts.pipelineId) whereParts.push(eq(deals.pipelineId, opts.pipelineId));
  if (opts.status) whereParts.push(eq(deals.status, opts.status));
  return db
    .select()
    .from(deals)
    .where(and(...whereParts))
    .orderBy(desc(deals.updatedAt));
}

export async function getDeal(id: string): Promise<Deal | null> {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getDefaultPipeline() {
  const { ctx } = await requireDbUser();
  const rows = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.orgId, ctx.orgId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getStagesForPipeline(pipelineId: string) {
  const { ctx } = await requireDbUser();
  return db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, pipelineId), eq(pipelineStages.orgId, ctx.orgId)))
    .orderBy(asc(pipelineStages.order));
}

export async function createDeal(formData: FormData) {
  const { ctx, dbRow } = await requireDbUser();
  const parsed = dealSchema.parse({
    title: formData.get("title"),
    contactId: formData.get("contactId") || null,
    companyId: formData.get("companyId") || null,
    pipelineId: formData.get("pipelineId"),
    stageId: formData.get("stageId"),
    valueCents: formData.get("valueCents") ?? 0,
    currency: formData.get("currency") ?? "USD",
    expectedCloseDate: formData.get("expectedCloseDate") || null,
  });

  const inserted = await db
    .insert(deals)
    .values({
      orgId: ctx.orgId,
      title: parsed.title,
      contactId: parsed.contactId ?? null,
      companyId: parsed.companyId ?? null,
      pipelineId: parsed.pipelineId,
      stageId: parsed.stageId,
      valueCents: parsed.valueCents,
      currency: parsed.currency,
      ownerUserId: dbRow.id,
      expectedCloseDate: parsed.expectedCloseDate ? new Date(parsed.expectedCloseDate) : null,
    })
    .returning();
  const created = inserted[0];
  if (!created) throw new Error("Failed to create deal");

  await db.insert(activities).values({
    orgId: ctx.orgId,
    type: "stage-change",
    contactId: parsed.contactId ?? null,
    dealId: created.id,
    summary: `Deal created: ${created.title}`,
  });

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "deal.created",
    entity: "deal",
    entityId: created.id,
  });

  revalidatePath("/deals");
  return created;
}

export async function moveDealStage(opts: { dealId: string; toStageId: string }) {
  const { ctx } = await requireDbUser();

  const current = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, opts.dealId), eq(deals.orgId, ctx.orgId)))
    .limit(1);
  if (!current[0]) throw new Error("Deal not found");

  const target = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.id, opts.toStageId), eq(pipelineStages.orgId, ctx.orgId)))
    .limit(1);
  if (!target[0]) throw new Error("Target stage not found");

  const newStatus = target[0].isWon ? "won" : target[0].isLost ? "lost" : "open";

  await db
    .update(deals)
    .set({
      stageId: opts.toStageId,
      status: newStatus,
      closedAt: newStatus !== "open" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(deals.id, opts.dealId));

  await db.insert(activities).values({
    orgId: ctx.orgId,
    type: "stage-change",
    contactId: current[0].contactId,
    dealId: opts.dealId,
    summary: `Moved to ${target[0].name}`,
  });

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "deal.stage_changed",
    entity: "deal",
    entityId: opts.dealId,
    meta: { from: current[0].stageId, to: opts.toStageId },
  });

  revalidatePath("/deals");
  revalidatePath(`/deals/${opts.dealId}`);
}

export async function updateDeal(id: string, formData: FormData) {
  const { ctx } = await requireDbUser();
  const parsed = dealSchema.partial().parse({
    title: formData.get("title") || undefined,
    contactId: formData.get("contactId") || undefined,
    companyId: formData.get("companyId") || undefined,
    pipelineId: formData.get("pipelineId") || undefined,
    stageId: formData.get("stageId") || undefined,
    valueCents: formData.get("valueCents") || undefined,
    currency: formData.get("currency") || undefined,
    expectedCloseDate: formData.get("expectedCloseDate") || undefined,
  });
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.title !== undefined) update.title = parsed.title;
  if (parsed.contactId !== undefined) update.contactId = parsed.contactId ?? null;
  if (parsed.companyId !== undefined) update.companyId = parsed.companyId ?? null;
  if (parsed.pipelineId !== undefined) update.pipelineId = parsed.pipelineId;
  if (parsed.stageId !== undefined) update.stageId = parsed.stageId;
  if (parsed.valueCents !== undefined) update.valueCents = parsed.valueCents;
  if (parsed.currency !== undefined) update.currency = parsed.currency;
  if (parsed.expectedCloseDate !== undefined)
    update.expectedCloseDate = parsed.expectedCloseDate ? new Date(parsed.expectedCloseDate) : null;

  await db.update(deals).set(update).where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId)));
  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "deal.updated",
    entity: "deal",
    entityId: id,
    meta: { fields: Object.keys(update) },
  });
  revalidatePath(`/deals/${id}`);
}
