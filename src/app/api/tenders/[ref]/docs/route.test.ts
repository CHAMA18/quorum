import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { signTenderDownload } from "@/lib/tender-access";

/**
 * Live coverage for the tender upload route.
 *
 * A mocked session exercises the role gate, and a mocked sidecar records both
 * the staging call and the hash-chained upload audit entry; the accepted
 * uploads go through the deployed quorum-edge gate into the real
 * quorum-tenders bucket. Skipped when the edge credentials are absent (CI).
 * With the Cloudflare credentials present, each uploaded test object is
 * deleted again in afterAll.
 *
 * The PDF/DOCX/XLSX fixtures are generated in-process, so the test proves the
 * whole path — binary → extracted text → sidecar tender directory → audit
 * entry — and not just that a file arrived.
 */

type TestUser = {
  id: string;
  name: string;
  email: string;
  organization: null;
  role: "OFFICER" | "AUDITOR";
};

const OFFICER: TestUser = {
  id: "u_test_officer",
  name: "Test Officer",
  email: "officer@quorum.test",
  organization: null,
  role: "OFFICER",
};

let currentUser: TestUser | null = OFFICER;

mock.module("@/lib/auth", () => ({
  SESSION_COOKIE: "quorum_session",
  getUserFromToken: async () => currentUser,
  rateLimit: () => true,
}));

interface StageCall {
  path: string;
  actor?: string;
  docs: { name: string; text: string; kind: string }[];
}

interface AuditCall {
  path: string;
  actor?: string;
  body: {
    tenderId: string;
    key: string;
    bytes: number;
    contentType: string;
    filename: string;
    staged: boolean;
    extracted: boolean;
    kind?: string;
    pages?: number;
    sheets?: string[];
    chars?: number;
    note?: string;
    reason?: string;
    files: string[];
    durationMs: number;
  };
}

interface DownloadAuditCall {
  path: string;
  actor?: string;
  body: {
    tenderId: string;
    key: string;
    filename: string;
    userId: string;
    role: string;
    bytes: number;
    range?: string;
    partial: boolean;
    contentRange?: string;
    linkExpiresAt: number;
    durationMs: number;
  };
}

interface DeletionAuditCall {
  path: string;
  actor?: string;
  body: {
    tenderId: string;
    key: string;
    filename: string;
    userId: string;
    role: string;
    durationMs: number;
  };
}

const stageCalls: StageCall[] = [];
const auditCalls: AuditCall[] = [];
const downloadAuditCalls: DownloadAuditCall[] = [];
const deletionAuditCalls: DeletionAuditCall[] = [];
let stageStatus = 201;
let auditStatus = 201;
let downloadAuditStatus = 201;
let deletionAuditStatus = 201;

mock.module("@/lib/org-sidecar", () => ({
  sidecarFetch: async (
    path: string,
    init?: { method?: string; body?: unknown; actor?: string },
  ) => {
    if (path === "/api/tender-uploads") {
      auditCalls.push({ path, actor: init?.actor, body: init?.body as AuditCall["body"] });
      if (auditStatus === 201) {
        return {
          status: 201,
          data: { entry: { seq: 400 + auditCalls.length, id: "tl_test_upload", self: "a1b2c3d4e5f60718" } },
        };
      }
      return { status: auditStatus, data: { error: "audit refused" } };
    }
    if (path === "/api/tender-downloads") {
      downloadAuditCalls.push({
        path,
        actor: init?.actor,
        body: init?.body as DownloadAuditCall["body"],
      });
      if (downloadAuditStatus === 201) {
        return {
          status: 201,
          data: {
            entry: {
              seq: 500 + downloadAuditCalls.length,
              id: "tl_test_download",
              self: "d1e2f3a4b5c6d7e8",
            },
          },
        };
      }
      return { status: downloadAuditStatus, data: { error: "download audit refused" } };
    }
    if (path === "/api/tender-deletions") {
      deletionAuditCalls.push({
        path,
        actor: init?.actor,
        body: init?.body as DeletionAuditCall["body"],
      });
      if (deletionAuditStatus === 201) {
        return {
          status: 201,
          data: {
            entry: {
              seq: 600 + deletionAuditCalls.length,
              id: "tl_test_delete",
              self: "f1e2d3c4b5a69788",
            },
          },
        };
      }
      return { status: deletionAuditStatus, data: { error: "deletion audit refused" } };
    }
    if (init?.body && typeof init.body === "object") {
      const body = init.body as { docs?: StageCall["docs"] };
      stageCalls.push({ path, actor: init.actor, docs: body.docs ?? [] });
      if (stageStatus === 201) {
        return { status: 201, data: { files: ["01-manual-notice.md", "91-bid-test.md"] } };
      }
      return { status: stageStatus, data: { error: "sidecar refused the stage" } };
    }
    return { status: 404, data: { error: "not found" } };
  },
  sidecarError: (data: Record<string, unknown>, fallback: string) =>
    typeof data.error === "string" && data.error ? data.error : fallback,
}));

