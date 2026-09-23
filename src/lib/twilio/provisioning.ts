import "server-only";
import { getTwilioClient, buildWebhookUrl } from "./client";

/**
 * Search available phone numbers. Returns up to 30 candidates with capabilities.
 */
export async function searchAvailableNumbers(opts: {
  country?: string;
  areaCode?: string;
  type?: "local" | "tollfree";
}): Promise<
  Array<{
    sid: string;
    phoneNumber: string;
    friendlyName: string;
    locality: string | null;
    region: string | null;
    capabilities: { voice: boolean; sms: boolean; mms: boolean };
  }>
> {
  const client = getTwilioClient();
  const type = opts.type ?? "local";
  const country = opts.country ?? "US";
  // The Twilio SDK's `availablePhoneNumbers(country).local` / `.tollFree` typing
  // is over-narrowed across versions; cast through `unknown` to the list shape.
  const phoneNumbersApi = client.availablePhoneNumbers(country) as unknown as {
    local: {
      list: (params: {
        areaCode?: number;
        limit?: number;
        voiceEnabled?: boolean;
        smsEnabled?: boolean;
        mmsEnabled?: boolean;
      }) => Promise<
        Array<{
          sid: string;
          phoneNumber: string;
          friendlyName: string;
          locality?: string | null;
          region?: string | null;
          capabilities: { voice?: boolean; sms?: boolean; mms?: boolean };
        }>
      >;
    };
    tollFree: {
      list: (params: {
        areaCode?: number;
        limit?: number;
        voiceEnabled?: boolean;
        smsEnabled?: boolean;
        mmsEnabled?: boolean;
      }) => Promise<
        Array<{
          sid: string;
          phoneNumber: string;
          friendlyName: string;
          locality?: string | null;
          region?: string | null;
          capabilities: { voice?: boolean; sms?: boolean; mms?: boolean };
        }>
      >;
    };
  };
  const list = type === "tollfree" ? phoneNumbersApi.tollFree : phoneNumbersApi.local;
  const result = await list.list({
    areaCode: opts.areaCode ? Number(opts.areaCode) : undefined,
    limit: 30,
    voiceEnabled: true,
    smsEnabled: true,
    mmsEnabled: true,
  });
  return result.map((n) => ({
    sid: n.sid,
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    locality: n.locality ?? null,
    region: n.region ?? null,
    capabilities: {
      voice: Boolean(n.capabilities.voice),
      sms: Boolean(n.capabilities.sms),
      mms: Boolean(n.capabilities.mms),
    },
  }));
}

/**
 * Provision a specific phone number and wire it to our webhooks.
 */
export async function purchaseNumber(opts: {
  phoneNumber: string;
  friendlyName?: string;
  voiceUrl?: string;
  smsUrl?: string;
  statusCallback?: string;
}) {
  const client = getTwilioClient();
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: opts.phoneNumber,
    friendlyName: opts.friendlyName ?? `Kavora CRM — ${opts.phoneNumber}`,
    voiceUrl: opts.voiceUrl ?? buildWebhookUrl("/api/twilio/voice"),
    voiceMethod: "POST",
    smsUrl: opts.smsUrl ?? buildWebhookUrl("/api/twilio/sms"),
    smsMethod: "POST",
    statusCallback: opts.statusCallback ?? buildWebhookUrl("/api/twilio/status"),
    statusCallbackMethod: "POST",
    voiceCallerIdLookup: true,
  });
  return {
    sid: purchased.sid,
    phoneNumber: purchased.phoneNumber,
    friendlyName: purchased.friendlyName,
    capabilities: {
      voice: Boolean(purchased.capabilities.voice),
      sms: Boolean(purchased.capabilities.sms),
      mms: Boolean(purchased.capabilities.mms),
    },
    voiceUrl: purchased.voiceUrl,
    smsUrl: purchased.smsUrl,
  };
}

/**
 * Release (cancel) a Twilio phone number.
 */
export async function releaseNumber(twilioSid: string): Promise<void> {
  const client = getTwilioClient();
  await client.incomingPhoneNumbers(twilioSid).remove();
}

/**
 * Send an SMS from one of our provisioned numbers.
 */
export async function sendSms(opts: {
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
}) {
  const client = getTwilioClient();
  return client.messages.create({
    from: opts.from,
    to: opts.to,
    body: opts.body,
    mediaUrl: opts.mediaUrls,
  });
}

/**
 * Place an outbound call. Customer is dialed after the agent presses 1.
 */
export async function placeOutboundCall(opts: { from: string; to: string }) {
  const client = getTwilioClient();
  return client.calls.create({
    from: opts.from,
    to: opts.to,
    url: buildWebhookUrl("/api/twilio/dial-gate-bootstrap"),
    method: "POST",
  });
}
