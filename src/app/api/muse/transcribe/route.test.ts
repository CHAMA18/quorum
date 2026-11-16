import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("POST /api/muse/transcribe", () => {
  test("refuses an anonymous caller before any paid transcription call", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/muse/transcribe", {
        method: "POST",
        body: new FormData(),
      }),
    );
    expect(response.status).toBe(401);
  });
});
