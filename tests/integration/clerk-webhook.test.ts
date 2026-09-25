/**
 * Integration tests for the Clerk webhook route handler.
 *
 * Builds Svix-signed payloads with the same `svix` package the handler uses
 * to verify them, then exercises the real `POST` handler in-process. The DB
 * and audit helpers are mocked so the suite stays offline-friendly and fast.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Webhook } from "svix";

const RAW_SECRET = "test_secret_for_clerk_webhook_runner";
const SECRET = `whsec_${Buffer.from(RAW_SECRET).toString("base64")}`;

vi.mock("@/lib/env", () => ({
  env: {
    CLERK_WEBHOOK_SECRET: SECRET,
  },
}));

const upsertOrganization = vi.fn(async (_data: unknown) => undefined);
const deleteOrganization = vi.fn(async (_data: unknown) => undefined);
const attachMembership = vi.fn(async (_data: unknown) => undefined);
const detachMembership = vi.fn(async (_data: unknown) => undefined);

vi.mock("@/lib/clerk-orgs", () => ({
  upsertOrganization: (data: unknown) => upsertOrganization(data),
  deleteOrganization: (data: unknown) => deleteOrganization(data),
  attachMembership: (data: unknown) => attachMembership(data),
  detachMembership: (data: unknown) => detachMembership(data),
}));

type DbStub = {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
const dbStub: DbStub = {
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@/db", () => ({ db: dbStub }));
vi.mock("@/db/schema", () => ({
  users: { id: "id" },
  KAVORA_ORG_ID: "kavora",
}));

const insertChain = {
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
};
const updateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};
const deleteChain = {
  where: vi.fn().mockResolvedValue(undefined),
};
dbStub.insert.mockReturnValue(insertChain);
dbStub.update.mockReturnValue(updateChain);
dbStub.delete.mockReturnValue(deleteChain);

const { POST } = await import("@/app/api/webhooks/clerk/route");

function signPayload(body: string): { id: string; timestamp: string; signature: string } {
  const wh = new Webhook(SECRET);
  const id = `msg_${Math.random().toString(36).slice(2, 12)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = wh.sign(id, new Date(Number(timestamp) * 1000), body);
  return { id, timestamp, signature };
}

function buildRequest(body: object, opts: { unsigned?: boolean } = {}): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.unsigned) {
    headers["svix-id"] = "msg_bogus";
    headers["svix-timestamp"] = String(Math.floor(Date.now() / 1000));
    headers["svix-signature"] = "v1,this_is_a_bogus_signature_that_will_fail_verification";
  } else {
    const { id, timestamp, signature } = signPayload(raw);
    headers["svix-id"] = id;
    headers["svix-timestamp"] = timestamp;
    headers["svix-signature"] = signature;
  }
  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers,
    body: raw,
  });
}

beforeEach(() => {
  upsertOrganization.mockClear();
  deleteOrganization.mockClear();
  attachMembership.mockClear();
  detachMembership.mockClear();
  insertChain.values.mockClear();
  insertChain.onConflictDoUpdate.mockClear();
  updateChain.set.mockClear();
  updateChain.where.mockClear();
  deleteChain.where.mockClear();
});

describe("POST /api/webhooks/clerk — organization events", () => {
  it("handles organization.created via upsertOrganization", async () => {
    const res = await POST(
      buildRequest({
        type: "organization.created",
        data: { id: "org_test_123", name: "Acme Corp", slug: "acme" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(upsertOrganization).toHaveBeenCalledWith({
      id: "org_test_123",
      name: "Acme Corp",
      slug: "acme",
    });
  });

  it("handles organization.deleted via deleteOrganization", async () => {
    const res = await POST(
      buildRequest({
        type: "organization.deleted",
        data: { id: "org_test_456" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(deleteOrganization).toHaveBeenCalledWith({ id: "org_test_456" });
  });

  it("handles organizationMembership.created via attachMembership", async () => {
    const res = await POST(
      buildRequest({
        type: "organizationMembership.created",
        data: {
          id: "om_test_789",
          organization: { id: "org_test_123", name: "Acme Corp", slug: "acme" },
          public_user_data: { user_id: "user_test_abc" },
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(attachMembership).toHaveBeenCalledWith({
      id: "om_test_789",
      organization: { id: "org_test_123", name: "Acme Corp", slug: "acme" },
      public_user_data: { user_id: "user_test_abc" },
    });
  });

  it("handles organizationMembership.deleted via detachMembership", async () => {
    const res = await POST(
      buildRequest({
        type: "organizationMembership.deleted",
        data: {
          id: "om_test_790",
          organization: { id: "org_test_123", name: "Acme Corp", slug: "acme" },
          public_user_data: { user_id: "user_test_abc" },
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(detachMembership).toHaveBeenCalledWith({
      id: "om_test_790",
      organization: { id: "org_test_123", name: "Acme Corp", slug: "acme" },
      public_user_data: { user_id: "user_test_abc" },
    });
  });

  it("returns 401 when the svix signature is missing", async () => {
    const res = await POST(
      buildRequest(
        {
          type: "organization.created",
          data: { id: "org_test_999", name: "Bad" },
        },
        { unsigned: true },
      ) as never,
    );
    expect(res.status).toBe(401);
    expect(upsertOrganization).not.toHaveBeenCalled();
  });
});
