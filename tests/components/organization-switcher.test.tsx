// @vitest-environment happy-dom
//
// Render tests for the sidebar Organization-switcher slot.
//
// Verifies the two states the sidebar can be in:
//   - Zero memberships → fallback "Create or join an organization" Link.
//   - One or more memberships → Clerk's OrganizationSwitcher primitive.
//
// Run prerequisites (resolved at reconciliation):
//   - @testing-library/react and @testing-library/jest-dom installed.
//   - happy-dom (or jsdom) installed for the DOM environment.
//   - vitest.config.ts extended to glob tests/components/.test.tsx files.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const useOrganizationMock = vi.fn((_params?: unknown): unknown => undefined);
const useOrganizationListMock = vi.fn((_params?: unknown): unknown => undefined);
const organizationSwitcherSpy = vi.fn((_props?: unknown) =>
  createElement("div", { "data-testid": "clerk-switcher" }),
);

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => useOrganizationMock(),
  useOrganizationList: () => useOrganizationListMock(),
  OrganizationSwitcher: (props: Record<string, unknown>) => organizationSwitcherSpy(props),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));

const { SidebarEmptyOrg } = await import("@/components/dashboard/sidebar-empty-org");

beforeEach(() => {
  useOrganizationMock.mockReset();
  useOrganizationListMock.mockReset();
  organizationSwitcherSpy.mockClear();
});

describe("SidebarEmptyOrg", () => {
  it("renders the create-or-join fallback when the user has zero memberships", () => {
    useOrganizationMock.mockReturnValue({ isLoaded: true });
    useOrganizationListMock.mockReturnValue({
      isLoaded: true,
      userMemberships: { data: [], count: 0 },
    });

    render(createElement(SidebarEmptyOrg));

    const link = screen.getByRole("link", { name: /create or join an organization/i });
    expect(link.getAttribute("href")).toBe(
      "https://accounts.kavora.systems/create-organization",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(organizationSwitcherSpy).not.toHaveBeenCalled();
  });

  it("renders the OrganizationSwitcher primitive when the user has memberships", () => {
    useOrganizationMock.mockReturnValue({ isLoaded: true });
    useOrganizationListMock.mockReturnValue({
      isLoaded: true,
      userMemberships: {
        data: [
          { id: "om_1", organization: { id: "org_1", name: "Acme" } },
          { id: "om_2", organization: { id: "org_2", name: "Globex" } },
        ],
        count: 2,
      },
    });

    render(createElement(SidebarEmptyOrg));

    expect(organizationSwitcherSpy).toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /create or join an organization/i })).toBeNull();
  });
});
