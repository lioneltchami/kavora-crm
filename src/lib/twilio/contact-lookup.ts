import "server-only";
import { and, eq, isNotNull, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  contacts,
  contactPhones,
  phoneNumbers,
  users,
  KAVORA_ORG_ID,
} from "@/db/schema";
import { toE164 } from "@/lib/phone";

/**
 * Find the contact matching an E.164 phone number for the org. If none exists
 * and `autoCreate` is true, creates a new lead contact (we don't want to
 * silently invent contacts on inbound SMS without a real lead, so default
 * autoCreate=false).
 *
 * After T2-1, a contact can have multiple phones (one row per channel in
 * `contact_phones`). The lookup joins that table so inbound calls to a
 * contact's non-primary phone still match the existing contact instead of
 * creating a duplicate.
 */
export async function findOrCreateContactByPhone(
  rawNumber: string,
  opts: { autoCreate?: boolean } = {},
): Promise<{ contactId: string | null; contactName: string | null; phoneE164: string | null }> {
  const e164 = toE164(rawNumber);
  if (!e164) return { contactId: null, contactName: null, phoneE164: null };

  const found = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contactPhones)
    .innerJoin(contacts, eq(contacts.id, contactPhones.contactId))
    .where(
      and(
        eq(contacts.orgId, KAVORA_ORG_ID),
        eq(contactPhones.phoneE164, e164),
        isNull(contacts.deletedAt),
      ),
    )
    .orderBy(desc(contacts.createdAt))
    .limit(1);

  if (found[0]) {
    return {
      contactId: found[0].id,
      contactName: [found[0].firstName, found[0].lastName].filter(Boolean).join(" ") || null,
      phoneE164: e164,
    };
  }

  if (!opts.autoCreate) {
    return { contactId: null, contactName: null, phoneE164: e164 };
  }

  const inserted = await db
    .insert(contacts)
    .values({
      orgId: KAVORA_ORG_ID,
      firstName: "Unknown",
      lastName: null,
      phone: e164,
      status: "lead",
      source: "inbound",
    })
    .onConflictDoNothing({ target: [contacts.orgId, contacts.phone] })
    .returning();
  let created = inserted[0];
  if (!created) {
    const existing = await db
      .select()
      .from(contactPhones)
      .innerJoin(contacts, eq(contacts.id, contactPhones.contactId))
      .where(
        and(
          eq(contacts.orgId, KAVORA_ORG_ID),
          eq(contactPhones.phoneE164, e164),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    created = existing[0]?.contacts;
  }
  if (!created) throw new Error("Failed to auto-create contact");

  return {
    contactId: created.id,
    contactName: created.firstName,
    phoneE164: e164,
  };
}

/**
 * Resolve the local Twilio number that received an inbound event. Twilio
 * always includes the called `To` number; we map it back to our `phone_numbers`
 * table to link calls/sms to the number row.
 */
export async function findPhoneNumberByE164(rawNumber: string) {
  const e164 = toE164(rawNumber);
  if (!e164) return null;
  const found = await db
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.orgId, KAVORA_ORG_ID), eq(phoneNumbers.number, e164)))
    .limit(1);
  return found[0] ?? null;
}

/**
 * Get all team cell numbers to ring on inbound calls.
 *
 * For v1: any user with `phoneForRouting` set. Future: round-robin / per-pipeline
 * routing, "press 1 for sales" menus, etc.
 */
export async function getInboundRoutingTargets(): Promise<
  Array<{ number: string; label?: string }>
> {
  const rows = await db
    .select({ phone: users.phoneForRouting, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.orgId, KAVORA_ORG_ID), isNotNull(users.phoneForRouting)));

  const out: Array<{ number: string; label?: string }> = [];
  for (const r of rows) {
    if (!r.phone) continue;
    const e164 = toE164(r.phone);
    if (!e164) continue;
    out.push({ number: e164, label: r.name ?? r.email ?? undefined });
  }
  return out;
}
