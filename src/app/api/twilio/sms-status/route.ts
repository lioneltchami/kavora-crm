import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { smsMessages, type SmsMessage } from "@/db/schema";
import { verifyTwilioWebhook } from "@/lib/twilio/signature";
import { readTwilioParams } from "@/lib/twilio/webhook-params";

export const runtime = "nodejs";

/**
 * POST /api/twilio/sms-status — outbound SMS delivery lifecycle.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!verifyTwilioWebhook(req, params)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = params;
  if (!MessageSid) return new NextResponse("Missing MessageSid", { status: 400 });

  const statusMap: Record<string, SmsMessage["status"]> = {
    queued: "queued",
    sending: "sending",
    sent: "sent",
    failed: "failed",
    delivered: "delivered",
    read: "read",
    undelivered: "failed",
  };
  const newStatus: SmsMessage["status"] = statusMap[MessageStatus ?? ""] ?? "queued";

  const patch: Partial<typeof smsMessages.$inferInsert> = { status: newStatus };
  if (newStatus === "sent" || newStatus === "delivered" || newStatus === "read") {
    patch.sentAt = new Date();
  }
  if (newStatus === "delivered") patch.deliveredAt = new Date();
  if (newStatus === "read") patch.readAt = new Date();
  if (newStatus === "failed" && ErrorCode) {
    patch.errorCode = Number(ErrorCode);
    patch.errorMessage = ErrorMessage ?? null;
  }

  await adminDb.update(smsMessages).set(patch).where(eq(smsMessages.twilioMessageSid, MessageSid));

  return NextResponse.json({ ok: true });
}
