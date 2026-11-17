import { describe, expect, test } from "bun:test";
import { DESK_TOOLS, canReadDeskTool } from "./desk-tools";
import type { AuthUser } from "./auth-types";

const officer = { role: "OFFICER" } as AuthUser;
const owner = { role: "OWNER" } as AuthUser;

describe("OCDS desk tools", () => {
  test("the live OCDS tools exist as definitions for the model", () => {
    const names = DESK_TOOLS.map((t) => t.name);
    expect(names).toContain("ocds_registry");
    expect(names).toContain("ocds_feed");
  });

  test("officer and owner roles may read both OCDS surfaces", () => {
    expect(canReadDeskTool("ocds_registry", {}, officer)).toBe(true);
    expect(canReadDeskTool("ocds_feed", { ref: "KE-KPP-2026-001" }, officer)).toBe(true);
    expect(canReadDeskTool("ocds_registry", {}, owner)).toBe(true);
  });

  test("an unknown tool is never readable", () => {
    expect(canReadDeskTool("launch_review", {}, officer)).toBe(false);
  });
});
