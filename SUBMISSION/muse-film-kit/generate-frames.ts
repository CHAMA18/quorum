/**
 * Generate the Quorum landing-film stills with Meta Muse Image.
 *
 * Chapter 1 / frame 1 establishes the lead officer. Every later frame uses
 * that image as a visual reference through Meta's image-edit endpoint.
 *
 * Usage from this directory:
 *   bun run generate-frames.ts [--force] [--only 1,3] [--limit 1] [--frame 8]
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Buffer } from "node:buffer";

type PromptsFile = {
  meta: { frames_per_chapter: number; size: string; model?: string };
  style_suffix: string;
  continuity_suffix: string;
  chapters: { id: number; title: string; frames: string[] }[];
};

function parseEnvFile(path: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          const key = line.slice(0, index).trim();
          let value = line.slice(index + 1).trim();
          if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
          }
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const onlyArg = argValue("--only");
const only = onlyArg ? onlyArg.split(",").map(Number) : null;
const frameArg = argValue("--frame");
const selectedFrame = frameArg === undefined ? null : Number(frameArg);
const limitArg = argValue("--limit");
const limit = limitArg === undefined ? Number.POSITIVE_INFINITY : Number(limitArg);

if (only?.some((id) => !Number.isInteger(id) || id < 1)) {
  throw new Error("--only expects a comma-separated list of positive chapter numbers.");
}
if (Number.isNaN(limit) || limit < 1) {
  throw new Error("--limit must be a positive number of frames per selected chapter.");
}
if (selectedFrame !== null && (!Number.isInteger(selectedFrame) || selectedFrame < 1)) {
  throw new Error("--frame expects one positive frame number.");
}

const envPath = resolve(process.env.META_ENV_FILE ?? "../../.env.local");
const envFile = parseEnvFile(envPath);
const API_KEY =
  process.env.MODEL_API_KEY ??
  process.env.MUSE_API_KEY ??
  process.env.META_API_KEY ??
  envFile.MODEL_API_KEY ??
  envFile.MUSE_API_KEY ??
  envFile.META_API_KEY;

if (!API_KEY) {
  console.error(`Meta Model API key missing. Set MUSE_API_KEY or MODEL_API_KEY, or check ${envPath}.`);
  process.exit(1);
}

const configuredBase = (process.env.MUSE_BASE_URL ?? envFile.MUSE_BASE_URL ?? "https://api.meta.ai/v1").replace(/\/+$/, "");
const API_ROOT = configuredBase.endsWith("/v1") ? configuredBase : `${configuredBase}/v1`;
const GENERATE_ENDPOINT = process.env.META_IMAGE_URL ?? `${API_ROOT}/images/generations`;
const EDIT_ENDPOINT = process.env.META_IMAGE_EDIT_URL ?? `${API_ROOT}/images/edits`;
const MODEL = process.env.META_IMAGE_MODEL ?? "muse-image-1.0";
const FRAMES_DIR = resolve(process.env.FRAMES_DIR ?? "./frames");
const prompts: PromptsFile = JSON.parse(await Bun.file("prompts.json").text());
const SIZE = prompts.meta.size;
const chapters = prompts.chapters;
const characterAnchor = join(FRAMES_DIR, "chapter-1", "frame-01.jpg");

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/HTTP (\d{3})/);
  if (status) {
    const code = Number(status[1]);
    return code === 408 || code === 429 || code >= 500;
  }
  return /socket|connect|dns|ENOTFOUND|timed out|fetch failed|connection|network/i.test(message);
}

async function requestWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  const attempts = 4;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts || !isRetryable(error)) throw error;
      console.warn(`  Meta image connection interrupted; retry ${attempt}/${attempts - 1}.`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500 * 2 ** (attempt - 1)));
    }
  }
  throw new Error("Meta image request exhausted its retry limit.");
}

async function extractImage(response: Response): Promise<Buffer> {
  if (!response.ok) {
    let message = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? "";
    } catch {
      // Keep provider response bodies out of logs.
    }
    throw new Error(`Meta Muse Image returned HTTP ${response.status}${message ? `: ${message}` : "."}`);
  }

  const json = (await response.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = json.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(120_000) });
    if (!imageResponse.ok) throw new Error(`Muse Image output download returned HTTP ${imageResponse.status}.`);
    return Buffer.from(await imageResponse.arrayBuffer());
  }
  throw new Error("Muse Image returned no image bytes.");
}

function assertJpeg(image: Buffer): void {
  if (
    image.length < 4 ||
    image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff ||
    image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9
  ) {
    throw new Error("Muse Image output was not a complete JPEG; refusing to save a damaged frame.");
  }
}

async function generate(prompt: string): Promise<Buffer> {
  return requestWithRetry(async () => {
    const response = await fetch(GENERATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        size: SIZE,
        n: 1,
        response_format: "b64_json",
        output_format: "jpeg",
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const image = await extractImage(response);
    assertJpeg(image);
    return image;
  });
}

async function edit(prompt: string, referencePath: string): Promise<Buffer> {
  return requestWithRetry(async () => {
    const form = new FormData();
    form.set("model", MODEL);
    form.set("prompt", prompt);
    form.set("size", SIZE);
    form.set("n", "1");
    form.set("response_format", "b64_json");
    form.set("output_format", "jpeg");
    form.set(
      "image",
      new Blob([await Bun.file(referencePath).arrayBuffer()], { type: "image/jpeg" }),
      "lead-officer-reference.jpg",
    );
    const response = await fetch(EDIT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const image = await extractImage(response);
    assertJpeg(image);
    return image;
  });
}

async function createFrame(chapterId: number, frameIndex: number, outputPath: string): Promise<void> {
  const chapter = chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error(`Unknown chapter ${chapterId}.`);
  const basePrompt = `${chapter.frames[frameIndex]} ${prompts.style_suffix}`;
  const image = chapterId === 1 && frameIndex === 0
    ? await generate(basePrompt)
    : await edit(`${basePrompt} ${prompts.continuity_suffix}`, characterAnchor);
  const tempPath = `${outputPath}.tmp`;
  try {
    writeFileSync(tempPath, image);
    renameSync(tempPath, outputPath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

let done = 0;
let skipped = 0;
let failed = 0;

// The shared character reference is a prerequisite even for --only chapters 2–5.
if ((FORCE || !existsSync(characterAnchor)) && only && !only.includes(1)) {
  mkdirSync(join(FRAMES_DIR, "chapter-1"), { recursive: true });
  console.log("\nMuse Image — creating the shared character reference");
  try {
    await createFrame(1, 0, characterAnchor);
    done++;
  } catch (error) {
    console.error(`Character reference failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

for (const chapter of chapters) {
  if (only && !only.includes(chapter.id)) continue;
  const dir = join(FRAMES_DIR, `chapter-${chapter.id}`);
  mkdirSync(dir, { recursive: true });
  console.log(`\nMuse Image — chapter ${chapter.id}: ${chapter.title}`);

  for (let index = 0; index < Math.min(chapter.frames.length, limit); index++) {
    if (selectedFrame !== null && index !== selectedFrame - 1) continue;
    const outputPath = join(dir, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
    if (!FORCE && existsSync(outputPath) && selectedFrame !== index + 1) {
      skipped++;
      continue;
    }
    if (!(chapter.id === 1 && index === 0) && !existsSync(characterAnchor)) {
      failed++;
      console.error("  Character anchor is missing; generate chapter 1 frame 1 first.");
      break;
    }
    try {
      await createFrame(chapter.id, index, outputPath);
      done++;
      console.log(`  frame ${index + 1}/${chapter.frames.length} saved (${(await Bun.file(outputPath).size).toLocaleString()} bytes)`);
    } catch (error) {
      failed++;
      console.error(`  frame ${index + 1}/${chapter.frames.length} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 900));
  }
}

console.log(`\nMuse Image frames generated: ${done}; skipped: ${skipped}; failed: ${failed}.`);
if (failed > 0) process.exit(2);
console.log("Next: run ./assemble-film.sh to render the landing-page chapter clips.");
