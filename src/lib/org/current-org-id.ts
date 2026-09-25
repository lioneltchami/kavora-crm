/**
 * Single-tenant per deployment — returns the hardcoded `KAVORA_ORG_ID`.
 * When Kavora goes multi-tenant in the future, this seam is the place to
 * read from Clerk session instead.
 */
import "server-only";
import { KAVORA_ORG_ID } from "@/db/schema";

export function currentOrgId(): string {
  return KAVORA_ORG_ID;
}
