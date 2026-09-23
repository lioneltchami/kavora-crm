import { NextResponse } from "next/server";
import { buildWebhookUrl } from "@/lib/twilio/client";
import { verifyTwilioWebhook } from "@/lib/twilio/signature";
import { voiceConnectToCustomer } from "@/lib/twilio/twiml";
import { readTwilioParams } from "@/lib/twilio/webhook-params";

export const runtime = "nodejs";

/**
 * POST /api/twilio/dial-gate — Twilio calls this after the agent presses 1.
 * Connects the call to the customer and starts recording.
 *
 * The `customer` parameter is part of the URL query string (Twilio `<Gather>`
 * preserves query params on its action URL). The `Digits` parameter arrives
 * in the POST body.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);

  // Customer is in the query string (set by voiceOutboundDialGate), not the body.
  const customerFromQuery = new URL(req.url).searchParams.get("customer") ?? undefined;

  if (!verifyTwilioWebhook(req, params)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const { Digits, From } = params;
  if (Digits !== "1" || !customerFromQuery) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Call cancelled.</Say><Hangup/></Response>`,
      { headers: { "Content-Type": "text/xml; charset=utf-8" } },
    );
  }

  const twiml = voiceConnectToCustomer({
    customerNumber: customerFromQuery,
    callerId: From ?? "",
    recordingStatusCallbackUrl: buildWebhookUrl("/api/twilio/recording"),
  });
  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
