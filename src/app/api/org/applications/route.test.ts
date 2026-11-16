import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

let currentStatus: "PENDING" | "ACTIVE" | "SUSPENDED" = "PENDING";
const sidecarCalls: string[] = [];

mock.module("@/lib/org-auth", () => ({
  ORG_SESSION_COOKIE: "quorum_org",
  getOrgFromToken: () => ({
    id: "org_test",
    name: "Test Supplier Ltd",
    status: currentStatus,
  }),
  clientKey: () => "test-ip",
  rateLimit: () => true,
  orgActor: () => "org:Test Supplier Ltd",
  publicOrg: (org: { id: string; name: string; status: string }) => ({
    id: org.id,
    name: org.name,
    status: org.status,
  }),
}));

mock.module("@/lib/org-sidecar", () => ({
  sidecarFetch: async (path: string) => {
    sidecarCalls.push(path);
    return { status: 201, data: { application: { id: "app_test" } } };
  },
  sidecarError: (data: Record<string, unknown>, fallback: string) =>
    typeof data.error === "string" && data.error ? data.error : fallback,
}));

mock.module("@/lib/supplier-bid-documents", () => ({
  publishedTenderRequirements: async () => ({ ok: true, requiredDocuments: [] }),
  verifiedSupplierOwner: () => ({ ok: true, identity: { uid: "uid_test" } }),
  verifySubmittedSupplierBidDocuments: async () => ({ ok: true, documents: [] }),
}));

const { POST } = await import("./route");

function request() {
  return new NextRequest("http://localhost/api/org/applications", {
    method: "POST",
    headers: { cookie: "quorum_org=token", "content-type": "application/json" },
    body: JSON.stringify({ tenderRef: "T-TEST-001", amount: 1000 }),
  });
}

describe("POST /api/org/applications — verification gate", () => {
  beforeEach(() => {
    sidecarCalls.length = 0;
    currentStatus = "PENDING";
  });

  test("a pending organization cannot file and never reaches the sidecar", async () => {
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("awaiting procurement-desk verification"),
    });
    expect(sidecarCalls).toEqual([]);
  });

  test("an active organization can file into the procurement record", async () => {
    currentStatus = "ACTIVE";
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(sidecarCalls).toEqual(["/api/applications"]);
  });
});
