"use client";

import Link from "next/link";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { SidebarEmptyOrg } from "@/components/dashboard/sidebar-empty-org";

interface SidebarBrandProps {
  workspaceName?: string;
}

export function SidebarBrand({ workspaceName }: SidebarBrandProps = {}) {
  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Link href="/dashboard">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <span className="text-sm font-semibold">K</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Kavora CRM</span>
                {workspaceName && (
                  <span className="truncate text-xs text-muted-foreground">
                    {workspaceName}
                  </span>
                )}
              </div>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarEmptyOrg />
    </SidebarHeader>
  );
}
