import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/events", () => {
  test("refuses an anonymous stream", async () => {
    const response = await GET(new NextRequest("http://localhost/api/events"));
    expect(response.status).toBe(401);
  });
});
