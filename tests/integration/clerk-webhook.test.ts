/**
 * Integration tests for the Clerk webhook route handler.
 *
 * Builds Svix-signed payloads with the same `svix` package the handler uses
 * to verify them, then exercises the real `POST` handler in-process. The DB
 * helpers are mocked so the suite stays offline-friendly and fast.
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

vi.mock("@/db", () => ({ db: dbStub, adminDb: dbStub }));
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
  insertChain.values.mockClear();
  insertChain.onConflictDoUpdate.mockClear();
  updateChain.set.mockClear();
  updateChain.where.mockClear();
  deleteChain.where.mockClear();
});

describe("POST /api/webhooks/clerk — signature verification", () => {
  it("returns 401 when the svix signature is missing", async () => {
    const res = await POST(
      buildRequest(
        {
          type: "user.created",
          data: {
            id: "user_test_999",
            email_addresses: [],
            primary_email_address_id: null,
            first_name: null,
            last_name: null,
            image_url: null,
          },
        },
        { unsigned: true },
      ) as never,
    );
    expect(res.status).toBe(401);
  });
});

const userFixture = (overrides: Partial<{
  id: string;
  email_addresses: Array<{ id: string; email_address: string }>;
  primary_email_address_id: string | null;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
}> = {}) => ({
  id: overrides.id ?? "user_test_abc",
  email_addresses: overrides.email_addresses ?? [
    { id: "email_primary", email_address: "ada@example.com" },
    { id: "email_other", email_address: "ada+other@example.com" },
  ],
  primary_email_address_id:
    "primary_email_address_id" in overrides
      ? overrides.primary_email_address_id
      : "email_primary",
  first_name:
    "first_name" in overrides ? overrides.first_name : "Ada",
  last_name:
    "last_name" in overrides ? overrides.last_name : "Lovelace",
  image_url:
    "image_url" in overrides ? overrides.image_url : "https://example.com/ada.png",
});

describe("POST /api/webhooks/clerk — user lifecycle", () => {
  it("upserts the user on user.created with primary email, full name, and image", async () => {
    const res = await POST(
      buildRequest({ type: "user.created", data: userFixture() }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertChain.values).toHaveBeenCalledTimes(1);
    const inserted = insertChain.values.mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      id: "user_test_abc",
      orgId: "kavora",
      email: "ada@example.com",
      name: "Ada Lovelace",
      imageUrl: "https://example.com/ada.png",
    });
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(deleteChain.where).not.toHaveBeenCalled();
  });

  it("falls back to first email when primary_email_address_id does not match", async () => {
    await POST(
      buildRequest({
        type: "user.created",
        data: userFixture({ primary_email_address_id: "email_does_not_exist" }),
      }) as never,
    );
    const inserted = insertChain.values.mock.calls[0]?.[0];
    expect(inserted?.email).toBe("ada@example.com");
  });

  it("sets name to null when both first_name and last_name are missing", async () => {
    await POST(
      buildRequest({
        type: "user.created",
        data: userFixture({ first_name: null, last_name: null }),
      }) as never,
    );
    const inserted = insertChain.values.mock.calls[0]?.[0];
    expect(inserted?.name).toBeNull();
  });

  it("refreshes user fields on user.updated via onConflictDoUpdate", async () => {
    const res = await POST(
      buildRequest({
        type: "user.updated",
        data: userFixture({
          id: "user_test_updated",
          first_name: "Grace",
          last_name: "Hopper",
          image_url: "https://example.com/grace.png",
        }),
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(insertChain.values).toHaveBeenCalledTimes(1);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const inserted = insertChain.values.mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      id: "user_test_updated",
      name: "Grace Hopper",
      imageUrl: "https://example.com/grace.png",
    });
  });

  it("deletes the user on user.deleted", async () => {
    const res = await POST(
      buildRequest({
        type: "user.deleted",
        data: { id: "user_test_deleted" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(insertChain.values).not.toHaveBeenCalled();
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and skips DB work for unknown event types", async () => {
    const res = await POST(
      buildRequest({
        type: "session.created",
        data: { id: "sess_1" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(insertChain.values).not.toHaveBeenCalled();
    expect(deleteChain.where).not.toHaveBeenCalled();
  });
});