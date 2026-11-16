import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/mcp-ensure", () => {
  test("refuses an anonymous caller before spawning the sidecar", async () => {
    const response = await GET(new NextRequest("http://localhost/api/mcp-ensure"));
    expect(response.status).toBe(401);
  });
});
