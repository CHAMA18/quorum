/**
 * REEL 01 — "The Twenty-Minute Tender" (film chapter generator).
 *
 * Generates the six chapter clips for the landing-page film via the
 * z-ai-web-dev-sdk video model (async task → poll → download → public/film/).
 *
 * The video API allows ONE in-flight generation task, so this runs as a
 * resumable sequential queue: state lives in scripts/film-status.json,
 * 429s back off and retry, finished chapters are skipped on re-run.
 *
 * Run: bun scripts/generate-film.ts   (logs to scripts/film-gen.log)
 */

import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import ZAI from "z-ai-web-dev-sdk";

/* ── Shared art direction — the Quorum film DNA ───────────────────────────── */
const STYLE =
  "Cinematic documentary footage, ultra high definition. Deep ink-black shadows, " +
  "warm paper-white highlights, exactly one signal-red accent colour. Volumetric " +
  "light, 35mm film grain, shallow depth of field, slow deliberate dolly camera. " +
  "Photoreal materials. No text, no words, no letters, no numbers, no logos, no faces.";

interface Chapter {
  id: number;
  prompt: string;
}

const CHAPTERS: Chapter[] = [
  {
    id: 1,
    prompt:
      "A vast government records archive at night: endless towering stacks of paper tender " +
      "documents rising beyond the frame, a single hard shaft of light from a high window " +
      "cutting through drifting dust motes, one red dossier glowing faintly deep in the stacks.",
  },
  {
    id: 2,
    prompt:
      "Before dawn in a dark procurement office: a scanner light bar sweeps across a glass bed " +
      "reading a printed tender page, pages lifting and drifting weightlessly through the air, " +
      "cold monitor glow with one small red cursor light pulsing in the background.",
  },
  {
    id: 3,
    prompt:
      "Extreme macro shot of a printed contract page on a dark desk: a thin signal-red thread " +
      "stitches from one highlighted line, across the paper, to pinned source documents " +
      "surrounding it; red thread lines multiply and tighten like a circuit diagram of evidence.",
  },
  {
    id: 4,
    prompt:
      "A dark data wall of ghostly white price columns hovering like monoliths in fog; one " +
      "column suddenly pulses, turns signal red and rises out of pattern; a hard spotlight " +
      "snaps onto the outlier while the others dim into shadow.",
  },
  {
    id: 5,
    prompt:
      "A monumental dark steel gate standing in slow-drifting fog, lit by a single warm " +
      "lamp; on a lectern before it, an unsigned paper document under a red wax seal waits; " +
      "the gate stays closed, patient and absolute, light breathing on its hinges.",
  },
  {
    id: 6,
    prompt:
      "Overhead shot of a long committee table in a wood-panelled chamber, nine empty seats, " +
      "aligned paper documents; a sleeve-only hand enters frame and signs the final page, then " +
      "a red rubber stamp descends and presses; warm light rises across the table like sunrise.",
  },
];

const OUT_DIR = path.resolve(process.cwd(), "public", "film");
const STATUS_FILE = path.resolve(process.cwd(), "scripts", "film-status.json");

type ChapterStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";
interface ChapterState {
  id: number;
  status: ChapterStatus;
  taskId?: string;
  error?: string;
  bytes?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadState(): Promise<Record<number, ChapterState>> {
  const state: Record<number, ChapterState> = {};
  for (const c of CHAPTERS) state[c.id] = { id: c.id, status: "PENDING" };
  try {
    const raw = JSON.parse(await readFile(STATUS_FILE, "utf8")) as Record<string, ChapterState>;
    for (const c of CHAPTERS) {
      const prev = raw[String(c.id)];
      /* a DONE chapter only counts if its file really exists on disk */
      if (prev?.status === "DONE") {
        try {
          const st = await stat(path.join(OUT_DIR, `chapter-${c.id}.mp4`));
          if (st.size > 100_000) {
            state[c.id] = { ...prev, id: c.id };
            continue;
          }
        } catch {
          /* file missing → regenerate */
        }
      }
      if (prev?.status === "PROCESSING" && prev.taskId) {
        state[c.id] = { id: c.id, status: "PROCESSING", taskId: prev.taskId };
      }
    }
  } catch {
    /* first run — fresh state */
  }
  return state;
}

async function persistStatus(state: Record<number, ChapterState>) {
  try {
    await writeFile(STATUS_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* status file is best-effort */
  }
}

function extractUrl(result: Record<string, unknown>): string | null {
  const vr = result.video_result as Array<{ url?: string }> | undefined;
  return (
    vr?.[0]?.url ??
    (result.video_url as string | undefined) ??
    (result.url as string | undefined) ??
    (result.video as string | undefined) ??
    null
  );
}

/* Poll an already-created task until SUCCESS / FAIL / timeout. */
async function pollTask(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  chId: number,
  taskId: string
): Promise<string | null> {
  for (let i = 0; i < 110; i++) {
    const r = (await zai.async.result.query(taskId)) as unknown as Record<string, unknown>;
    const st = r.task_status as string;
    if (st === "SUCCESS") return extractUrl(r);
    if (st === "FAIL") return null;
    if (i % 6 === 0) console.log(`[film] chapter ${chId}: still processing (poll ${i})`);
    await sleep(8000);
  }
  return null;
}

async function download(url: string, chId: number): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, `chapter-${chId}.mp4`), buf);
  return buf.length;
}

