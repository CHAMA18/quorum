/**
 * generate-frames.ts — render the Quorum demo-film frames with Muse Image (Meta Model API).
 *
 * Meta Global AI Developer Hackathon 2026 edition.
 *
 * Usage:
 *   META_API_KEY=<your-token> bun run generate-frames.ts [--force] [--only 1,3]
 *
 * Environment:
 *   META_API_KEY    (required) your Meta Model API token from the Meta developer console
 *   META_IMAGE_URL  image-generation endpoint. Defaults to
 *                   "${META_BASE_URL:-https://dev.meta.ai}/v1/images/generations" —
 *                   set it to the exact endpoint printed in your console/docs.
 *   META_IMAGE_MODEL image model id, default "muse-image" — change to the id your
 *                   console issues.
 *   FRAMES_DIR      output directory, default "./frames"
 *
 * The API request/response shape is isolated in `callImageApi()` below. If the
 * Meta Model API image endpoint differs from the generic OpenAI-compatible
 * /images/generations shape, adapt that one function — nothing else changes.
 * Check the current shape in the Meta Model API docs before the first run:
 * https://dev.meta.ai (Documentation → Model API).
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PromptsFile = {
  meta: { frames_per_chapter: number; size: string };
  style_suffix: string;
  chapters: { id: number; title: string; frames: string[] }[];
};

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1]!.split(",").map(Number) : null;

const API_KEY = process.env.META_API_KEY;
if (!API_KEY) {
  console.error(
    "❌ META_API_KEY is required. Get it from your Meta developer console (dev.meta.ai).",
  );
  process.exit(1);
}

const ENDPOINT =
  process.env.META_IMAGE_URL ??
  `${process.env.META_BASE_URL ?? "https://dev.meta.ai"}/v1/images/generations`;
const MODEL = process.env.META_IMAGE_MODEL ?? "muse-image";
const FRAMES_DIR = process.env.FRAMES_DIR ?? "./frames";

const prompts: PromptsFile = JSON.parse(await Bun.file("prompts.json").text());
const SIZE = prompts.meta.size;

/** The single function to adapt if Meta's image endpoint differs from this shape. */
async function callImageApi(prompt: string): Promise<Buffer> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, n: 1 }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const item = json.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    const img = await fetch(item.url);
    if (!img.ok) throw new Error(`frame download failed: HTTP ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error("response contained neither b64_json nor url — adapt callImageApi()");
}

let done = 0,
  skipped = 0,
  failed = 0;

for (const chapter of prompts.chapters) {
  if (only && !only.includes(chapter.id)) continue;
  const dir = join(FRAMES_DIR, `chapter-${chapter.id}`);
  mkdirSync(dir, { recursive: true });

  console.log(`\n🎬 Chapter ${chapter.id} — ${chapter.title}`);
  for (let i = 0; i < chapter.frames.length; i++) {
    const out = join(dir, `frame-${String(i + 1).padStart(2, "0")}.png`);
    if (!FORCE && existsSync(out)) {
      skipped++;
      continue;
    }
    const prompt = `${chapter.frames[i]} — ${prompts.style_suffix}`;
    try {
      const img = await callImageApi(prompt);
      writeFileSync(out, img);
      done++;
      console.log(`  ✅ frame ${i + 1}/${chapter.frames.length} → ${out}`);
    } catch (err) {
      failed++;
      console.error(`  ❌ frame ${i + 1}/${chapter.frames.length}: ${err}`);
    }
    await new Promise((r) => setTimeout(r, 1000)); // gentle rate limit
  }
}

console.log(`\n📊 Frames generated: ${done} · skipped (already exist): ${skipped} · failed: ${failed}`);
console.log("Next: ./assemble-film.sh  →  writes public/film/chapter-{1..5}.mp4");
if (failed > 0) process.exit(2);
