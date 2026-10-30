import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeTenderRef, isTenderKeyFor, tenderDownloadFilename } from "@/lib/tender-access";

/**
 * Server-owned tender document storage.
 *
 * The edge gate (Cloudflare R2 through the quorum-edge Worker) is the preferred
 * home for tender documents, but a deployment that cannot reach it must still
 * be able to keep the file: a procurement record that refuses to accept the
 * notice because a bucket is not bound is not safer, only unusable. This
 * module stores the bytes under the application's own data directory, in the
 * same `tenders/<ref>/<key>` scheme the edge uses, so the listing, download and
 * deletion paths are identical whichever store answered.
 *
 * Every tender keeps an `index.json` written atomically (temp file + rename)
 * describing its stored objects — size, type, upload time and SHA-256. A
 * missing or unreadable index never hides files: the directory itself is
 * scanned and the objects are described from what is on disk.
 *
 * This module is server-only. It is imported exclusively from route handlers
 * running in the Node runtime; keys are validated against the tender's own
 * prefix and every write is confined to the resolved tender directory.
 */

export interface LocalStoredObject {
  key: string;
  filename: string;
  bytes: number;
  contentType: string;
  uploaded?: string;
  etag?: string;
}

interface IndexRow extends LocalStoredObject {
  sha256: string;
}

interface IndexFile {
  version: 1;
  tender: string;
  updatedAt: string;
  objects: IndexRow[];
}

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".eml": "message/rfc822",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

const MAX_SCAN_DEPTH = 5;

export function localStorageRoot(): string {
  const configured = process.env.QUORUM_DOCS_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "data", "tender-docs");
}

function tenderDir(ref: string): string {
  return path.join(localStorageRoot(), "tenders", ref);
}

function indexPath(ref: string): string {
  return path.join(tenderDir(ref), ".index.json");
}

/** Resolve a validated key to a path inside the tender's own directory. */
function objectPath(ref: string, key: string): string {
  if (!isSafeTenderRef(ref) || !isTenderKeyFor(ref, key)) {
    throw new Error("The document key must live under this tender's storage prefix.");
  }
  const base = tenderDir(ref);
  const relative = key.slice(`tenders/${ref}/`.length);
  const resolved = path.resolve(base, relative);
  if (resolved === base || !resolved.startsWith(base + path.sep)) {
    throw new Error("The document key does not resolve inside this tender's directory.");
  }
  return resolved;
}

function contentTypeFor(key: string): string {
  const ext = path.extname(key).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
}

function toPublic(row: IndexRow): LocalStoredObject {
  return {
    key: row.key,
    filename: tenderDownloadFilename(row.key),
    bytes: row.bytes,
    contentType: row.contentType || contentTypeFor(row.key),
    uploaded: row.uploaded,
    etag: row.etag,
  };
}

async function scanTender(ref: string): Promise<IndexRow[]> {
  const root = tenderDir(ref);
  const found: IndexRow[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth + 1 <= MAX_SCAN_DEPTH) {
          queue.push({ dir: full, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      const relative = path.relative(root, full).split(path.sep).join("/");
      found.push({
        key: `tenders/${ref}/${relative}`,
        filename: tenderDownloadFilename(relative),
        bytes: info.size,
        contentType: contentTypeFor(relative),
        uploaded: new Date(info.mtimeMs).toISOString(),
        etag: undefined,
        sha256: "",
      });
    }
  }
  return found;
}

async function readIndex(ref: string): Promise<IndexRow[]> {
  try {
    const raw = JSON.parse(await readFile(indexPath(ref), "utf8")) as Partial<IndexFile>;
    if (!Array.isArray(raw.objects)) return scanTender(ref);
    return raw.objects
      .filter((row): row is IndexRow => {
        if (!row || typeof row !== "object") return false;
        const candidate = row as Partial<IndexRow>;
        return (
          typeof candidate.key === "string" &&
          isTenderKeyFor(ref, candidate.key) &&
          typeof candidate.bytes === "number" &&
          Number.isFinite(candidate.bytes)
        );
      })
      .map((row) => ({
        ...row,
        filename: tenderDownloadFilename(row.key),
        contentType: row.contentType || contentTypeFor(row.key),
        sha256: typeof row.sha256 === "string" ? row.sha256 : "",
      }));
  } catch {
    /* No index yet (or an unreadable one): the files themselves are the record. */
    return scanTender(ref);
  }
}

async function writeIndex(ref: string, rows: IndexRow[]): Promise<void> {
  const sorted = [...rows].sort((a, b) => a.key.localeCompare(b.key));
  const payload: IndexFile = {
    version: 1,
    tender: ref,
    updatedAt: new Date().toISOString(),
    objects: sorted,
  };
  const target = indexPath(ref);
  const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
  await mkdir(tenderDir(ref), { recursive: true });
  await writeFile(tmp, JSON.stringify(payload, null, 2));
  await rename(tmp, target);
}

/** Store one object and describe it in the tender's index. */
export async function putLocalObject(
  ref: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<LocalStoredObject> {
  const target = objectPath(ref, key);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, target);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const row: IndexRow = {
    key,
    filename: tenderDownloadFilename(key),
    bytes: bytes.byteLength,
    contentType: contentType || contentTypeFor(key),
    uploaded: new Date().toISOString(),
    etag: `"${sha256.slice(0, 32)}"`,
    sha256,
  };
  const rows = (await readIndex(ref)).filter((candidate) => candidate.key !== key);
  rows.push(row);
  await writeIndex(ref, rows);
  return toPublic(row);
}

/** Every object this deployment holds for a tender, newest first. */
export async function listLocalObjects(ref: string): Promise<LocalStoredObject[]> {
  if (!isSafeTenderRef(ref)) return [];
  const rows = await readIndex(ref);
  return rows
    .map(toPublic)
    .sort(
      (a, b) => (b.uploaded ?? "").localeCompare(a.uploaded ?? "") || a.filename.localeCompare(b.filename),
    );
}

export async function hasLocalObject(ref: string, key: string): Promise<boolean> {
  if (!isSafeTenderRef(ref) || !isTenderKeyFor(ref, key)) return false;
  const info = await stat(objectPath(ref, key)).catch(() => null);
  return Boolean(info?.isFile());
}

export async function readLocalObject(
  ref: string,
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!isSafeTenderRef(ref) || !isTenderKeyFor(ref, key)) return null;
  const target = objectPath(ref, key);
  try {
    const bytes = await readFile(target);
    const rows = await readIndex(ref);
    const described = rows.find((row) => row.key === key);
    return { bytes, contentType: described?.contentType || contentTypeFor(key) };
  } catch {
    return null;
  }
}

/** Remove one object and its index row. Returns false when it was not there. */
export async function deleteLocalObject(ref: string, key: string): Promise<boolean> {
  if (!isSafeTenderRef(ref) || !isTenderKeyFor(ref, key)) return false;
  const target = objectPath(ref, key);
  let removed = false;
  try {
    await unlink(target);
    removed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const rows = await readIndex(ref);
  const remaining = rows.filter((row) => row.key !== key);
  if (removed || remaining.length !== rows.length) {
    await writeIndex(ref, remaining);
  }
  return removed;
}
