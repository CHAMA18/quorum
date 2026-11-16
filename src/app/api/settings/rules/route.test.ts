import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/settings/rules", () => {
  test("refuses an anonymous caller", async () => {
    const response = await GET(new NextRequest("http://localhost/api/settings/rules"));
    expect(response.status).toBe(401);
  });
});
