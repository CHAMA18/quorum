/**
 * SAM 3.1 — locate a region on a scanned tender page.
 *
 * Meta's Segment Anything Model 3.1 answers a short noun phrase with boxes and
 * pixel masks. Quorum uses it for one narrow job: on a page whose text could
 * not be extracted (a scan, or an image upload), locate the table region so a
 * human can inspect the price schedule without hunting through the scan.
 *
 * What this module does NOT do — and the UI must not imply:
 *   · it does not read text, numbers or signatures;
 *   · it does not authenticate a signer or certify a document;
 *   · a located box is a pointer for a human, not a finding.
 *
 * The call is opt-in (`SAM_ENABLED=true`) because the page image leaves the
 * deployment. When the model is off, unreachable, or returns no match, the
 * upload still succeeds and is marked `humanReviewRequired` — the same
 * fail-closed contract as the rest of the desk.
 *
 * Wire format (Meta Model API, verified 2026-10-31):
 *   POST /v1/responses  { model: "sam-3.1", input: [...], stream: true }
 *   → SSE `response.output_text.delta` / `response.output_text.done`
 *   → `<0f>0<|box;x1=…;y1=…;x2=…;y2=…;w=…;h=…|><|mask;…|>,…`
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Source image dimensions, repeated by the model on every record. */
  width: number;
  height: number;
  confidence?: number;
}

export interface SamRegion {
  prompt: string;
  boxes: SamBox[];
  /** True when the model returned at least one box. */
  matched: boolean;
}

export interface SamResult {
  ok: boolean;
  model: string;
  /** The prompt(s) sent; one region per prompt. */
  regions: SamRegion[];
  /** Total boxes across prompts. */
  matches: number;
  /** Page rendered for a PDF (1-based); undefined for an image upload. */
  page?: number;
  /** The image actually sent, for the audit trail (dimensions, not bytes). */
  image?: { bytes: number; mime: string };
  latencyMs: number;
  /** Present when `ok` is false. */
  error?: string;
}

export interface SamOptions {
  prompts?: string[];
  /** Default 150 dpi for PDF page rendering. */
  dpi?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_PROMPT = "table";
const DEFAULT_MODEL = "sam-3.1";

export function samEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SAM_ENABLED?.trim().toLowerCase() === "true";
}

function samConfig(env: Record<string, string | undefined> = process.env): {
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  const apiKey = env.SAM_API_KEY?.trim() || env.MUSE_API_KEY?.trim() || env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (env.SAM_BASE_URL?.trim() || env.MUSE_BASE_URL?.trim() || env.LLM_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/+$/, "");
  const model = env.SAM_MODEL?.trim() || DEFAULT_MODEL;
  return { baseUrl, apiKey, model };
}

