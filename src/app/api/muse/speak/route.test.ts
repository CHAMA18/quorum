import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("POST /api/muse/speak", () => {
  test("refuses an anonymous caller before any paid TTS call", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/muse/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
