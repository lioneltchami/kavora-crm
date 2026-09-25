/**
 * Unit tests for the org-resolution seam.
 *
 * Single-tenant: `currentOrgId()` always returns `KAVORA_ORG_ID`. We mock
 * `server-only` so the seam can load outside Next's RSC bundler.
 */
import { describe, test, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { currentOrgId } from "@/lib/org";
import { KAVORA_ORG_ID } from "@/db/schema";

describe("currentOrgId()", () => {
  test("returns the canonical KAVORA_ORG_ID", () => {
    expect(currentOrgId()).toBe(KAVORA_ORG_ID);
  });

  test("is idempotent across calls", () => {
    const a = currentOrgId();
    const b = currentOrgId();
    expect(a).toBe(b);
    expect(a).toBe(KAVORA_ORG_ID);
  });

  test("is synchronous and returns a non-empty string", () => {
    // Phase A had a cache(async (): Promise<string|null>); Option B reverted
    // it to a sync (): string. Guard against re-introducing an awaitable.
    const result = currentOrgId();
    expect(typeof result).toBe("string");
    expect(result).not.toBe("");
    // Promise.resolve().then would only apply to a thenable; assert the
    // returned value is a plain string (no `.then`).
    expect((result as unknown as { then?: unknown }).then).toBeUndefined();
  });

  test("returns the literal \"kavora\" (matches organizations.id seed row)", () => {
    // The DB seed migration `0006_seed_kavora_org.sql` inserts
    // `organizations(id='kavora')`. The seam and the seed must agree.
    expect(currentOrgId()).toBe("kavora");
  });
});
