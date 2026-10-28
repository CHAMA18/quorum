import { describe, expect, test } from "bun:test";
import { ifRangeAllows, parseByteRange } from "./src/http-range";

describe("single byte ranges", () => {
  test("a closed range is bounded and end is clamped to the object", () => {
    expect(parseByteRange("bytes=0-0", 20)).toEqual({ offset: 0, length: 1 });
    expect(parseByteRange("bytes=5-9", 20)).toEqual({ offset: 5, length: 5 });
    expect(parseByteRange("bytes=15-99", 20)).toEqual({ offset: 15, length: 5 });
  });

  test("open-ended and suffix ranges reach the ends correctly", () => {
    expect(parseByteRange("bytes=15-", 20)).toEqual({ offset: 15, length: 5 });
    expect(parseByteRange("bytes=-4", 20)).toEqual({ offset: 16, length: 4 });
    expect(parseByteRange("bytes=-99", 20)).toEqual({ offset: 0, length: 20 });
    expect(parseByteRange("BYTES=2-3", 20)).toEqual({ offset: 2, length: 2 });
  });

  test("a range outside the object is unsatisfiable, not silent", () => {
    expect(parseByteRange("bytes=20-", 20)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=99-100", 20)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=9-5", 20)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 20)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-", 0)).toBe("unsatisfiable");
  });

  test("multi-range, other units and malformed values are ignored", () => {
    expect(parseByteRange("bytes=0-1,4-5", 20)).toBeNull();
    expect(parseByteRange("items=0-1", 20)).toBeNull();
    expect(parseByteRange("bytes=abc", 20)).toBeNull();
    expect(parseByteRange("bytes=-", 20)).toBeNull();
    expect(parseByteRange("", 20)).toBeNull();
    expect(parseByteRange(null, 20)).toBeNull();
  });
});

describe("If-Range validators", () => {
  const ETAG = '"6c1c5f7f9a"';

  test("an absent or empty If-Range still serves the range", () => {
    expect(ifRangeAllows(null, ETAG)).toBe(true);
    expect(ifRangeAllows("  ", ETAG)).toBe(true);
  });

  test("only the current strong ETag keeps the range alive", () => {
    expect(ifRangeAllows(ETAG, ETAG)).toBe(true);
    expect(ifRangeAllows('"older"', ETAG)).toBe(false);
    expect(ifRangeAllows(`W/${ETAG}`, ETAG)).toBe(false);
    expect(ifRangeAllows(ETAG, null)).toBe(false);
  });
});
