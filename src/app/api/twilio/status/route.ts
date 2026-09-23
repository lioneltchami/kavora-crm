import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { calls, type Call } from "@/db/schema";
import { verifyTwilioWebhook } from "@/lib/twilio/signature";
import { readTwilioParams } from "@/lib/twilio/webhook-params";

export const runtime = "nodejs";

/**
 * POST /api/twilio/status — call status transitions.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!verifyTwilioWebhook(req, params)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const { CallSid, CallStatus, Duration, StartTime, EndTime } = params;
  if (!CallSid) return new NextResponse("Missing CallSid", { status: 400 });

  const statusMap: Record<string, Call["status"]> = {
    queued: "queued",
    ringing: "ringing",
    "in-progress": "in-progress",
    completed: "completed",
    busy: "busy",
    failed: "failed",
    "no-answer": "no-answer",
    canceled: "failed",
  };
  const newStatus: Call["status"] = statusMap[CallStatus ?? ""] ?? "queued";

  await db
    .update(calls)
    .set({
      status: newStatus,
      startedAt: StartTime ? new Date(StartTime) : undefined,
      endedAt: EndTime ? new Date(EndTime) : undefined,
      durationSeconds: Duration ? Number(Duration) : undefined,
    })
    .where(eq(calls.twilioCallSid, CallSid));

  return NextResponse.json({ ok: true });
}
