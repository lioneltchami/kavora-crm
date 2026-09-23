"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  Inbox,
  Phone,
  ListChecks,
  BarChart3,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const sections = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/deals", label: "Deals", icon: Briefcase },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/activities", label: "Activity", icon: ListChecks },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

const settings = [
  { href: "/settings/phone-numbers", label: "Phone numbers" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/ai", label: "AI style" },
  { href: "/settings/integrations", label: "Integrations" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 flex-col border-r bg-background md:flex">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="font-bold tracking-tight">
          Kavora CRM
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <Link
              key={s.href}
              href={s.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {s.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="mb-2 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Settings className="h-3 w-3" /> Settings
        </div>
        <nav className="space-y-1">
          {settings.map((s) => {
            const active = pathname === s.href;
            return (
              <Link
                key={s.href}
                href={s.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
