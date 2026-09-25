import "server-only";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { smsMessages, calls, activities, aiSummaries } from "@/db/schema";
import { transcribeCall } from "@/lib/ai/transcribe";
import { summarizeSms, summarizeCallTranscript } from "@/lib/ai/summarize";
import { embedActivity } from "@/lib/ai/embed";
import { env } from "@/lib/env";

/**
 * Background job dispatcher.
 *
 * In production we use Trigger.dev v3 (`@trigger.dev/sdk`) for durable,
 * retried execution. In dev (or when `TRIGGER_SECRET_KEY` is missing), we
 * fall back to fire-and-forget in-process execution — useful for local
 * testing without setting up a Trigger.dev project.
 *
 * The dispatcher uses stable task IDs that match `src/trigger/inbound-sms.ts`.
 *
 * Every job is written defensively: if a provider is not configured, the
 * job is a no-op (and we mark the record accordingly so the UI can show
 * "AI not configured").
 */

type RegisteredTaskId = "inbound-sms-handler" | "transcribe-call";

type JobFn = () => Promise<void>;

async function dispatch(
  taskId: RegisteredTaskId,
  payload: Record<string, unknown>,
  fn: JobFn,
): Promise<void> {
  const hasTrigger = Boolean(env.TRIGGER_SECRET_KEY && env.TRIGGER_PROJECT_ID);
  if (hasTrigger) {
    const { tasks } = await import("@trigger.dev/sdk");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tasks.trigger as any)(taskId, payload);
      return;
    } catch (err) {
      console.error(`[queue] trigger.dev dispatch failed for ${taskId}`, err);
      fn().catch((inlineErr) => console.error(`[queue] inline fallback also failed`, inlineErr));
      return;
    }
  }
  // Inline fallback (dev or no trigger config). Errors are logged but never
  // thrown — webhook responses must stay fast and Twilio retries on 5xx.
  fn().catch((err) => console.error(`[queue] inline job ${taskId} failed`, err));
}

export async function enqueueInboundSms({ messageSid }: { messageSid: string }): Promise<void> {
  return dispatch(
    "inbound-sms-handler",
    { messageSid },
    async () => {
      const row = await adminDb
        .select()
        .from(smsMessages)
        .where(eq(smsMessages.twilioMessageSid, messageSid))
        .limit(1);
      const sms = row[0];
      if (!sms) return;

      const summary = await summarizeSms({
        body: sms.body,
        contactPhone: sms.fromNumber,
        direction: sms.direction,
      });
      if (!summary) return;

      await embedActivity({
        sourceType: "sms",
        sourceId: sms.id,
        content: `${sms.body}\n\nSummary: ${summary.summary}\nNext actions: ${summary.nextActions.join("; ")}`,
        orgId: sms.orgId,
      });
    },
  );
}

export async function enqueueCallTranscription(opts: {
  callSid: string;
  recordingPath: string;
}): Promise<void> {
  return dispatch(
    "transcribe-call",
    { callSid: opts.callSid, recordingPath: opts.recordingPath },
    async () => {
      const result = await transcribeCall({
        callSid: opts.callSid,
        recordingPath: opts.recordingPath,
      });
      if (!result) return;

      // Persist transcript + flag as completed.
      await adminDb
        .update(calls)
        .set({ transcript: result.transcript, transcriptStatus: "completed" })
        .where(eq(calls.twilioCallSid, opts.callSid));

      const callRow = await adminDb
        .select({ id: calls.id, contactId: calls.contactId, orgId: calls.orgId })
        .from(calls)
        .where(eq(calls.twilioCallSid, opts.callSid))
        .limit(1);
      const call = callRow[0];
      if (!call) return;

      // Generate structured summary (Haiku) and persist it linked to a call activity row.
      const summary = await summarizeCallTranscript({ transcript: result.transcript });
      const existingActivity = await adminDb
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.refId, call.id))
        .limit(1);
      let activityId = existingActivity[0]?.id;
      if (!activityId) {
        const inserted = await adminDb
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
        await adminDb.insert(aiSummaries).values({
          orgId: call.orgId,
          activityId,
          summary: summary.summary,
          nextActions: summary.nextActions,
          sentiment: summary.sentiment,
          topics: summary.topics,
          model: env.ANTHROPIC_MODEL_HAIKU,
        });
      }

      // Embed the transcript + summary so RAG picks them up.
      await embedActivity({
        sourceType: "call",
        sourceId: call.id,
        content:
          summary != null
            ? `${result.transcript}\n\nSummary: ${summary.summary}\nNext actions: ${summary.nextActions.join("; ")}`
            : result.transcript,
        orgId: call.orgId,
      });
    },
  );
}

/** Internal-only embed helper. No Trigger.dev task — runs inline. */
export async function enqueueEmbedActivity(opts: {
  sourceType: "call" | "sms" | "note" | "summary";
  sourceId: string;
  content: string;
  orgId: string;
}): Promise<void> {
  // Embedding runs inline today; if it becomes slow, register a Trigger.dev task.
  embedActivity(opts).catch((err) => console.error("[queue] inline embed failed", err));
}
