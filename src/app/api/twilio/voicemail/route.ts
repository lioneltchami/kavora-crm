import { NextResponse } from "next/server";
import { verifyTwilioWebhook } from "@/lib/twilio/signature";
import { voiceVoicemailThanks } from "@/lib/twilio/twiml";
import { readTwilioParams } from "@/lib/twilio/webhook-params";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!verifyTwilioWebhook(req, params)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  return new NextResponse(voiceVoicemailThanks(), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
