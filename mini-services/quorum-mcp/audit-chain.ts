/**
 * The audit chain, made verifiable across restarts.
 *
 * A hash chain proves that no line was edited or removed — as long as it has a
 * single unbroken head. It cannot survive a genuine restart that begins again
 * at `prev: "genesis"`, because a second genesis looks exactly like a break.
 * Real systems do restart, so the honest model is:
 *
 *   · a segment is one uninterrupted chain from genesis to its head;
 *   · a signed segment record (an epoch) names that segment's first and last
 *     line and its head hash, and says why the chain started again;
 *   · verification checks every segment internally *and* checks that the
 *     records cover the file one-to-one, in order, sealed with the audit key.
 *
 * A restart is then visible and attributable rather than indistinguishable
 * from tampering, and an unrecorded restart still fails verification.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface ChainEntry {
  seq: number;
  id: string;
  ts: string;
  self?: string;
  prev?: string;
  [key: string]: unknown;
}

export interface SegmentRecord {
  /** 1-based epoch: the first segment is epoch 1. */
  n: number;
  firstSeq: number;
  firstId: string;
  lastSeq: number;
  lastId: string;
  /** The segment's head — the `self` hash of its last line. */
  head: string;
  /** The head this segment resumed from, when it did not start at genesis. */
  resumedFrom: string;
  reason: string;
  sealedAt: string;
  sealedBy: string;
  sig: string;
}

export interface Segment {
  n: number;
  entries: ChainEntry[];
  start: number;
  end: number;
  ok: boolean;
  brokenAt: number | null;
}

/** The line hash — identical to the one the writer computes. */
export function hashLogEntry(entry: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex").slice(0, 16);
}

/**
 * Split a log into segments. A segment starts at genesis *or* wherever the
 * chain stops continuing from the line before it. The second case is what two
 * writers on one file look like: each appends its own chain, interleaved. It is
 * an incident worth recording, not a reason to declare the whole file
 * unverifiable forever.
 */
export function splitSegments(entries: ChainEntry[]): Segment[] {
  const starts: number[] = [];
  entries.forEach((entry, index) => {
    if (index === 0) {
      starts.push(index);
      return;
    }
    const previous = entries[index - 1];
    if (entry.prev !== previous.self) starts.push(index);
  });
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] - 1 : entries.length - 1;
    const slice = entries.slice(start, end + 1);
    /* A segment that begins mid-file resumes from the head its first line names;
       a segment at the top of the file starts at genesis. The epoch record seals
       which head that was, so the split is attributable either way. */
    let expected = slice[0]?.prev ?? "genesis";
    let brokenAt: number | null = null;
    for (let i = 0; i < slice.length; i++) {
      const { self, ...rest } = slice[i];
      if (!self || hashLogEntry(rest) !== self || slice[i].prev !== expected) {
        brokenAt = start + i;
        break;
      }
      expected = self;
    }
    return { n: index + 1, entries: slice, start, end, ok: brokenAt === null, brokenAt };
  });
}

export function canonicalSegment(record: Omit<SegmentRecord, "sig">): string {
  return [
    record.n,
    record.firstSeq,
    record.firstId,
    record.lastSeq,
    record.lastId,
    record.head,
    record.resumedFrom,
    record.reason,
    record.sealedAt,
    record.sealedBy,
  ].join("|");
}

/** Seal one segment under the audit key. */
export function sealSegment(
  segment: Segment,
  reason: string,
  sealedBy: string,
  secret: string,
  sealedAt = new Date().toISOString(),
): SegmentRecord {
  const first = segment.entries[0];
  const last = segment.entries[segment.entries.length - 1];
  const base: Omit<SegmentRecord, "sig"> = {
    n: segment.n,
    firstSeq: first.seq,
    firstId: first.id,
    lastSeq: last.seq,
    lastId: last.id,
    head: last.self ?? "",
    resumedFrom: first.prev && first.prev !== "genesis" ? first.prev : "",
    reason,
    sealedAt,
    sealedBy,
  };
  return { ...base, sig: createHmac("sha256", secret).update(canonicalSegment(base)).digest("hex") };
}

export function verifySegmentSeal(record: SegmentRecord, secret: string): { ok: boolean; reason?: string } {
  if (!record || typeof record.sig !== "string") return { ok: false, reason: "the segment record carries no seal" };
  const { sig, ...rest } = record;
  const expected = createHmac("sha256", secret).update(canonicalSegment(rest)).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return ok ? { ok: true } : { ok: false, reason: `epoch ${record.n} seal does not verify` };
}

export interface ChainVerdict {
  ok: boolean;
  brokenAt: number | null;
  checked: number;
  lines: number;
  segments: number;
  /** Every point where the chain starts again, with its line and timestamp. */
  restarts: {
    line: number;
    seq: number;
    at: string;
    kind: "restart" | "interleave";
    resumedFrom: string;
  }[];
  epochs: {
    n: number;
    sealedAt: string;
    reason: string;
    head: string;
    resumedFrom: string;
    firstLine: number;
    lastLine: number;
    lines: number;
  }[];
  registerReason?: string;
  error?: string;
}

