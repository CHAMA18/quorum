import { describe, expect, test } from "bun:test";
import { parseSamBoxes, pageForVision, samEnabled } from "./sam";

/**
 * SAM 3.1 wire-format coverage. The live model is exercised by the bench /
 * upload path; these tests pin the parser and the opt-in gate so a malformed
 * stream can never be mistaken for a located table.
 */

describe("SAM 3.1 output", () => {
  test("parses boxes from the special-token text, with and without confidence", () => {
    const text =
      "<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~abc|>,1<|box;x1=260;y1=382;x2=340;y2=427;w=537;h=561;c=0.9609375|><|mask;x=0;y=0;c=0.9609375;data=46,81,~def|>";
    const boxes = parseSamBoxes(text);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ x1: 353, y1: 382, x2: 453, y2: 427, width: 537, height: 561 });
    expect(boxes[0].confidence).toBeUndefined();
    expect(boxes[1].confidence).toBeCloseTo(0.9609375);
  });

  test("zero matches is a valid empty result, not an error", () => {
    expect(parseSamBoxes("")).toEqual([]);
    expect(parseSamBoxes("<0f>")).toEqual([]);
  });

  test("the gate is exact: only SAM_ENABLED=true turns the call on", () => {
    expect(samEnabled({})).toBe(false);
    expect(samEnabled({ SAM_ENABLED: "1" })).toBe(false);
    expect(samEnabled({ SAM_ENABLED: "TRUE" })).toBe(true);
    expect(samEnabled({ SAM_ENABLED: "true" })).toBe(true);
  });

  test("an image upload is sent as-is; an unsupported type is refused", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const page = await pageForVision(png, "scan.png");
    expect("error" in page).toBe(false);
    if (!("error" in page)) {
      expect(page.mime).toBe("image/png");
      expect(page.page).toBeUndefined();
      expect(page.bytes).toEqual(png);
    }
    const bad = await pageForVision(new Uint8Array([1, 2]), "notes.docx");
    expect("error" in bad && bad.error).toContain("PDF or image");
  });
});
