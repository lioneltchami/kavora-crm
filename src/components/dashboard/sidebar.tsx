"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import {
  mainNavItems,
  settingsNavItems,
  isNavItemActive,
} from "@/lib/navigation";
import { SidebarBrand } from "@/components/dashboard/sidebar-brand";
import { SidebarUser } from "@/components/dashboard/sidebar-user";

function NavRow({
  href,
  label,
  icon: Icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  pathname: string | null;
}) {
  const active = isNavItemActive(href, pathname);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link href={href}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, toggleSidebar } = useSidebar();

  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full">
        <div className="fixed left-2 top-2 z-40 md:hidden">
          <SidebarTrigger aria-label="Open navigation" />
        </div>
        <SidebarPrimitive
          variant="floating"
          collapsible="icon"
          aria-label="Primary navigation"
          className={cn(
            "border-r border-sidebar-border/50",
            "[&_[data-sidebar=menu-button][data-active=true]]:bg-secondary",
            "[&_[data-sidebar=menu-button][data-active=true]]:text-secondary-foreground"
          )}
        >
          <div className="relative">
            <SidebarBrand />
            {state === "expanded" && (
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Collapse sidebar"
                aria-expanded="true"
                title="Collapse sidebar (⌘B)"
                className="absolute top-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </div>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {mainNavItems.map((item) => (
                    <NavRow
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      pathname={pathname}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Settings</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {settingsNavItems.map((item) => (
                    <NavRow
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      pathname={pathname}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarUser />
          </SidebarFooter>
          <SidebarRail />
        </SidebarPrimitive>
        <SidebarInset>
          <main className="flex-1 bg-muted/30 p-6 pt-16 md:pt-6">{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