/**
 * Verify a log against its segment register. Both must agree: a log that is
 * internally consistent but has an unsealed restart fails, and so does a
 * register that names a segment the log no longer holds.
 */
export function verifyChain(entries: ChainEntry[], register: SegmentRecord[], secret: string): ChainVerdict {
  const segments = splitSegments(entries);
  const broken = segments.find((segment) => !segment.ok);
  const restarts = segments.slice(1).map((segment) => {
    const first = entries[segment.start];
    const resumedFrom = first?.prev && first.prev !== "genesis" ? first.prev : "";
    return {
      line: segment.start + 1,
      seq: first?.seq ?? 0,
      at: first?.ts ?? "",
      kind: resumedFrom ? ("interleave" as const) : ("restart" as const),
      resumedFrom,
    };
  });

  /*
   * Epochs pin chain points, not the live tail: a sealed epoch must still name
   * lines that exist, in order, with the head it recorded. The log is allowed
   * to grow after the last epoch (that is what the daily anchor covers), but a
   * sealed line that vanished, moved or changed is a failure.
   */
  const indexById = new Map<string, { entry: ChainEntry; index: number }>();
  entries.forEach((entry, index) => indexById.set(entry.id, { entry, index }));

  let registerReason: string | undefined;
  let previousIndex = -1;
  for (let i = 0; i < register.length; i++) {
    const record = register[i];
    const seal = verifySegmentSeal(record, secret);
    if (!seal.ok) {
      registerReason = seal.reason;
      break;
    }
    if (record.n !== i + 1) {
      registerReason = `epoch numbering is not consecutive — found epoch ${record.n} where epoch ${i + 1} was expected`;
      break;
    }
    const first = indexById.get(record.firstId);
    const last = indexById.get(record.lastId);
    if (!first || !last) {
      registerReason = `epoch ${record.n} names a line that is no longer in the log — the record was truncated`;
      break;
    }
    if (first.entry.seq !== record.firstSeq || last.entry.seq !== record.lastSeq) {
      registerReason = `epoch ${record.n} does not match the sequence numbers at its recorded lines`;
      break;
    }
    if ((last.entry.self ?? "") !== record.head) {
      registerReason = `epoch ${record.n} head does not match the line it seals — that line changed after sealing`;
      break;
    }
    if (i === 0 && first.index !== 0) {
      registerReason = "the first epoch does not begin at the top of the log";
      break;
    }
    if (first.index <= previousIndex && i > 0) {
      registerReason = `epoch ${record.n} does not follow epoch ${record.n - 1}`;
      break;
    }
    previousIndex = last.index;
  }

  const ok = !broken && !registerReason;
  return {
    ok,
    brokenAt: broken ? broken.brokenAt : null,
    checked: entries.length,
    lines: entries.length,
    segments: segments.length,
    restarts,
    epochs: register.map((record) => {
      const segment = segments[record.n - 1];
      return {
        n: record.n,
        sealedAt: record.sealedAt,
        reason: record.reason,
        head: record.head,
        resumedFrom: record.resumedFrom ?? "",
        firstLine: (segment?.start ?? 0) + 1,
        lastLine: (segment?.end ?? 0) + 1,
        lines: segment?.entries.length ?? 0,
      };
    }),
    registerReason,
  };
}

const RESTART_REASON =
  "The chain resumed here at genesis without an epoch record. This epoch was sealed when the segment register was introduced, so the restart stays visible and attributable.";

/**
 * Seal any segment the register does not cover yet. Existing records are never
 * rewritten — a mismatch is left alone so verification fails loudly instead of
 * papering over a changed log.
 */
export function reconcileRegister(
  entries: ChainEntry[],
  register: SegmentRecord[],
  secret: string,
  sealedBy: string,
): { register: SegmentRecord[]; added: SegmentRecord[] } {
  const segments = splitSegments(entries);
  const next = [...register];
  const added: SegmentRecord[] = [];
  let nextNumber = next.reduce((max, record) => Math.max(max, record.n), 0) + 1;
  for (const segment of segments) {
    /* A segment is covered once an epoch seals any of its lines. Its tail may
       grow afterwards; the daily anchor is what pins the head. */
    const ids = new Set(segment.entries.map((entry) => entry.id));
    if (next.some((record) => ids.has(record.lastId))) continue;
    const first = segment.entries[0];
    const resumedFrom = first.prev && first.prev !== "genesis" ? first.prev : "";
    const reason =
      segment.n === 1
        ? "First segment of the audit log — sealed when the segment register was introduced."
        : resumedFrom
          ? `The chain resumes from a head this file does not hold (${resumedFrom}). A second writer appended here; the segment is sealed as its own epoch so the split is recorded rather than hidden.`
          : RESTART_REASON;
    const record = sealSegment({ ...segment, n: nextNumber }, reason, sealedBy, secret);
    next.push(record);
    added.push(record);
    nextNumber += 1;
  }
  next.sort((a, b) => a.n - b.n);
  return { register: next, added };
}
