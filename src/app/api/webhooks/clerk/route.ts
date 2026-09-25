import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { users, KAVORA_ORG_ID } from "@/db/schema";
import { env } from "@/lib/env";
import {
  attachMembership,
  deleteOrganization,
  detachMembership,
  upsertOrganization,
  type ClerkOrgMembershipPayload,
  type ClerkOrgPayload,
} from "@/lib/clerk-orgs";

/**
 * Clerk webhook — keeps our `users` and `organizations` tables in sync with
 * Clerk users, organizations, and memberships.
 *
 * Configure in Clerk dashboard:
 *   Endpoint: https://<your-domain>/api/webhooks/clerk
 *   Events: user.created, user.updated, user.deleted,
 *           organization.created, organization.updated, organization.deleted,
 *           organizationMembership.created, organizationMembership.updated,
 *           organizationMembership.deleted
 *   Signing secret → CLERK_WEBHOOK_SECRET env var
 *
 * Organizations must be enabled in the Clerk dashboard (Settings →
 * Organizations → "Enable Organizations") for org events to fire.
 *
 * Uses `adminDb` (not `db`) because the webhook has no Clerk session —
 * RLS would silently block every `users` write otherwise. The Clerk-orgs
 * helpers internally also use `adminDb` for `users` updates and audit_log
 * inserts.
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
      case "organization.created":
      case "organization.updated":
        await upsertOrganization(evt.data);
        break;
      case "organization.deleted":
        await deleteOrganization(evt.data);
        break;
      case "organizationMembership.created":
      case "organizationMembership.updated":
        await attachMembership(evt.data);
        break;
      case "organizationMembership.deleted":
        await detachMembership(evt.data);
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
  | { type: "user.deleted"; data: { id: string } }
  | { type: "organization.created"; data: ClerkOrgPayload }
  | { type: "organization.updated"; data: ClerkOrgPayload }
  | { type: "organization.deleted"; data: ClerkOrgPayload }
  | { type: "organizationMembership.created"; data: ClerkOrgMembershipPayload }
  | { type: "organizationMembership.updated"; data: ClerkOrgMembershipPayload }
  | { type: "organizationMembership.deleted"; data: ClerkOrgMembershipPayload };

type ClerkUserPayload = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  primary_email_address_id: string | null;
  email_addresses: Array<{ id: string; email_address: string }>;
};
