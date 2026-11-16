import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/agent-status", () => {
  test("refuses an anonymous caller before touching the sidecar", async () => {
    const response = await GET(new NextRequest("http://localhost/api/agent-status"));
    expect(response.status).toBe(401);
  });
});
