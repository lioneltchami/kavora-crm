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
});
