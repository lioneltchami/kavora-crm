import "server-only";
import { twiml } from "twilio";
import { buildWebhookUrl } from "./client";

/**
 * TwiML builders for the working number.
 *
 * - `voiceInbound`: ring the team's forwarding numbers in parallel; if no
 *   answer, take a voicemail.
 * - `voiceDial`: connect an outbound call to the user with a "press 1" gate so
 *   the user's cell doesn't ring and immediately dial out a customer.
 * - `voiceVoicemailDone`: thank the caller after recording.
 * - `smsInbound`: minimal auto-acknowledge (we keep the human in the loop in the UI).
 *
 * IMPORTANT: All `action` and `statusCallback` URLs must be absolute —
 * Twilio does not resolve relative paths in TwiML attributes.
 */

export type VoiceRoutingTarget = {
  /** E.164 number to dial. */
  number: string;
  /** Optional human label, e.g. "Lionel". */
  label?: string;
};

const CONSENT_MESSAGE = "This call may be recorded for quality and training.";

export function voiceInbound(opts: {
  routingTargets: VoiceRoutingTarget[];
  recordingStatusCallbackUrl: string;
}): string {
  const { VoiceResponse } = twiml;
  const response = new VoiceResponse();

  // 1. Play consent announcement before anything else.
  response.say({ voice: "alice" }, CONSENT_MESSAGE);

  // 2. If we have forwarding numbers, dial them in parallel.
  if (opts.routingTargets.length > 0) {
    const dial = response.dial({
      answerOnBridge: true,
      action: buildWebhookUrl("/api/twilio/voicemail"),
      record: "record-from-answer",
      recordingStatusCallback: opts.recordingStatusCallbackUrl,
      recordingStatusCallbackMethod: "POST",
      timeout: 20,
    });
    for (const t of opts.routingTargets) {
      dial.number(
        { statusCallback: buildWebhookUrl("/api/twilio/status") },
        t.number,
      );
    }
    return response.toString();
  }

  // 3. No routing targets — go straight to voicemail.
  response.say(
    { voice: "alice" },
    "Please leave a message after the tone. We'll get back to you shortly.",
  );
  response.record({
    maxLength: 120,
    action: buildWebhookUrl("/api/twilio/voicemail"),
    recordingStatusCallback: opts.recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    transcribe: false,
  });

  return response.toString();
}

/**
 * TwiML for outbound calls: prompt the agent to "press 1" before connecting
 * to the customer, so the agent's cell doesn't ring and immediately dial a
 * customer (avoids awkward auto-answer).
 */
export function voiceOutboundDialGate(opts: {
  customerNumber: string;
  recordingStatusCallbackUrl: string;
}): string {
  const { VoiceResponse } = twiml;
  const response = new VoiceResponse();
  response.say({ voice: "alice" }, CONSENT_MESSAGE);
  const gather = response.gather({
    numDigits: 1,
    action: `${buildWebhookUrl("/api/twilio/dial-gate")}?customer=${encodeURIComponent(opts.customerNumber)}`,
    method: "POST",
    timeout: 8,
  });
  gather.say({ voice: "alice" }, "Press 1 to connect this call.");
  response.say({ voice: "alice" }, "We didn't receive a confirmation. Goodbye.");
  response.hangup();
  return response.toString();
}

/**
 * TwiML for when the user has pressed 1 — actually dial the customer.
 */
export function voiceConnectToCustomer(opts: {
  customerNumber: string;
  callerId: string;
  recordingStatusCallbackUrl: string;
}): string {
  const { VoiceResponse } = twiml;
  const response = new VoiceResponse();
  response.say({ voice: "alice" }, "Connecting now.");
  const dial = response.dial({
    callerId: opts.callerId,
    record: "record-from-answer",
    recordingStatusCallback: opts.recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    answerOnBridge: true,
  });
  dial.number(
    {
      statusCallback: buildWebhookUrl("/api/twilio/status"),
      statusCallbackEvent: ["completed"],
    },
    opts.customerNumber,
  );
  return response.toString();
}

export function voiceVoicemailThanks(): string {
  const { VoiceResponse } = twiml;
  const response = new VoiceResponse();
  response.say({ voice: "alice" }, "Thanks. We've received your message and will be in touch soon.");
  response.hangup();
  return response.toString();
}

export function smsInboundAck(): string {
  const { MessagingResponse } = twiml;
  const response = new MessagingResponse();
  response.message(
    "Thanks for your message — a team member will reply shortly. For urgent requests, please call this number.",
  );
  return response.toString();
}

export function smsNoReply(): string {
  const { MessagingResponse } = twiml;
  const response = new MessagingResponse();
  return response.toString();
}
