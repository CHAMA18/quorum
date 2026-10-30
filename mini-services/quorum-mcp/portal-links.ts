/**
 * quorum-mcp — portal connections.
 *
 * "Connected" is not a badge. For every dataset on the OCP Data Registry —
 * the African desk and the global jurisdictions — this module runs a real
 * handshake: it opens the dataset's
 * published JSONL, reads a small slice, decompresses it, parses the first
 * OCDS release and keeps its OCID as proof; it also checks the publisher's
 * own portal over HTTP. Every check is dated and kept on disk — a failed
 * check is recorded, never hidden.
 */

import { createGunzip } from "node:zlib";
import { resolveDataDir } from "./paths";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { OcpAfricaDataset } from "./ocp-africa";
import { getOcpDatasets } from "./ocp-live";

export interface RegistryHandshake {
  ok: boolean;
  /** The HTTP status of the published file (206 when Range is honoured). */
  status: number | null;
  /** Compressed bytes actually read — never the whole file. */
  bytes: number;
  /** The first OCDS release in the slice — the proof the bytes are OCDS. */
  ocid: string | null;
  ms: number;
  error: string | null;
}

export interface PortalProbe {
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
}

export interface PortalLink {
  publicationId: number;
  checkedAt: string;
  registry: RegistryHandshake;
  portal: PortalProbe;
}

export interface PortalLinksFile {
  updatedAt: string;
  links: Record<string, PortalLink>;
}

const DATA_DIR = resolveDataDir();
const LINKS_FILE = DATA_DIR + "portal-links.json";
/* 256 KB of the published file is enough for its first releases — the
   handshake never downloads a full dataset. */
const SLICE_BYTES = 262_144;
const REGISTRY_TIMEOUT_MS = 30_000;
const PORTAL_TIMEOUT_MS = 12_000;

/* The first complete OCDS release in a JSONL head — a slice can end
   mid-line, so only lines that parse are trusted. */
function firstOcidIn(text: string): string | null {
  for (const line of text.split("\n").slice(0, 80)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const obj = JSON.parse(t) as { ocid?: unknown };
      if (typeof obj.ocid === "string" && obj.ocid.length > 0) return obj.ocid;
    } catch {
      /* a line cut by the slice boundary — earlier lines still stand */
    }
  }
  return null;
}

/* Decompress the head of the published file and read its first release.
   A slice ends with Z_BUF_ERROR by design; the complete lines are the proof.
   Exported so the handshake can be tested without the network. */
export async function firstOcidFrom(raw: Uint8Array): Promise<string | null> {
  if (raw.length < 2) return null;
  const gzipped = raw[0] === 0x1f && raw[1] === 0x8b;
  if (!gzipped) return firstOcidIn(Buffer.from(raw).toString("utf8"));
  return await new Promise((resolve) => {
    const gunzip = createGunzip();
    let out = "";
    let settled = false;
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      gunzip.destroy();
      resolve(value);
    };
    gunzip.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (out.includes("\n") || out.length > 2_000_000) settle(firstOcidIn(out));
    });
    gunzip.on("end", () => settle(firstOcidIn(out)));
    gunzip.on("error", () => settle(firstOcidIn(out)));
    try {
      gunzip.end(Buffer.from(raw));
    } catch {
      settle(firstOcidIn(out));
    }
  });
}

function readError(e: unknown, timeoutMs: number): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === "AbortError" || err?.name === "TimeoutError" || /abort/i.test(err?.message ?? "")) {
    return `timed out after ${Math.round(timeoutMs / 1000)}s`;
  }
  const cause = err?.cause;
  const detail = cause?.code
    ? `${cause.code}${cause.message ? ` (${cause.message})` : ""}`
    : cause?.message ?? err?.message ?? "fetch failed";
  return String(detail).replace(/\s+/g, " ").slice(0, 90);
}

/* Open the dataset's published JSONL, read a bounded slice, and parse the
   first release. Range keeps it to 256 KB even for a 90 MB record. */