function mimeFor(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

/**
 * Turn an uploaded PDF or image into one PNG page for segmentation. A PDF is
 * rendered with Poppler (`pdftoppm`), the same dependency the OCR fallback
 * already uses; when it is missing the caller gets a clear note, not a crash.
 */
export async function pageForVision(
  bytes: Uint8Array,
  filename: string,
  options: { dpi?: number; timeoutMs?: number } = {},
): Promise<{ bytes: Uint8Array; mime: string; page?: number } | { error: string }> {
  const direct = mimeFor(filename);
  if (direct) return { bytes, mime: direct };

  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext !== "pdf") return { error: `SAM can inspect PDF or image pages; .${ext || "?"} is not one.` };

  const workDir = await mkdtemp(join(tmpdir(), "quorum-sam-"));
  try {
    const pdfPath = join(workDir, "page.pdf");
    await writeFile(pdfPath, bytes);
    const prefix = join(workDir, "page");
    await execFileAsync(
      "pdftoppm",
      ["-f", "1", "-l", "1", "-r", String(options.dpi ?? 150), "-png", pdfPath, prefix],
      { timeout: options.timeoutMs ?? 60_000, maxBuffer: 1024 * 1024 },
    );
    /* Poppler pads the page number to the document's digit width (page-1.png,
       page-01.png, page-001.png). Read whichever one it wrote rather than
       guessing and mis-reporting a missing binary. */
    const pngName = (await readdir(workDir)).filter((n) => n.endsWith(".png")).sort()[0];
    if (!pngName) return { error: "SAM could not render the PDF page (Poppler wrote no image)." };
    const png = await readFile(join(workDir, pngName));
    return { bytes: new Uint8Array(png), mime: "image/png", page: 1 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { error: "SAM needs pdftoppm (Poppler) to render a PDF page on this server." };
    }
    return { error: `SAM could not render the PDF page (${(error as Error).message.slice(0, 160)}).` };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const BOX_RE =
  /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([0-9.]+))?\|>/g;

/** Parse the special-token text into boxes. Exported for tests. */
export function parseSamBoxes(text: string): SamBox[] {
  const boxes: SamBox[] = [];
  for (const match of text.matchAll(BOX_RE)) {
    boxes.push({
      x1: Number(match[1]),
      y1: Number(match[2]),
      x2: Number(match[3]),
      y2: Number(match[4]),
      width: Number(match[5]),
      height: Number(match[6]),
      ...(match[7] ? { confidence: Number(match[7]) } : {}),
    });
  }
  return boxes;
}

/** One prompt → one Responses call → boxes. */
async function segmentOnce(
  prompt: string,
  image: { bytes: Uint8Array; mime: string },
  cfg: { baseUrl: string; apiKey: string; model: string },
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<SamRegion> {
  const b64 = Buffer.from(image.bytes).toString("base64");
  const body = {
    model: cfg.model,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:${image.mime};base64,${b64}` },
        ],
      },
    ],
    stream: true,
    metadata: { mask_encoding: "one_bit" },
  };

  const res = await fetchImpl(`${cfg.baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`SAM returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  let text = "";
  const reader = res.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let event: {
          type?: string;
          delta?: string;
          text?: string;
          response?: { output?: { content?: { text?: string }[] }[] };
        };
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        } else if (event.type === "response.output_text.done" && typeof event.text === "string") {
          if (event.text.length > text.length) text = event.text;
        } else if (event.type === "response.completed") {
          const finalText = event.response?.output?.[0]?.content?.[0]?.text;
          if (typeof finalText === "string" && finalText.length > text.length) text = finalText;
        }
      }
    }
  } else {
    const payload = (await res.json().catch(() => null)) as { output?: { content?: { text?: string }[] }[] } | null;
    text = payload?.output?.[0]?.content?.[0]?.text ?? "";
  }

  const boxes = parseSamBoxes(text);
  return { prompt, boxes, matched: boxes.length > 0 };
}

/**
 * Segment one scanned page. Returns `ok: false` with a human-readable reason
 * when SAM is off, unconfigured or unreachable; never throws into the upload.
 */
export async function segmentTenderScan(
  bytes: Uint8Array,
  filename: string,
  options: SamOptions = {},
): Promise<SamResult> {
  const startedAt = Date.now();
  const cfg = samConfig();
  const model = cfg?.model ?? DEFAULT_MODEL;
  const base: SamResult = { ok: false, model, regions: [], matches: 0, latencyMs: 0 };

  if (!samEnabled()) return { ...base, error: "SAM is not enabled on this deployment (SAM_ENABLED is not true)." };
  if (!cfg) return { ...base, error: "SAM is enabled but no Meta API key is configured." };

  const page = await pageForVision(bytes, filename, { dpi: options.dpi, timeoutMs: options.timeoutMs });
  if ("error" in page) return { ...base, error: page.error };

  const prompts = (options.prompts?.length ? options.prompts : [process.env.SAM_PROMPT?.trim() || DEFAULT_PROMPT])
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);

  try {
    const regions = await Promise.all(
      prompts.map((prompt) =>
        segmentOnce(prompt, page, cfg, options.timeoutMs ?? 120_000, options.fetchImpl ?? fetch),
      ),
    );
    const matches = regions.reduce((sum, region) => sum + region.boxes.length, 0);
    return {
      ok: true,
      model: cfg.model,
      regions,
      matches,
      ...(page.page ? { page: page.page } : {}),
      image: { bytes: page.bytes.byteLength, mime: page.mime },
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ...base,
      ...(page.page ? { page: page.page } : {}),
      latencyMs: Date.now() - startedAt,
      error: (error as Error).message.slice(0, 300),
    };
  }
}
