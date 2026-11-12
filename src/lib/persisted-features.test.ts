import { describe, expect, test } from "bun:test";

process.env.QUORUM_STORE_PATH = `/tmp/quorum-test-store-${process.pid}.json`;

const {
  startPersistedRun, markPersistedStepDone, resumePersistedStep,
  checkSupplierInStore,
} = await import("./persisted-features");
const { createOrganization } = await import("./db");

describe("persisted features", () => {
  test("checkpoint survives via store and resumes in order", () => {
    startPersistedRun("run-t1", ["parse", "review", "gate"]);
    expect(markPersistedStepDone("run-t1", "review")).toBe(false);
    expect(markPersistedStepDone("run-t1", "parse")).toBe(true);
    expect(resumePersistedStep("run-t1")).toBe("review");
  });
  test("registry screens against the real organization register", () => {
    createOrganization({
      name: "Suspended Supplies Ltd", email: "suspended@test.example", password: "x",
      registrationNo: "REG-T-1", country: "ZM", categories: [],
    });
    // Fresh orgs are ACTIVE; absence must be UNKNOWN, never a pass.
    expect(checkSupplierInStore("Suspended Supplies Ltd").found).toBe(true);
    expect(checkSupplierInStore("Nowhere Ltd").status).toBe("UNKNOWN");
  });
  test("i18n resolves locale and translates oversight keys", async () => {
    const { resolveLocale, t } = await import("./i18n");
    expect(resolveLocale("fr")).toBe("fr");
    expect(resolveLocale("de")).toBe("en");
    expect(t("fr", "oversight.backlog")).not.toBe(t("en", "oversight.backlog"));
  });
});
