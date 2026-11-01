import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("POST /api/pipeline/:id/requisition", () => {
  test("requires a signed-in user before doing any Redis or sidecar work", async () => {
    const request = new NextRequest("http://localhost/api/pipeline/pip_test/requisition", {
      method: "POST",
      body: JSON.stringify({ budgetValidated: true, budgetReference: "FY2026/VOTE-03" }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request, { params: Promise.resolve({ id: "pip_test" }) });
    expect(response.status).toBe(401);
  });
});