export async function probeRegistry(d: OcpAfricaDataset, fetchImpl: typeof fetch = fetch): Promise<RegistryHandshake> {
  const started = Date.now();
  const file = d.downloads.find((x) => x.format === "JSONL");
  if (!file?.url) {
    return { ok: false, status: null, bytes: 0, ocid: null, ms: 0, error: "no JSONL file published" };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REGISTRY_TIMEOUT_MS);
  try {
    const res = await fetchImpl(file.url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { Range: `bytes=0-${SLICE_BYTES - 1}` },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, bytes: 0, ocid: null, ms: Date.now() - started, error: `HTTP ${res.status}` };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      return { ok: false, status: res.status, bytes: 0, ocid: null, ms: Date.now() - started, error: "no response body" };
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (bytes < SLICE_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        bytes += value.byteLength;
      }
    }
    await reader.cancel().catch(() => {});
    if (bytes === 0) {
      return { ok: false, status: res.status, bytes: 0, ocid: null, ms: Date.now() - started, error: "empty response" };
    }
    const ocid = await firstOcidFrom(Buffer.concat(chunks));
    return {
      ok: Boolean(ocid),
      status: res.status,
      bytes,
      ocid,
      ms: Date.now() - started,
      error: ocid ? null : "no OCDS release parsed from the slice",
    };
  } catch (e) {
    return { ok: false, status: null, bytes: 0, ocid: null, ms: Date.now() - started, error: readError(e, REGISTRY_TIMEOUT_MS) };
  } finally {
    clearTimeout(timer);
  }
}

/* Check the publisher's own portal. HEAD first; some hosts drop or refuse
   HEAD, so a GET for one kilobyte is the fallback. */
export async function probePortal(d: OcpAfricaDataset, fetchImpl: typeof fetch = fetch): Promise<PortalProbe> {
  const started = Date.now();
  if (!d.portalUrl) return { ok: false, status: null, ms: 0, error: "no portal URL published" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PORTAL_TIMEOUT_MS);
  try {
    let res: Response | null = null;
    try {
      res = await fetchImpl(d.portalUrl, { method: "HEAD", redirect: "follow", signal: ctl.signal });
    } catch {
      res = null; // host dropped HEAD — ask again with GET
    }
    if (!res || res.status >= 400) {
      await res?.body?.cancel().catch(() => {});
      res = await fetchImpl(d.portalUrl, {
        redirect: "follow",
        signal: ctl.signal,
        headers: { Range: "bytes=0-1023" },
      });
    }
    const status = res.status;
    await res.body?.cancel().catch(() => {});
    const ok = status < 400;
    return { ok, status, ms: Date.now() - started, error: ok ? null : `HTTP ${status}` };
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - started, error: readError(e, PORTAL_TIMEOUT_MS) };
  } finally {
    clearTimeout(timer);
  }
}

export async function connectOne(d: OcpAfricaDataset, fetchImpl: typeof fetch = fetch): Promise<PortalLink> {
  const [registry, portal] = await Promise.all([probeRegistry(d, fetchImpl), probePortal(d, fetchImpl)]);
  return { publicationId: d.publicationId, checkedAt: new Date().toISOString(), registry, portal };
}

export function loadPortalLinks(): PortalLinksFile {
  const known = new Set(getOcpDatasets().map((d) => String(d.publicationId)));
  try {
    const raw = JSON.parse(readFileSync(LINKS_FILE, "utf8")) as Partial<PortalLinksFile>;
    if (raw && typeof raw === "object" && raw.links && typeof raw.links === "object") {
      const links: Record<string, PortalLink> = {};
      for (const [key, link] of Object.entries(raw.links)) {
        if (known.has(key) && link && typeof link === "object") links[key] = link as PortalLink;
      }
      return { updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "", links };
    }
  } catch {
    /* nothing connected yet */
  }
  return { updatedAt: "", links: {} };
}

export function savePortalLinks(file: PortalLinksFile): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = LINKS_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(file, null, 2));
    renameSync(tmp, LINKS_FILE);
  } catch {
    /* the connection record must never take the service down */
  }
}

/* Connect the named datasets (null = every dataset), one at a time, saving
   after each — a dropped connection loses one check, not the run. */
export async function connectMany(ids: number[] | null, fetchImpl: typeof fetch = fetch): Promise<PortalLinksFile> {
  const wanted = ids && ids.length > 0 ? new Set(ids) : null;
  const targets = getOcpDatasets().filter((d) => !wanted || wanted.has(d.publicationId));
  const file = loadPortalLinks();
  for (const d of targets) {
    file.links[String(d.publicationId)] = await connectOne(d, fetchImpl);
    file.updatedAt = new Date().toISOString();
    savePortalLinks(file);
  }
  return file;
}
