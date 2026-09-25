"use server";

import { revalidatePath } from "next/cache";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contacts } from "@/db/schema";
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

const mergeValidateInputSchema = z
  .object({
    winnerId: z.string().uuid(),
    loserId: z.string().uuid(),
  })
  .refine((v) => v.winnerId !== v.loserId, {
    message: "Winner and loser must be different contacts",
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
  copied_emails?: number;
  copied_phones?: number;
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
 * Returns the merge result so the caller (typically the dialog) can decide
 * how to navigate + surface feedback to the user. Does NOT redirect; that
 * decision is the caller's responsibility.
 */
export async function mergeContact(input: {
  winnerId: string;
  loserId: string;
}): Promise<MergeContactResult> {
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
    copiedEmails: raw.copied_emails ?? 0,
    copiedPhones: raw.copied_phones ?? 0,
  };

  if (raw.copied_emails === undefined || raw.copied_phones === undefined) {
    console.warn(
      `[mergeContact] prod DB returned merge_contacts jsonb without copied_emails/copied_phones — ` +
        `the migration runner may not have applied the SQL update yet. Audit counts will under-report until SQL catches up.`,
    );
  }

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
  return result;
}

// ─── Pre-merge validation (UI confirm-step helper) ─────────────────────────────

export interface MergeCandidateSummary {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  isDeleted: boolean;
  emailCount: number;
  phoneCount: number;
}

export interface ValidateMergeResult {
  valid: boolean;
  error?: string;
  winner?: MergeCandidateSummary;
  loser?: MergeCandidateSummary;
  /** Loser emails that would actually be copied (case-insensitive dedup vs winner). */
  predictedCopiedEmails?: number;
  /** Loser phones that would actually be copied (exact E.164 match vs winner). */
  predictedCopiedPhones?: number;
}

type ChannelCountRow = {
  winner_email_count: number;
  loser_email_count: number;
  winner_phone_count: number;
  loser_phone_count: number;
  predicted_copied_emails: number;
  predicted_copied_phones: number;
};

/**
 * Pre-merge validation: checks that winner + loser exist in the caller's org,
 * neither is soft-deleted, and reports what `merge_contacts()` would copy
 * (mirrors the dedup semantics in src/db/migrations/0002_merge_contacts.sql).
 * Called by the UI before showing the confirm step.
 */
export async function validateMergeCandidates(input: {
  winnerId: string;
  loserId: string;
}): Promise<ValidateMergeResult> {
  const parsed = mergeValidateInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { winnerId, loserId } = parsed.data;

  const { ctx } = await requireDbUser();

  // Single round-trip for both contacts, org-scoped via requireDbUser's ctx.
  const rows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      orgId: contacts.orgId,
      deletedAt: contacts.deletedAt,
    })
    .from(contacts)
    .where(inArray(contacts.id, [winnerId, loserId]));

  const winnerRow = rows.find((r) => r.id === winnerId);
  const loserRow = rows.find((r) => r.id === loserId);

  // Order matters: surface "not found" before "forbidden" so we don't leak
  // existence of rows in other orgs to a probing caller.
  if (!winnerRow || !loserRow) {
    return { valid: false, error: "Contact not found" };
  }
  if (winnerRow.orgId !== ctx.orgId || loserRow.orgId !== ctx.orgId) {
    return { valid: false, error: "Forbidden" };
  }
  if (winnerRow.deletedAt !== null || loserRow.deletedAt !== null) {
    return { valid: false, error: "Cannot merge a deleted contact" };
  }

  // Channel counts + predicted copies in one shot. Mirrors the
  // NOT EXISTS / lower() dedup used by merge_contacts() so the UI
  // preview matches the actual merge outcome.
  const counts = await db.execute<ChannelCountRow>(sql`
    WITH
      we AS (
        SELECT count(*)::int AS total,
               COALESCE(array_agg(lower("email")), ARRAY[]::text[]) AS emails
          FROM "contact_emails" WHERE "contact_id" = ${winnerId}::uuid
      ),
      le AS (
        SELECT count(*)::int AS total,
               COALESCE(array_agg(lower("email")), ARRAY[]::text[]) AS emails
          FROM "contact_emails" WHERE "contact_id" = ${loserId}::uuid
      ),
      wp AS (
        SELECT count(*)::int AS total,
               COALESCE(array_agg("phone_e164"), ARRAY[]::text[]) AS phones
          FROM "contact_phones" WHERE "contact_id" = ${winnerId}::uuid
      ),
      lp AS (
        SELECT count(*)::int AS total,
               COALESCE(array_agg("phone_e164"), ARRAY[]::text[]) AS phones
          FROM "contact_phones" WHERE "contact_id" = ${loserId}::uuid
      )
    SELECT
      we.total AS winner_email_count,
      le.total AS loser_email_count,
      wp.total AS winner_phone_count,
      lp.total AS loser_phone_count,
      (SELECT count(*)::int FROM unnest(le.emails) e WHERE NOT (e = ANY(we.emails))) AS predicted_copied_emails,
      (SELECT count(*)::int FROM unnest(lp.phones) p WHERE NOT (p = ANY(wp.phones))) AS predicted_copied_phones
    FROM we, le, wp, lp
  `);

  const c = counts.rows[0];
  if (!c) throw new Error("validateMergeCandidates: count query returned no row");

  const toSummary = (
    r: typeof winnerRow,
    emailCount: number,
    phoneCount: number,
  ): MergeCandidateSummary => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    isDeleted: r.deletedAt !== null,
    emailCount,
    phoneCount,
  });

  return {
    valid: true,
    winner: toSummary(winnerRow, c.winner_email_count, c.winner_phone_count),
    loser: toSummary(loserRow, c.loser_email_count, c.loser_phone_count),
    predictedCopiedEmails: c.predicted_copied_emails,
    predictedCopiedPhones: c.predicted_copied_phones,
  };
}