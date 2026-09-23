import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { calls } from "@/db/schema";
import { signedRecordingUrl } from "@/lib/twilio/storage";
import { requireDbUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/twilio/recording-url?callId=…
 *
 * Returns a short-lived signed URL the browser can use to play the recording.
 * Requires auth and binds to the caller's org — recordings are tenant-scoped.
 */
export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await requireDbUser();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const callId = url.searchParams.get("callId");
  if (!callId) return new NextResponse("Missing callId", { status: 400 });

  const rows = await db
    .select()
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.orgId, ctx.ctx.orgId)))
    .limit(1);
  const call = rows[0];
  if (!call?.recordingPath) {
    return new NextResponse("No recording", { status: 404 });
  }

  try {
    const signedUrl = await signedRecordingUrl(call.recordingPath, 600);
    return NextResponse.json({ url: signedUrl });
  } catch (err) {
    console.error("[recording-url] failed", err);
    return new NextResponse("Could not sign URL", { status: 500 });
  }
}
