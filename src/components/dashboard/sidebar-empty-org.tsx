"use client";

import Link from "next/link";
import { useOrganization, useOrganizationList } from "@clerk/nextjs";
import { OrganizationSwitcher } from "@/components/ui/organization-switcher";
import { cn } from "@/lib/utils";

const EMPTY_STATE_URL = "https://accounts.kavora.systems/create-organization";

/**
 * Sidebar slot for Clerk Organization selection.
 *
 * - Signed-in user with ≥ 1 membership → render the project-default
 *   `<OrganizationSwitcher />`.
 * - Signed-in user with zero memberships → render a fallback Link that opens
 *   the Clerk-hosted create-organization page in a new tab. The link is
 *   styled like a dropdown-menu item so it sits naturally in the sidebar
 *   chrome.
 *
 * The membership count comes from `useOrganizationList().userMemberships` —
 * `data` is the resolved array, `isLoaded` flips true once Clerk has
 * hydrated. We render `null` while loading so the layout doesn't jump.
 */
export function SidebarEmptyOrg() {
  const { isLoaded } = useOrganization();
  const { userMemberships, isLoaded: listLoaded } = useOrganizationList();

  if (!isLoaded || !listLoaded) {
    return <div aria-hidden className="mx-2 h-9 rounded-md bg-sidebar-accent/40" />;
  }

  const membershipCount = userMemberships.data?.length ?? 0;
  if (membershipCount > 0) {
    return (
      <div className="px-2 pb-2">
        <OrganizationSwitcher />
      </div>
    );
  }

  return (
    <div className="px-2 pb-2">
      <Link
        href={EMPTY_STATE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        )}
      >
        Create or join an organization
      </Link>
    </div>
  );
}
