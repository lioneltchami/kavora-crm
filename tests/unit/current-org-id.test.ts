/**
 * Unit tests for the org-resolution seam.
 *
 * Mocks `server-only` (it throws outside Next's RSC bundler), `@clerk/nextjs/server`,
 * and `@/db` so no real network or DB is hit.
 */
import { vi, describe, test, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
}));

vi.mock("@/db", () => {
  const insert = vi.fn();
  return {
    db: {
      query: {
        users: {
          findFirst: vi.fn(),
        },
      },
      insert,
    },
  };
});

import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";

const mockAuth = vi.mocked(auth);
const mockCurrentUser = vi.mocked(currentUser);
const mockFindFirst = vi.mocked(db.query.users.findFirst);
const mockInsert = vi.mocked(db.insert);

const fixtureUser = {
  id: "user_42",
  emailAddresses: [{ emailAddress: "u@example.com" }],
  fullName: "Test User",
  username: null,
  imageUrl: "https://img.example/u.png",
};

beforeEach(() => {
  vi.resetModules();
  mockAuth.mockReset();
  mockCurrentUser.mockReset();
  mockFindFirst.mockReset();
  mockInsert.mockReset();
});

describe("currentOrgId()", () => {
  test("(a) returns null when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({} as never);
    const { currentOrgId } = await import("@/lib/org");
    expect(await currentOrgId()).toBeNull();
  });

  test("(b) returns the Clerk org_id when the session has one", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_2xabc123" } as never);
    const { currentOrgId } = await import("@/lib/org");
    expect(await currentOrgId()).toBe("org_2xabc123");
  });

  test("(c) returns null when the Clerk session has a null org_id", async () => {
    mockAuth.mockResolvedValue({ orgId: null } as never);
    const { currentOrgId } = await import("@/lib/org");
    expect(await currentOrgId()).toBeNull();
  });
});

describe("requireOrgId()", () => {
  test("returns the Clerk org_id when the session has one", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_2xabc123" } as never);
    const { requireOrgId } = await import("@/lib/org");
    expect(await requireOrgId()).toBe("org_2xabc123");
  });

  test("throws NO_ACTIVE_ORG when the session has no org", async () => {
    mockAuth.mockResolvedValue({ orgId: null } as never);
    const { requireOrgId } = await import("@/lib/org");
    await expect(requireOrgId()).rejects.toThrow("NO_ACTIVE_ORG");
  });

  test("throws NO_ACTIVE_ORG when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({} as never);
    const { requireOrgId } = await import("@/lib/org");
    await expect(requireOrgId()).rejects.toThrow("NO_ACTIVE_ORG");
  });
});

describe("requireDbUser() — auto-provision org seam", () => {
  test("(d) provisions the users row under the active Clerk orgId", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_42",
      orgId: "org_test",
    } as never);
    mockCurrentUser.mockResolvedValue(fixtureUser as never);
    mockFindFirst.mockResolvedValue(undefined);

    const insertedRow = {
      id: "user_42",
      orgId: "org_test",
      email: fixtureUser.emailAddresses[0]?.emailAddress ?? "",
      name: fixtureUser.fullName,
      imageUrl: fixtureUser.imageUrl,
      role: "owner" as const,
      phoneForRouting: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const returning = vi.fn().mockResolvedValue([insertedRow]);
    const values = vi.fn().mockReturnValue({ returning });
    mockInsert.mockReturnValue({ values } as never);

    const { requireDbUser } = await import("@/lib/auth");
    const { ctx, dbRow } = await requireDbUser();

    expect(dbRow.orgId).toBe("org_test");
    expect(ctx.orgId).toBe("org_test");
    expect(mockInsert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user_42",
        orgId: "org_test",
        email: fixtureUser.emailAddresses[0]?.emailAddress ?? "",
      }),
    );
  });

  test("(e) refuses to auto-provision when currentOrgId() is null", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_42",
      orgId: null,
    } as never);
    mockCurrentUser.mockResolvedValue(fixtureUser as never);
    mockFindFirst.mockResolvedValue(undefined);

    const { requireDbUser } = await import("@/lib/auth");

    await expect(requireDbUser()).rejects.toThrow("No active organization");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
