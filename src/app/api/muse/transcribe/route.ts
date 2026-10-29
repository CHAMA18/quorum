import { NextRequest, NextResponse } from "next/server";
import { museConfigFromEnv, museTranscribe } from "@/lib/muse";

/**
 * POST /api/muse/transcribe — the assistant's ears.
 *
 * Three hearing paths, tried in order of quality:
 *
 *   1. Muse Voice Transcribe (Meta Model API) — when MUSE_API_KEY is set.
 *   2. The quorum-edge Worker's speech-to-text (Cloudflare Workers AI,
 *      whisper → nova-3) — when the edge is configured. The clip never
 *      touches disk on either hop and is never stored.
 *   3. The browser's own SpeechRecognition — probed by the client via GET
 *      and used live, with no server round trip at all.
 *
 * The clip goes straight to the hearing service and comes back as a
 * sentence. There is deliberately no setup notice anywhere in this chain:
 * if no server path exists the route says provider "browser" and the bubble
 * switches to the device's own ears — the product never depends on a secret.
 *
 * GET  → { provider: "meta" | "edge" | "browser" } — one probe, cached client-side.
 * POST → multipart/form-data with a single `audio` part (WAV).
 */

export const runtime = "nodejs";

function edgeConfig(): { url: string; secret: string } | null {
  const url = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") || "";
  const secret = process.env.QUORUM_EDGE_SECRET?.trim() || "";
  if (!url || !secret) return null;
  return { url, secret };
}

export async function GET() {
  const provider = museConfigFromEnv() ? "meta" : edgeConfig() ? "edge" : "browser";
  return NextResponse.json({ provider });
}

export async function POST(request: NextRequest) {
  const cfg = museConfigFromEnv();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form with one audio clip." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio clip was received." }, { status: 422 });
  }
  if (audio.size > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "That clip is too long — hold the mic and ask a short question." }, { status: 413 });
  }

  /* 1. Meta's transcriber, when the console key is present. */
  if (cfg) {
    try {
      const result = await museTranscribe(cfg, audio, "clip.wav");
      if (!result.text) {
        return NextResponse.json({
          configured: true,
          provider: "meta",
          text: "",
          note: "Muse heard nothing on that clip — try again, closer to the mic.",
        });
      }
      return NextResponse.json({ configured: true, provider: "meta", text: result.text, turns: result.turns });
    } catch (err) {
      return NextResponse.json(
        {
          configured: true,
          provider: "meta",
          error: (err as Error).message.slice(0, 300),
          note: "The voice service did not answer — type your question instead.",
        },
        { status: 502 }
      );
    }
  }

  /* 2. The edge Worker's ears — Cloudflare Workers AI, server-to-server. */
  const edge = edgeConfig();
  if (edge) {
    try {
      const upstream = new FormData();
      upstream.append("audio", audio, "clip.wav");
      const res = await fetch(`${edge.url}/__edge/asr`, {
        method: "POST",
        headers: { "x-quorum-edge-key": edge.secret },
        body: upstream,
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
      const text = String(data?.text ?? "").trim();
      if (res.ok && text) {
        return NextResponse.json({ configured: true, provider: "edge", text });
      }
      return NextResponse.json({
        configured: false,
        provider: "browser",
        text: "",
        note: "I could not make out that clip — try again, or type the question.",
      });
    } catch {
      return NextResponse.json({
        configured: false,
        provider: "browser",
        text: "",
        note: "I could not make out that clip — try again, or type the question.",
      });
    }
  }

  /* 3. No server ears — the client uses the browser's own recognition. */
  return NextResponse.json({ configured: false, provider: "browser", text: "" });
}
