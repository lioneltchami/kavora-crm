import "server-only";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { calls } from "@/db/schema";
import { deepgramConfigured, env } from "@/lib/env";

/**
 * Transcribe a call recording using Deepgram Nova-2.
 *
 * Returns `{ callId, orgId, transcript }` or null if Deepgram isn't
 * configured (so the queue falls through gracefully and the UI shows
 * "AI not configured").
 *
 * Why Deepgram: best $/min, ~30s for a 10-min call, good diarization.
 */

export type TranscriptionResult = {
  callId: string;
  orgId: string;
  transcript: string;
};

const RECORDING_BUCKET = "call-recordings";

async function getSignedRecordingUrl(path: string): Promise<string | null> {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await sb.storage.from(RECORDING_BUCKET).createSignedUrl(path, 600);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function transcribeCall(opts: {
  callSid: string;
  recordingPath: string;
}): Promise<TranscriptionResult | null> {
  if (!deepgramConfigured) {
    console.warn("[transcribe] Deepgram not configured — skipping");
    return null;
  }

  const callRow = await adminDb.select().from(calls).where(eq(calls.twilioCallSid, opts.callSid)).limit(1);
  if (!callRow[0]) return null;

  const signedUrl = await getSignedRecordingUrl(opts.recordingPath);
  if (!signedUrl) {
    await adminDb
      .update(calls)
      .set({ transcriptStatus: "failed" })
      .where(eq(calls.twilioCallSid, opts.callSid));
    return null;
  }

  try {
    const res = await fetch("https://api.deepgram.com/v1/listen", {
      method: "POST",
      headers: {
        Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: signedUrl,
        model: "nova-2",
        smart_format: true,
        diarize: false,
        punctuate: true,
      }),
    });
    if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as DeepgramResponse;
    const transcript =
      json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";

    return {
      callId: callRow[0].id,
      orgId: callRow[0].orgId,
      transcript,
    };
  } catch (err) {
    console.error("[transcribe] Deepgram error", err);
    await adminDb
      .update(calls)
      .set({ transcriptStatus: "failed" })
      .where(eq(calls.twilioCallSid, opts.callSid));
    return null;
  }
}

type DeepgramResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
      }>;
    }>;
  };
};
