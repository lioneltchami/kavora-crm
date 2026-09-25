/**
 * Trigger.dev v3 task definitions.
 *
 * In dev (or when TRIGGER_SECRET_KEY is unset) the dispatcher in
 * `src/lib/queue/enqueue.ts` runs jobs inline. In prod, deploy this project to
 * Trigger.dev Cloud and Trigger will pick up these task definitions and run them
 * via the durable worker.
 */

import { task, schedules } from "@trigger.dev/sdk";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  smsMessages,
  calls,
  contacts,
  activities,
  aiSummaries,
  leadScores,
} from "@/db/schema";
import { transcribeCall } from "@/lib/ai/transcribe";
import { summarizeSms, summarizeCallTranscript } from "@/lib/ai/summarize";
import { embedActivity } from "@/lib/ai/embed";
import { scoreContact } from "@/lib/ai/score-lead";

export const handleInboundSms = task({
  id: "inbound-sms-handler",
  run: async (payload: { messageSid: string }) => {
    const row = await db
      .select()
      .from(smsMessages)
      .where(eq(smsMessages.twilioMessageSid, payload.messageSid))
      .limit(1);
    const sms = row[0];
    if (!sms) return { skipped: "sms_not_found" };

    const summary = await summarizeSms({
      body: sms.body,
      contactPhone: sms.fromNumber,
      direction: sms.direction,
    });
    if (!summary) return { skipped: "ai_not_configured" };

    // Mirror the `transcribe-call` pattern: link the summary to a contact-scoped
    // `activities` row so the contact's timeline shows an AI summary tile,
    // and persist the structured summary into `ai_summaries` for analytics.
    // Skip the activities/ai_summaries path when the SMS has no contact yet
    // (the inbound webhook should always auto-create one, but the schema
    // allows nullable contactId for race conditions).
    if (sms.contactId) {
      const existingActivity = await db
        .select({ id: activities.id })
        .from(activities)
        .where(and(eq(activities.contactId, sms.contactId), eq(activities.refId, sms.id)))
        .limit(1);
      let activityId = existingActivity[0]?.id;
      if (activityId) {
        await db
          .update(activities)
          .set({ summary: summary.summary })
          .where(eq(activities.id, activityId));
      } else {
        const inserted = await db
          .insert(activities)
          .values({
            orgId: sms.orgId,
            type: "sms",
            contactId: sms.contactId,
            refId: sms.id,
            summary: summary.summary,
            occurredAt: sms.createdAt,
          })
          .returning();
        activityId = inserted[0]?.id;
      }
      if (activityId) {
        await db.insert(aiSummaries).values({
          orgId: sms.orgId,
          activityId,
          summary: summary.summary,
          nextActions: summary.nextActions,
          sentiment: summary.sentiment,
          topics: summary.topics,
          model: "claude-haiku-4-5",
        });
      }
    }

    await embedActivity({
      sourceType: "sms",
      sourceId: sms.id,
      content: `${sms.body}\n\nSummary: ${summary.summary}\nNext actions: ${summary.nextActions.join("; ")}`,
      orgId: sms.orgId,
    });

    return { ok: true };
  },
});

export const transcribeCallTask = task({
  id: "transcribe-call",
  run: async (payload: { callSid: string; recordingPath: string }) => {
    const result = await transcribeCall({
      callSid: payload.callSid,
      recordingPath: payload.recordingPath,
    });
    if (!result) return { skipped: "deepgram_not_configured" };

    await db
      .update(calls)
      .set({ transcript: result.transcript, transcriptStatus: "completed" })
      .where(eq(calls.twilioCallSid, payload.callSid));

    const callRow = await db
      .select({ id: calls.id, contactId: calls.contactId, orgId: calls.orgId })
      .from(calls)
      .where(eq(calls.twilioCallSid, payload.callSid))
      .limit(1);
    const call = callRow[0];
    if (!call) return { ok: true };

    const summary = await summarizeCallTranscript({ transcript: result.transcript });
    const existingActivity = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.refId, call.id))
      .limit(1);
    let activityId = existingActivity[0]?.id;
    if (!activityId) {
      const inserted = await db
        .insert(activities)
        .values({
          orgId: call.orgId,
          type: "call",
          contactId: call.contactId,
          refId: call.id,
          summary: "Call recorded and transcribed",
          occurredAt: new Date(),
        })
        .returning();
      activityId = inserted[0]?.id;
    }
    if (activityId && summary) {
      const { aiSummaries } = await import("@/db/schema");
      await db.insert(aiSummaries).values({
        orgId: call.orgId,
        activityId,
        summary: summary.summary,
        nextActions: summary.nextActions,
        sentiment: summary.sentiment,
        topics: summary.topics,
        model: "claude-haiku-4-5",
      });
    }

    await embedActivity({
      sourceType: "call",
      sourceId: call.id,
      content:
        summary != null
          ? `${result.transcript}\n\nSummary: ${summary.summary}\nNext actions: ${summary.nextActions.join("; ")}`
          : result.transcript,
      orgId: call.orgId,
    });

    return { ok: true };
  },
});

/**
 * Weekly lead-scoring cron. Iterates contacts with activity in the last 30
 * days (per the plan), with bounded concurrency so a slow Anthropic call
 * doesn't hold up a sweep.
 */
export const scoreAllLeadsSchedule = schedules.task({
  id: "score-all-leads",
  cron: "0 6 * * 0", // weekly Sunday 6am UTC
  run: async () => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const recentContactIds = await db
      .selectDistinct({ contactId: activities.contactId })
      .from(activities)
      .where(and(gte(activities.occurredAt, since)))
      .limit(200);

    // Chunk with bounded concurrency (3 in flight).
    let scored = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < recentContactIds.length; i += CONCURRENCY) {
      const batch = recentContactIds.slice(i, i + CONCURRENCY).filter((r) => r.contactId !== null);
      const results = await Promise.allSettled(
        (batch as Array<{ contactId: string }>).map((r) => scoreContact(r.contactId)),
      );
      for (const r of results) if (r.status === "fulfilled" && r.value) scored++;
    }
    return { scored, considered: recentContactIds.length };
  },
});
