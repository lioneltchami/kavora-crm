import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { users, KAVORA_ORG_ID } from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Clerk webhook — keeps our `users` table in sync with Clerk users.
 *
 * Configure in Clerk dashboard:
 *   Endpoint: https://<your-domain>/api/webhooks/clerk
 *   Events: user.created, user.updated, user.deleted
 *   Signing secret → CLERK_WEBHOOK_SECRET env var
 *
 * Kavora runs single-tenant per deployment, so we only consume user events.
 *
 * Uses `adminDb` (not `db`) because the webhook has no Clerk session —
 * RLS would silently block every `users` write otherwise.
 */
export async function POST(req: Request) {
  const secret = env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("CLERK_WEBHOOK_SECRET missing");
    return new NextResponse("Webhook misconfigured", { status: 500 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse("Missing svix headers", { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(secret);
  let evt: ClerkWebhookEvent;
  try {
    evt = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error("Clerk webhook signature verification failed", err);
    return new NextResponse("Invalid signature", { status: 401 });
  }

  try {
    switch (evt.type) {
      case "user.created":
      case "user.updated": {
        const u = evt.data;
        const primary = u.email_addresses.find((e) => e.id === u.primary_email_address_id);
        await adminDb
          .insert(users)
          .values({
            id: u.id,
            orgId: KAVORA_ORG_ID,
            email: primary?.email_address ?? u.email_addresses[0]?.email_address ?? "",
            name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
            imageUrl: u.image_url ?? null,
          })
          .onConflictDoUpdate({
            target: users.id,
            set: {
              email: primary?.email_address ?? u.email_addresses[0]?.email_address ?? "",
              name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
              imageUrl: u.image_url ?? null,
              updatedAt: new Date(),
            },
          });
        break;
      }
      case "user.deleted":
        await adminDb.delete(users).where(eq(users.id, evt.data.id!));
        break;
      default:
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Clerk webhook DB error", err);
    return new NextResponse("DB error", { status: 500 });
  }
}

type ClerkWebhookEvent =
  | { type: "user.created"; data: ClerkUserPayload }
  | { type: "user.updated"; data: ClerkUserPayload }
  | { type: "user.deleted"; data: { id: string } };

type ClerkUserPayload = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  primary_email_address_id: string | null;
  email_addresses: Array<{ id: string; email_address: string }>;
};