const EDGE_URL = (process.env.QUORUM_EDGE_URL ?? "").trim().replace(/\/+$/, "");
const EDGE_SECRET = (process.env.QUORUM_EDGE_SECRET ?? "").trim();
const CONFIGURED = EDGE_URL.length > 0 && EDGE_SECRET.length > 0;
const suite = CONFIGURED ? describe : describe.skip;

const REF = "T-ROUTE-TEST";
const ACCOUNT = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN ?? "").trim();
const BUCKET = (process.env.R2_BUCKET ?? "").trim() || "quorum-tenders";
const uploaded: string[] = [];

beforeEach(() => {
  stageCalls.length = 0;
  auditCalls.length = 0;
  downloadAuditCalls.length = 0;
  deletionAuditCalls.length = 0;
  stageStatus = 201;
  auditStatus = 201;
  downloadAuditStatus = 201;
  deletionAuditStatus = 201;
  currentUser = OFFICER;
});

afterAll(async () => {
  if (!ACCOUNT || !TOKEN) return;
  await Promise.all(
    uploaded.map(async (key) => {
      try {
        await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } },
        );
      } catch {
        /* best-effort cleanup; the object is a few bytes under a test ref */
      }
    }),
  );
});

async function post(file: File | null, ref = REF) {
  const { POST } = await import("./route");
  const form = new FormData();
  if (file) form.append("file", file);
  const req = new NextRequest(`http://localhost/api/tenders/${encodeURIComponent(ref)}/docs`, {
    method: "POST",
    body: form,
  });
  return POST(req, { params: Promise.resolve({ ref }) });
}

async function putObject(key: string, body: string, contentType = "text/plain") {
  const res = await fetch(`${EDGE_URL}/__edge/upload?key=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "x-quorum-edge-key": EDGE_SECRET, "content-type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  uploaded.push(key);
}

async function linkFor(key: string, ref = REF) {
  const { GET } = await import("./link/route");
  const req = new NextRequest(
    `http://localhost/api/tenders/${encodeURIComponent(ref)}/docs/link?key=${encodeURIComponent(key)}`,
  );
  return GET(req, { params: Promise.resolve({ ref }) });
}

async function downloadFor(url: string, ref = REF, headers: Record<string, string> = {}) {
  const { GET } = await import("./download/route");
  const req = new NextRequest(url.startsWith("http") ? url : `http://localhost${url}`, { headers });
  return GET(req, { params: Promise.resolve({ ref }) });
}

async function listFor(ref = REF) {
  const { GET } = await import("./route");
  const req = new NextRequest(`http://localhost/api/tenders/${encodeURIComponent(ref)}/docs`);
  return GET(req, { params: Promise.resolve({ ref }) });
}

