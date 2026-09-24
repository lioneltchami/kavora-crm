import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

/** Liveness probe — checks DB connectivity. */
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[health] db probe failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
