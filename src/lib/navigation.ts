import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  Inbox,
  Phone,
  ListChecks,
  BarChart3,
  Sparkles,
  Plug,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional badge key — future use for unread counts etc. */
  badgeKey?: string;
}

/** Main 8 nav items shown in the center of the sidebar */
export const mainNavItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/deals", label: "Deals", icon: Briefcase },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/activities", label: "Activity", icon: ListChecks },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

/** Settings items shown at the bottom (separated from main) */
export const settingsNavItems: NavItem[] = [
  { href: "/settings/phone-numbers", label: "Phone numbers", icon: Phone },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings/ai", label: "AI style", icon: Sparkles },
  { href: "/settings/integrations", label: "Integrations", icon: Plug },
];

/** Returns true if `pathname` matches or is a child of `href`. */
export function isNavItemActive(
  href: string,
  pathname: string | null,
): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  // `/dashboard` is treated as exact-match only, otherwise it would always be
  // active for any nested route (every other section gets child-route matching).
  if (href === "/dashboard") return false;
  return pathname.startsWith(`${href}/`);
}