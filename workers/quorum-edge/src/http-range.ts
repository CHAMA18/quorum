/**
 * Single-range `Range` parsing for the R2 download gate.
 *
 * Only `bytes=` ranges are understood. Multiple ranges are deliberately
 * ignored — HTTP lets a server answer a range request with the full
 * representation — as are malformed values and other units. A syntactically
 * valid range that starts outside the object returns `"unsatisfiable"`, so
 * the caller can answer 416 with the total size in `Content-Range`.
 */

export type ByteRange = { offset: number; length: number } | "unsatisfiable";

export function parseByteRange(
  header: string | null | undefined,
  size: number,
): ByteRange | null {
  if (!header) return null;
  const value = header.trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return "unsatisfiable";

  if (!startRaw) {
    /* bytes=-N — the last N bytes. */
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }

  const start = Number(startRaw);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return "unsatisfiable";

  let end = size - 1;
  if (endRaw) {
    const parsed = Number(endRaw);
    if (!Number.isSafeInteger(parsed)) return null;
    if (parsed < start) return "unsatisfiable";
    end = Math.min(parsed, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}

/**
 * `If-Range` carries a strong validator: if it no longer matches the object,
 * the range is stale and the full representation must be sent instead.
 */
export function ifRangeAllows(
  header: string | null | undefined,
  etag: string | null | undefined,
): boolean {
  if (!header) return true;
  const value = header.trim();
  if (!value) return true;
  if (!etag) return false;
  if (value.startsWith("W/")) return false;
  return value === etag;
}
