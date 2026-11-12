import { describe, expect, test } from "bun:test";
import { GUIDE_IDS, readSystemGuide } from "./quorum-knowledge";

describe("Quorum's assistant operating manual", () => {
  test("every advertised topic has a real section", () => {
    for (const id of GUIDE_IDS) {
      const text = readSystemGuide(id);
      expect(text).not.toContain("available topics:");
      expect(text.length).toBeGreaterThan(200);
    }
  });

  test("an unknown topic returns the index instead of inventing a section", () => {
    const text = readSystemGuide("not-a-topic");
    expect(text).toContain("available topics");
    expect(text).toContain("overview");
    expect(text).toContain("limits");
  });

  test("the boundary between live features and roadmap stays explicit", () => {
    const limits = readSystemGuide("limits");
    expect(limits).toContain("Not yet real");
    expect(limits).toContain("live OCDS feed");
    /* Extraction and OCR ship; the manual must say so and keep the caveats. */
    const documents = readSystemGuide("documents");
    expect(documents).toContain("upload path is live");
    expect(documents).toContain("Poppler + Tesseract");
    expect(documents).toContain("JSON and ZIP");
  });
});
