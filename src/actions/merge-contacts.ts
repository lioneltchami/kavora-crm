"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { requireDbUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const mergeInputSchema = z
  .object({
    winnerId: z.string().uuid(),
    loserId: z.string().uuid(),
  })
  .refine((v) => v.winnerId !== v.loserId, {
    message: "winnerId and loserId must differ",
    path: ["loserId"],
  });

export interface MergeContactResult {
  winnerId: string;
  loserId: string;
  reassignedNotes: number;
  reassignedDeals: number;
  reassignedCalls: number;
  reassignedSms: number;
  reassignedActivities: number;
  reassignedAiDrafts: number;
  reassignedLeadScores: number;
  copiedTags: number;
  copiedEmails: number;
  copiedPhones: number;
}

type RawMergeSummary = {
  winner_id: string;
  loser_id: string;
  org_id: string;
  reassigned_notes: number;
  reassigned_deals: number;
  reassigned_calls: number;
  reassigned_sms: number;
  reassigned_activities: number;
  reassigned_ai_drafts: number;
  reassigned_lead_scores: number;
  copied_tags: number;
  copied_emails: number;
  copied_phones: number;
};

/**
 * Merge two contacts: pick a winner, reassign every FK from the loser to the
 * winner, fill NULL scalars on the winner from the loser, copy shared tags,
 * delete the loser, and audit-log the action.
 *
 * The destructive work happens server-side in the PL/pgSQL function
 * `merge_contacts(winner_id, loser_id, p_org_id)` defined in
 * src/db/migrations/0002_merge_contacts.sql.
 *
 * Always redirects to the winner's detail page on success.
 */
export async function mergeContact(input: {
  winnerId: string;
  loserId: string;
}): Promise<void> {
  const { ctx } = await requireDbUser();
  const { winnerId, loserId } = mergeInputSchema.parse(input);

  const rows = await db.execute<{ result: RawMergeSummary }>(sql`
    SELECT merge_contacts(
      ${winnerId}::uuid,
      ${loserId}::uuid,
      ${ctx.orgId}::varchar
    ) AS result
  `);
  const raw = rows.rows[0]?.result;
  if (!raw) throw new Error("merge_contacts returned no row");

  const result: MergeContactResult = {
    winnerId: raw.winner_id,
    loserId: raw.loser_id,
    reassignedNotes: raw.reassigned_notes,
    reassignedDeals: raw.reassigned_deals,
    reassignedCalls: raw.reassigned_calls,
    reassignedSms: raw.reassigned_sms,
    reassignedActivities: raw.reassigned_activities,
    reassignedAiDrafts: raw.reassigned_ai_drafts,
    reassignedLeadScores: raw.reassigned_lead_scores,
    copiedTags: raw.copied_tags,
    copiedEmails: raw.copied_emails,
    copiedPhones: raw.copied_phones,
  };

  await logAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action: "contact.merged",
    entity: "contact",
    entityId: loserId,
    meta: { ...result },
  });

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${winnerId}`);
  redirect(`/contacts/${winnerId}`);
}