async function processChapter(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  ch: Chapter,
  state: Record<number, ChapterState>
) {
  const s = state[ch.id];

  /* resume an in-flight task from a previous run */
  if (s.status === "PROCESSING" && s.taskId) {
    console.log(`[film] chapter ${ch.id}: resuming task ${s.taskId}`);
    const url = await pollTask(zai, ch.id, s.taskId);
    if (url) {
      s.bytes = await download(url, ch.id);
      s.status = "DONE";
      s.taskId = undefined;
      await persistStatus(state);
      console.log(`[film] chapter ${ch.id}: DONE (${(s.bytes / 1e6).toFixed(1)} MB)`);
      return;
    }
    console.log(`[film] chapter ${ch.id}: resumed task failed → recreating`);
    s.status = "PENDING";
  }

  /* create → poll → download, with 429 backoff on creation */
  s.status = "PENDING";
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const task = await zai.video.generations.create({
        prompt: `${ch.prompt} ${STYLE}`,
        quality: "quality",
        with_audio: false,
        size: "1920x1080",
        fps: 30,
        duration: 10,
      });
      s.taskId = task.id;
      s.status = "PROCESSING";
      s.error = undefined;
      await persistStatus(state);
      console.log(`[film] chapter ${ch.id}: task ${task.id} created`);
      const url = await pollTask(zai, ch.id, task.id);
      if (!url) throw new Error("render failed or timed out");
      s.bytes = await download(url, ch.id);
      s.status = "DONE";
      s.taskId = undefined;
      await persistStatus(state);
      console.log(`[film] chapter ${ch.id}: DONE (${(s.bytes / 1e6).toFixed(1)} MB)`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      s.error = msg;
      const rateLimited = msg.includes("429") || msg.toLowerCase().includes("too many");
      console.error(`[film] chapter ${ch.id}: attempt ${attempt} failed — ${msg}`);
      s.status = "PENDING";
      await persistStatus(state);
      if (attempt === 8) {
        s.status = "FAILED";
        await persistStatus(state);
        return;
      }
      await sleep(rateLimited ? 25_000 : 8_000);
    }
  }
}

async function main() {
  const state = await loadState();
  const doneAlready = CHAPTERS.filter((c) => state[c.id].status === "DONE").length;
  console.log(
    `[film] REEL 01 — ${doneAlready}/${CHAPTERS.length} already done, ` +
      `generating ${CHAPTERS.length - doneAlready} chapter(s) sequentially (quality, 1920x1080, 10s)`
  );
  await mkdir(OUT_DIR, { recursive: true });
  const zai = await ZAI.create();

  for (const ch of CHAPTERS) {
    if (state[ch.id].status === "DONE") continue;
    console.log(`[film] ── chapter ${ch.id} ──`);
    await processChapter(zai, ch, state);
  }

  await persistStatus(state);
  const done = CHAPTERS.filter((c) => state[c.id].status === "DONE").length;
  console.log(`[film] finished — ${done}/${CHAPTERS.length} chapters rendered.`);
  if (done < CHAPTERS.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[film] fatal:", e);
  process.exit(1);
});
