import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { calls } from "@/db/schema";
import { verifyTwilioWebhook } from "@/lib/twilio/signature";
import { downloadRecordingToStorage } from "@/lib/twilio/storage";
import { enqueueCallTranscription } from "@/lib/queue/enqueue";
import { readTwilioParams } from "@/lib/twilio/webhook-params";

export const runtime = "nodejs";

/**
 * POST /api/twilio/recording — Twilio posts here when a recording is ready.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!verifyTwilioWebhook(req, params)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const { CallSid, RecordingUrl, RecordingSid, RecordingStatus } = params;
  if (!CallSid || !RecordingUrl || RecordingStatus !== "completed") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const path = await downloadRecordingToStorage({
      callSid: CallSid,
      recordingUrl: RecordingUrl,
      recordingSid: RecordingSid ?? `unknown-${Date.now()}`,
    });

    await adminDb
      .update(calls)
      .set({ recordingUrl: RecordingUrl, recordingPath: path })
      .where(eq(calls.twilioCallSid, CallSid));

    await enqueueCallTranscription({ callSid: CallSid, recordingPath: path });
  } catch (err) {
    console.error("[recording] failed to download/store", err);
    await adminDb
      .update(calls)
      .set({ transcriptStatus: "failed" })
      .where(eq(calls.twilioCallSid, CallSid));
  }

  return NextResponse.json({ ok: true });
}
