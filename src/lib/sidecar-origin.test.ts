import { describe, expect, test } from "bun:test";
import { sidecarOrigin, sidecarPort } from "./sidecar-origin";
describe("server-owned sidecar origin", () => {
  test("keeps the normal port and allows an isolated local test port", () => {
    expect(sidecarOrigin({})).toBe("http://127.0.0.1:3031");
    expect(sidecarOrigin({ MCP_PORT: "3131" })).toBe("http://127.0.0.1:3131");
    expect(sidecarOrigin({ QUORUM_SIDECAR_URL: "http://localhost:3131/" })).toBe("http://localhost:3131");
  });
  test("refuses malformed ports rather than selecting an unintended service", () => {
    for (const MCP_PORT of ["0", "-1", "65536", "3131/other", "NaN"]) expect(() => sidecarPort({ MCP_PORT })).toThrow();
  });
  test("refuses external origins, credentials and path overrides", () => {
    for (const QUORUM_SIDECAR_URL of ["https://example.com", "file:///tmp/test", "http://user:pass@localhost:3131", "http://localhost:3131/path", "http://localhost:3131/?port=1"]) expect(() => sidecarOrigin({ QUORUM_SIDECAR_URL })).toThrow();
  });
});
