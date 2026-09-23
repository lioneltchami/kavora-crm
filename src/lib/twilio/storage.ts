import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

const RECORDING_BUCKET = "call-recordings";

let cached: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (!cached) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase Storage not configured");
    }
    cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return cached;
}

/**
 * Download a Twilio recording (basic-authed via subaccount API key) and upload
 * it to Supabase Storage. Returns the storage path.
 */
export async function downloadRecordingToStorage(opts: {
  callSid: string;
  recordingUrl: string;
  recordingSid: string;
}): Promise<string> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_API_KEY_SID || !env.TWILIO_API_KEY_SECRET) {
    throw new Error("Twilio not configured");
  }
  const authHeader =
    "Basic " +
    Buffer.from(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`).toString("base64");
  const urlWithExt = `${opts.recordingUrl}.mp3`;
  const res = await fetch(urlWithExt, { headers: { Authorization: authHeader } });
  if (!res.ok) {
    throw new Error(`Failed to download recording: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  const path = `${opts.callSid}/${opts.recordingSid}.mp3`;
  const sb = getSupabaseAdmin();
  const { error } = await sb.storage.from(RECORDING_BUCKET).upload(path, buf, {
    contentType: "audio/mpeg",
    upsert: true,
  });
  if (error) throw error;
  return path;
}

/**
 * Returns a signed URL the browser can use to play a recording.
 * Default TTL 5 minutes.
 */
export async function signedRecordingUrl(path: string, ttlSeconds = 300): Promise<string> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.storage
    .from(RECORDING_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Delete a recording (used by "forget me" + retention policies).
 */
export async function deleteRecording(path: string): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.storage.from(RECORDING_BUCKET).remove([path]);
}
