"use client";

import { OrganizationSwitcher as ClerkOrganizationSwitcher } from "@clerk/nextjs";

/**
 * Thin Kavora-specific wrapper around Clerk's `<OrganizationSwitcher />`.
 *
 * Locks in the project defaults:
 *   - `hidePersonal` — Kavora CRM is pure B2B; personal workspaces are off.
 *   - `afterSelectOrganizationUrl="/dashboard"` — bounce to the dashboard after
 *     a switch so any stale per-org state is re-fetched.
 *   - `organizationProfileMode="modal"` — keep the user on the dashboard while
 *     they edit org settings; the modal closes on save.
 *
 * Keyboard accessibility is inherited from Clerk's Radix-based primitive.
 */
export function OrganizationSwitcher() {
  return (
    <ClerkOrganizationSwitcher
      hidePersonal
      afterSelectOrganizationUrl="/dashboard"
      organizationProfileMode="modal"
    />
  );
}
