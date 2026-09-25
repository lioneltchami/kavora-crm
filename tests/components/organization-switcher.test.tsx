// @vitest-environment happy-dom
//
// Render tests for the sidebar Organization-switcher slot.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  organization: { isLoaded: false } as { isLoaded: boolean; organization?: unknown },
  list: {
    isLoaded: false,
    userMemberships: { data: [] as Array<{ id: string; organization: { id: string; name: string } }>, count: 0 },
  },
  switcherSpy: vi.fn((_props?: unknown) =>
    createElement("div", { "data-testid": "clerk-switcher" }),
  ),
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => mocks.organization,
  useOrganizationList: () => mocks.list,
  OrganizationSwitcher: (props: Record<string, unknown>) => mocks.switcherSpy(props),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, target, rel }: { href: string; children: ReactNode; target?: string; rel?: string }) =>
    createElement("a", { href, target, rel }, children),
}));

import { SidebarEmptyOrg } from "@/components/dashboard/sidebar-empty-org";

beforeEach(() => {
  mocks.organization = { isLoaded: true };
  mocks.list = {
    isLoaded: true,
    userMemberships: { data: [], count: 0 },
  };
  mocks.switcherSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("SidebarEmptyOrg", () => {
  it("renders the create-or-join fallback when the user has zero memberships", () => {
    render(createElement(SidebarEmptyOrg));

    const link = screen.getByRole("link", { name: /create or join an organization/i });
    expect(link.getAttribute("href")).toBe(
      "https://accounts.kavora.systems/create-organization",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(mocks.switcherSpy).not.toHaveBeenCalled();
  });

  it("renders the OrganizationSwitcher primitive when the user has memberships", () => {
    mocks.list.userMemberships = {
      data: [
        { id: "om_1", organization: { id: "org_1", name: "Acme" } },
        { id: "om_2", organization: { id: "org_2", name: "Globex" } },
      ],
      count: 2,
    };

    render(createElement(SidebarEmptyOrg));

    expect(mocks.switcherSpy).toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /create or join an organization/i })).toBeNull();
  });
});
