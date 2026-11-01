import { describe, expect, test } from "bun:test";
import { GET } from "./route";

describe("GET /api", () => {
  test("returns the public API directory with its main surfaces", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=300");

    const directory = (await response.json()) as {
      service: string;
      basePath: string;
      documentation: string;
      authentication: Record<string, string>;
      surfaces: Array<{ id: string; endpoints: string[] }>;
    };

    expect(directory.service).toBe("quorum-api");
    expect(directory.basePath).toBe("/api");
    expect(directory.documentation).toBe("/docs");
    expect(directory.surfaces.map((surface) => surface.id)).toEqual([
      "public",
      "workspace",
      "procurement",
      "supplier",
      "mcp",
    ]);
    expect(directory.surfaces.flatMap((surface) => surface.endpoints)).toContain(
      "GET /api/health — web API and sidecar readiness",
    );
  });

  test("does not include credentials in the public discovery document", async () => {
    const response = await GET();
    const body = await response.text();
    expect(body).not.toMatch(/(?:secret|token|password)\s*[:=]\s*["'][^"']+/i);
  });
});