async function deleteFor(key: string, ref = REF) {
  const { DELETE } = await import("./route");
  const req = new NextRequest(
    `http://localhost/api/tenders/${encodeURIComponent(ref)}/docs?key=${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
  return DELETE(req, { params: Promise.resolve({ ref }) });
}

/* BlobPart needs an ArrayBuffer, while the fixture writers return views over
   ArrayBufferLike. Copy into a fresh buffer so the test stays type-safe. */
function fileOf(bytes: Uint8Array, name: string, type: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type });
}

async function pdf(text: string): Promise<File> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  text.split("\n").forEach((line, i) => {
    page.drawText(line, { x: 48, y: 790 - i * 18, size: 11, font });
  });
  return fileOf(await doc.save(), "tender-notice.pdf", "application/pdf");
}

async function docx(text: string): Promise<File> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: text.split("\n").map((line) => new Paragraph({ text: line })),
      },
    ],
  });
  return fileOf(await Packer.toBuffer(doc), "bidder-northwind.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

async function xlsx(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Pricing");
  sheet.addRow(["Item", "Quantity", "Unit price", "Currency"]);
  sheet.addRow(["Infusion pump", 40, 185000, "KES"]);
  sheet.addRow(["Syringe driver", 12, 92000, "KES"]);
  const bytes = await wb.xlsx.writeBuffer();
  return fileOf(new Uint8Array(bytes), "bidder-pricing.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

suite("POST /api/tenders/:ref/docs", () => {
  test("refuses an anonymous upload", async () => {
    currentUser = null;
    const res = await post(new File(["x"], "notice.txt", { type: "text/plain" }));
    expect(res.status).toBe(401);
    expect(stageCalls.length).toBe(0);
    expect(auditCalls.length).toBe(0);
  });

  test("refuses a role without run_reviews", async () => {
    currentUser = { ...OFFICER, role: "AUDITOR" };
    const res = await post(new File(["x"], "notice.txt", { type: "text/plain" }));
    expect(res.status).toBe(403);
    expect(stageCalls.length).toBe(0);
    expect(auditCalls.length).toBe(0);
  });

  test("refuses a request without a file", async () => {
    const res = await post(null);
    expect(res.status).toBe(422);
  });

  test("refuses an unsafe tender reference", async () => {
    const res = await post(new File(["x"], "notice.txt", { type: "text/plain" }), "..");
    expect(res.status).toBe(422);
  });

  test("refuses an unsupported extension", async () => {
    const res = await post(new File(["MZ"], "malware.exe", { type: "application/octet-stream" }));
    expect(res.status).toBe(415);
  });

  test("stores text in R2 and stages it for review", async () => {
    const body = `INVITATION TO TENDER\nroute upload ${Date.now()}`;
    const res = await post(new File([body], "route-test.txt", { type: "text/plain" }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      ok?: boolean;
      key?: string;
      bytes?: number;
      staged?: boolean;
      kind?: string;
      chars?: number;
      audited?: boolean;
      audit?: { seq: number; id: string; self: string };
    };
    expect(json.ok).toBe(true);
    expect(json.bytes).toBe(body.length);
    expect(json.staged).toBe(true);
    expect(json.kind).toBe("notice");
    expect(json.chars).toBe(body.length);
    expect(json.key).toMatch(/^tenders\/T-ROUTE-TEST\/\d+-route-test\.txt$/);
    expect(json.audited).toBe(true);
    expect(json.audit?.seq).toBe(401);
    if (json.key) uploaded.push(json.key);

    const call = stageCalls[0];
    expect(call.path).toBe(`/api/tenders/${REF}/docs`);
    expect(call.docs).toHaveLength(1);
    expect(call.docs[0].text).toContain("INVITATION TO TENDER");
    expect(call.docs[0].kind).toBe("notice");

    const audit = auditCalls[0];
    expect(audit.path).toBe("/api/tender-uploads");
    expect(audit.actor).toBe(OFFICER.name);
    expect(audit.body.tenderId).toBe(REF);
    expect(audit.body.key).toBe(json.key ?? "");
    expect(audit.body.bytes).toBe(body.length);
    expect(audit.body.contentType).toBe("text/plain");
    expect(audit.body.filename).toBe("route-test.txt");
    expect(audit.body.staged).toBe(true);
    expect(audit.body.extracted).toBe(true);
    expect(audit.body.kind).toBe("notice");
    expect(audit.body.files).toContain("01-manual-notice.md");

    const object = await fetch(
      `${EDGE_URL}/__edge/object?key=${encodeURIComponent(json.key ?? "")}`,
      { headers: { "x-quorum-edge-key": EDGE_SECRET } },
    );
    expect(object.status).toBe(200);
    expect(await object.text()).toBe(body);
  }, 30_000);

  test("extracts a PDF page by page and stages it as a notice", async () => {
    const marker = `PORTAL INSTALLATION ${Date.now()}`;
    const fixture = await pdf(`INVITATION TO TENDER\n${marker}\nClosing date: 12 March 2027`);
    const res = await post(fixture);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      key?: string;
      staged?: boolean;
      kind?: string;
      pages?: number;
      extracted?: boolean;
      bytes?: number;
    };
    expect(json.bytes).toBe(fixture.size);
    expect(json.extracted).toBe(true);
    expect(json.staged).toBe(true);
    expect(json.kind).toBe("notice");
    expect(json.pages).toBe(1);
    if (json.key) uploaded.push(json.key);

    const text = stageCalls[0]?.docs[0]?.text ?? "";
    expect(text.startsWith("[Page 1]")).toBe(true);
    expect(text).toContain(marker);
    expect(auditCalls[0]?.body.pages).toBe(1);
    expect(auditCalls[0]?.body.contentType).toBe("application/pdf");
  }, 30_000);

  test("extracts DOCX text and stages it as a bid", async () => {
    const marker = `NORTHWIND CLINICAL ${Date.now()}`;
    const fixture = await docx(`BIDDER RESPONSE\n${marker}\nUnit price: KES 185,000`);
    const res = await post(fixture);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      key?: string;
      staged?: boolean;
      kind?: string;
      chars?: number;
      bytes?: number;
    };
    expect(json.bytes).toBe(fixture.size);
    expect(json.staged).toBe(true);
    expect(json.kind).toBe("bid");
    expect(json.chars).toBeGreaterThan(20);
    if (json.key) uploaded.push(json.key);

    const call = stageCalls[0];
    expect(call.docs[0].kind).toBe("bid");
    expect(call.docs[0].text).toContain(marker);
    expect(call.actor).toBe(OFFICER.name);
    expect(auditCalls[0]?.body.filename).toBe("bidder-northwind.docx");
    expect(auditCalls[0]?.body.extracted).toBe(true);
  }, 30_000);

  test("extracts every XLSX worksheet and stages it as a bid", async () => {
    const fixture = await xlsx();
    const res = await post(fixture);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      key?: string;
      staged?: boolean;
      kind?: string;
      sheets?: string[];
      bytes?: number;
    };
    expect(json.bytes).toBe(fixture.size);
    expect(json.staged).toBe(true);
    expect(json.kind).toBe("bid");
    expect(json.sheets).toEqual(["Pricing"]);
    if (json.key) uploaded.push(json.key);

    const text = stageCalls[0]?.docs[0]?.text ?? "";
    expect(text).toContain("# Sheet: Pricing");
    expect(text).toContain("Infusion pump");
    expect(text).toContain("185000");
    expect(auditCalls[0]?.body.sheets).toEqual(["Pricing"]);
  }, 30_000);

  test("stores a scanned PDF but says it was not staged", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const res = await post(fileOf(await doc.save(), "scan-notice.pdf", "application/pdf"));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      key?: string;
      staged?: boolean;
      extracted?: boolean;
      reason?: string;
      audited?: boolean;
    };
    expect(json.extracted).toBe(false);
    expect(json.staged).toBe(false);
    expect(json.reason ?? "").toContain("OCR");
    expect(json.audited).toBe(true);
    if (json.key) uploaded.push(json.key);
    expect(stageCalls.length).toBe(0);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].body.staged).toBe(false);
    expect(auditCalls[0].body.extracted).toBe(false);
    expect(auditCalls[0].body.reason).toContain("OCR");
  }, 30_000);

  test("keeps the file stored when the sidecar refuses the stage", async () => {
    stageStatus = 503;
    const res = await post(new File(["NOTICE OF TENDER\nsidecar down"], "notice.txt", { type: "text/plain" }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      key?: string;
      staged?: boolean;
      reason?: string;
      audited?: boolean;
    };
    expect(json.staged).toBe(false);
    expect(json.reason).toBe("sidecar refused the stage");
    expect(json.audited).toBe(true);
    if (json.key) uploaded.push(json.key);
    expect(auditCalls[0].body.staged).toBe(false);
    expect(auditCalls[0].body.reason).toBe("sidecar refused the stage");
  }, 30_000);

  test("reports an audit failure without undoing the stored object", async () => {
    auditStatus = 503;
    const res = await post(new File(["NOTICE OF TENDER\naudit down"], "notice.txt", { type: "text/plain" }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      key?: string;
      staged?: boolean;
      audited?: boolean;
      auditReason?: string;
    };
    expect(json.staged).toBe(true);
    expect(json.audited).toBe(false);
    expect(json.auditReason).toBe("audit refused");
    if (json.key) uploaded.push(json.key);
  }, 30_000);
});

suite("stored tender document browser", () => {
  test("lists every object under the tender and filters foreign keys", async () => {
    const stamp = Date.now();
    const a = `tenders/${REF}/${stamp}-browse-a.txt`;
    const b = `tenders/${REF}/${stamp}-browse-b.txt`;
    const foreign = `tenders/OTHER-TENDER/${stamp}-hidden.txt`;
    await putObject(a, "alpha");
    await putObject(b, "beta!");
    await putObject(foreign, "hidden");

    const res = await listFor();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = (await res.json()) as {
      tender?: string;
      count?: number;
      totalBytes?: number;
      truncated?: boolean;
      objects?: Array<{
        key?: string;
        filename?: string;
        bytes?: number;
        contentType?: string;
        uploaded?: string;
        etag?: string;
      }>;
    };
    const keys = (json.objects ?? []).map((object) => object.key);
    expect(json.tender).toBe(REF);
    expect(keys).toContain(a);
    expect(keys).toContain(b);
    expect(keys).not.toContain(foreign);
    expect(json.count).toBe(keys.length);
    expect(json.totalBytes).toBeGreaterThanOrEqual(10);
    expect(json.truncated).toBe(false);

    const entry = (json.objects ?? []).find((object) => object.key === a);
    expect(entry).toMatchObject({ filename: "browse-a.txt", bytes: 5, contentType: "text/plain" });
    expect(entry?.uploaded).toBeTruthy();
    expect(entry?.etag).toBeTruthy();
  }, 30_000);

  test("an operator removes one object and the listing reflects it", async () => {
    const key = `tenders/${REF}/${Date.now()}-delete-me.txt`;
    await putObject(key, "delete me");

    const before = (await (await listFor()).json()) as { objects?: Array<{ key?: string }> };
    expect((before.objects ?? []).map((object) => object.key)).toContain(key);

    const res = await deleteFor(key);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; audited?: boolean; key?: string };
    expect(json).toMatchObject({ ok: true, key, audited: true });

    const after = (await (await listFor()).json()) as { objects?: Array<{ key?: string }> };
    expect((after.objects ?? []).map((object) => object.key)).not.toContain(key);
  }, 30_000);
});

suite("signed tender downloads", () => {
  test("mints a user-bound link and streams the exact object as an attachment", async () => {
    const key = `tenders/${REF}/${Date.now()}-download-test.txt`;
    const body = `signed download ${Date.now()}`;
    await putObject(key, body);

    const linkRes = await linkFor(key);
    expect(linkRes.status).toBe(200);
    const link = (await linkRes.json()) as {
      url?: string;
      filename?: string;
      expiresInSec?: number;
    };
    expect(link.url).toMatch(new RegExp(`^/api/tenders/${REF}/docs/download\\?`));
    expect(link.url).toContain(`sub=${OFFICER.id}`);
    expect(link.filename).toBe("download-test.txt");
    expect(link.expiresInSec).toBe(300);

    const res = await downloadFor(link.url ?? "");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/plain");
    expect(res.headers.get("content-disposition") ?? "").toContain("download-test.txt");
    expect(await res.text()).toBe(body);

    /* The delivery is in the hash-chained spine, bound to the same user. */
    expect(downloadAuditCalls).toHaveLength(1);
    expect(downloadAuditCalls[0].actor).toBe(OFFICER.name);
    expect(downloadAuditCalls[0].body).toMatchObject({
      tenderId: REF,
      key,
      filename: "download-test.txt",
      userId: OFFICER.id,
      role: "OFFICER",
      bytes: body.length,
      partial: false,
    });
    expect(downloadAuditCalls[0].body.range).toBeUndefined();
    expect(downloadAuditCalls[0].body.linkExpiresAt).toBeGreaterThan(Date.now() - 1_000);
    expect(res.headers.get("x-quorum-audit")).toBe("recorded");
    expect(res.headers.get("x-quorum-audit-seq")).toBe("501");
    expect(res.headers.get("x-quorum-audit-id")).toBe("tl_test_download");
    expect(res.headers.get("x-quorum-audit-self")).toBe("d1e2f3a4b5c6d7e8");
  }, 30_000);

  test("serves a single byte range as 206 with Content-Range", async () => {
    const key = `tenders/${REF}/${Date.now()}-range-test.txt`;
    const body = "0123456789abcdefghij";
    await putObject(key, body);

    const linkRes = await linkFor(key);
    const link = (await linkRes.json()) as { url?: string };

    const res = await downloadFor(link.url ?? "", REF, { range: "bytes=5-9" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 5-9/${body.length}`);
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-disposition") ?? "").toContain("range-test.txt");
    expect(res.headers.get("cache-control")).toContain("private, no-store");
    expect(await res.text()).toBe("56789");

    /* A partial delivery records the exact slice, not a full download. */
    expect(downloadAuditCalls).toHaveLength(1);
    expect(downloadAuditCalls[0].body).toMatchObject({
      key,
      userId: OFFICER.id,
      bytes: 5,
      range: "bytes=5-9",
      partial: true,
      contentRange: `bytes 5-9/${body.length}`,
    });
    expect(res.headers.get("x-quorum-audit")).toBe("recorded");
  }, 30_000);

  test("answers an unsatisfiable range with 416 and the object size", async () => {
    const key = `tenders/${REF}/${Date.now()}-range-416.txt`;
    const body = "short";
    await putObject(key, body);

    const linkRes = await linkFor(key);
    const link = (await linkRes.json()) as { url?: string };

    const res = await downloadFor(link.url ?? "", REF, { range: "bytes=99-100" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${body.length}`);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("byte range");
    /* Nothing was delivered, so nothing is claimed in the audit trail. */
    expect(downloadAuditCalls).toHaveLength(0);

    const full = await downloadFor(link.url ?? "");
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(await full.text()).toBe(body);
    expect(downloadAuditCalls).toHaveLength(1);
    expect(downloadAuditCalls[0].body.partial).toBe(false);
  }, 30_000);

  test("a failed audit append still serves the document and says so", async () => {
    downloadAuditStatus = 503;
    const key = `tenders/${REF}/${Date.now()}-audit-down.txt`;
    const body = "audit trail unavailable, document delivered";
    await putObject(key, body);

    const linkRes = await linkFor(key);
    const link = (await linkRes.json()) as { url?: string };

    const res = await downloadFor(link.url ?? "");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(downloadAuditCalls).toHaveLength(1);
    expect(res.headers.get("x-quorum-audit")).toBe("unavailable");
    expect(res.headers.get("x-quorum-audit-seq")).toBeNull();
  }, 30_000);

  test("refuses a tampered signature", async () => {
    const key = `tenders/${REF}/${Date.now()}-tamper-test.txt`;
    const linkRes = await linkFor(key);
    const link = (await linkRes.json()) as { url?: string };
    const url = new URL(link.url ?? "", "http://localhost");
    url.searchParams.set("sig", "0".repeat(64));
    const res = await downloadFor(url.pathname + url.search);
    expect(res.status).toBe(403);
  }, 30_000);

  test("refuses an expired signed link", async () => {
    const key = `tenders/${REF}/${Date.now()}-expired-test.txt`;
    const expiresAt = Date.now() - 1;
    const sig = signTenderDownload(REF, key, expiresAt, OFFICER.id);
    const url = `/api/tenders/${REF}/docs/download?${new URLSearchParams({
      key,
      exp: String(expiresAt),
      sub: OFFICER.id,
      sig,
    })}`;
    const res = await downloadFor(url);
    expect(res.status).toBe(410);
  }, 30_000);

  test("a link minted for one account cannot be redeemed by another", async () => {
    const key = `tenders/${REF}/${Date.now()}-bound-test.txt`;
    const linkRes = await linkFor(key);
    const link = (await linkRes.json()) as { url?: string };
    currentUser = { ...OFFICER, id: "u_other_officer" };
    const res = await downloadFor(link.url ?? "");
    expect(res.status).toBe(403);
  }, 30_000);

  test("requires a session for both minting and downloading", async () => {
    currentUser = null;
    const key = `tenders/${REF}/${Date.now()}-auth-test.txt`;
    const link = await linkFor(key);
    expect(link.status).toBe(401);
    const download = await downloadFor(
      `/api/tenders/${REF}/docs/download?key=${encodeURIComponent(key)}`,
    );
    expect(download.status).toBe(401);
  }, 30_000);

  test("refuses a key outside the tender's prefix or a missing key", async () => {
    expect((await linkFor(`tenders/OTHER/${Date.now()}-x.txt`)).status).toBe(422);
    expect((await linkFor("")).status).toBe(422);
    expect((await linkFor(`tenders/${REF}/../secret.txt`)).status).toBe(422);
  }, 30_000);
});

/* The live suite needs the deployed Worker. These two exercise the route's
   range forwarding itself with a stubbed edge, so they always run. */
describe("download route range forwarding (stubbed gate)", () => {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.QUORUM_EDGE_URL;
  const realSecret = process.env.QUORUM_EDGE_SECRET;

  beforeEach(() => {
    currentUser = OFFICER;
    process.env.QUORUM_EDGE_URL = "https://edge.test";
    process.env.QUORUM_EDGE_SECRET = "test-edge-secret";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.QUORUM_EDGE_URL;
    else process.env.QUORUM_EDGE_URL = realUrl;
    if (realSecret === undefined) delete process.env.QUORUM_EDGE_SECRET;
    else process.env.QUORUM_EDGE_SECRET = realSecret;
  });

  function signedUrl(key: string): string {
    const expiresAt = Date.now() + 240_000;
    const sig = signTenderDownload(REF, key, expiresAt, OFFICER.id);
    return `/api/tenders/${REF}/docs/download?${new URLSearchParams({
      key,
      exp: String(expiresAt),
      sub: OFFICER.id,
      sig,
    })}`;
  }

  test("forwards Range and If-Range and streams the 206 with Content-Range", async () => {
    const key = `tenders/${REF}/${Date.now()}-stub-range.txt`;
    let sent: Headers | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return new Response("56789", {
        status: 206,
        headers: {
          "content-type": "text/plain",
          "content-range": "bytes 5-9/20",
          "content-length": "5",
          etag: '"stub-etag"',
        },
      });
    }) as typeof fetch;

    const res = await downloadFor(signedUrl(key), REF, {
      range: "bytes=5-9",
      "if-range": '"stub-etag"',
    });

    expect(res.status).toBe(206);
    expect(sent!.get("range")).toBe("bytes=5-9");
    expect(sent!.get("if-range")).toBe('"stub-etag"');
    expect(sent!.get("x-quorum-edge-key")).toBe("test-edge-secret");
    expect(res.headers.get("content-range")).toBe("bytes 5-9/20");
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("etag")).toBe('"stub-etag"');
    expect(res.headers.get("content-disposition") ?? "").toContain("stub-range.txt");
    expect(await res.text()).toBe("56789");
  }, 30_000);

  test("lists stored objects and drops a key outside the tender prefix", async () => {
    let sent: Headers | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      const url = new URL(String(input));
      expect(url.pathname).toBe("/__edge/list");
      expect(url.searchParams.get("prefix")).toBe(`tenders/${REF}/`);
      return Response.json({
        objects: [
          {
            key: `tenders/${REF}/1793216253256-notice.pdf`,
            size: 2048,
            contentType: "application/pdf",
            uploaded: "2026-10-27T12:00:00.000Z",
            etag: '"abc"',
          },
          { key: "tenders/OTHER-TENDER/secret.pdf", size: 2, contentType: "application/pdf" },
          { key: `tenders/${REF}/../escape.pdf`, size: 3 },
        ],
        truncated: false,
      });
    }) as typeof fetch;

    const res = await listFor();
    expect(res.status).toBe(200);
    expect(sent!.get("x-quorum-edge-key")).toBe("test-edge-secret");
    const json = (await res.json()) as {
      tender?: string;
      count?: number;
      totalBytes?: number;
      objects?: Array<Record<string, unknown>>;
    };
    expect(json).toMatchObject({ tender: REF, count: 1, totalBytes: 2048, truncated: false });
    expect(json.objects?.[0]).toMatchObject({
      key: `tenders/${REF}/1793216253256-notice.pdf`,
      filename: "notice.pdf",
      bytes: 2048,
      contentType: "application/pdf",
      uploaded: "2026-10-27T12:00:00.000Z",
      etag: '"abc"',
    });
  }, 30_000);

  test("removes a stored object through the gate and records the deletion", async () => {
    const key = `tenders/${REF}/1793216253256-notice.pdf`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/__edge/delete");
      expect(url.searchParams.get("key")).toBe(key);
      expect(init?.method).toBe("DELETE");
      expect(new Headers(init?.headers).get("x-quorum-edge-key")).toBe("test-edge-secret");
      return Response.json({ ok: true, key });
    }) as typeof fetch;

    const res = await deleteFor(key);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok?: boolean;
      key?: string;
      filename?: string;
      audited?: boolean;
      audit?: { seq?: number; id?: string; self?: string };
    };
    expect(json).toMatchObject({
      ok: true,
      key,
      filename: "notice.pdf",
      audited: true,
      audit: { seq: 601, id: "tl_test_delete", self: "f1e2d3c4b5a69788" },
    });
    expect(deletionAuditCalls).toHaveLength(1);
    expect(deletionAuditCalls[0].actor).toBe(OFFICER.name);
    expect(deletionAuditCalls[0].body).toMatchObject({
      tenderId: REF,
      key,
      filename: "notice.pdf",
      userId: OFFICER.id,
      role: "OFFICER",
    });
  }, 30_000);

  test("only operator roles may delete stored documents", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    currentUser = { ...OFFICER, role: "AUDITOR" };

    const res = await deleteFor(`tenders/${REF}/1793216253256-notice.pdf`);
    expect(res.status).toBe(403);
    expect(called).toBe(false);
    expect(deletionAuditCalls).toHaveLength(0);
  }, 30_000);

  test("passes a 416 through with the total object size", async () => {
    const key = `tenders/${REF}/${Date.now()}-stub-416.txt`;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "range not satisfiable", size: 20 }), {
        status: 416,
        headers: { "content-type": "application/json", "content-range": "bytes */20" },
      })) as unknown as typeof fetch;

    const res = await downloadFor(signedUrl(key), REF, { range: "bytes=99-100" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */20");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("byte range");
  }, 30_000);
});
