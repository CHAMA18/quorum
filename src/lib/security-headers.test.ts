import { describe, expect, test } from "bun:test";
import { SECURITY_HEADERS } from "./security-headers";

describe("security headers", () => {
  test("every response is frame-denied and content-type-sniffed", () => {
    const byKey = new Map(SECURITY_HEADERS.map((header) => [header.key, header.value]));
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(byKey.get("Strict-Transport-Security")).toContain("max-age=");
  });

  test("the CSP blocks framing, objects and base-tag hijacking", () => {
    const csp = SECURITY_HEADERS.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
