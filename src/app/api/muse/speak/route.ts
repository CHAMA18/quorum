import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/muse/speak — the assistant's real voice.
 *
 * The model is not a TTS model; Meta Model API gives us Muse Spark and Muse
 * Voice Transcribe, not speech synthesis. The voice therefore comes from
 * Cloudflare Workers AI through the quorum-edge Worker:
 *
 *   Deepgram Aura-2 (English, natural pacing)  ->  MeloTTS fallback
 *
 * The Worker holds the AI binding; this route holds only the server-to-server
 * shared secret. Neither the browser nor the client sees the Cloudflare token.
 * If the edge is not configured or the AI call fails, the client falls back
 * to the browser's installed speech synthesis — the assistant is never mute.
 *
 * Body: { text: string, voice?: "asteria" | "orion" | "luna" | "atlas" }
 */

export const runtime = "nodejs";

const VOICES = new Set(["asteria", "orion", "luna", "atlas"]);
const MAX_CHARS = 1400;

function edgeConfig(): { url: string; secret: string } | null {
  const url = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") || "";
  const secret = process.env.QUORUM_EDGE_SECRET?.trim() || "";
  if (!url || !secret) return null;
  return { url, secret };
}

export async function POST(request: NextRequest) {
  const cfg = edgeConfig();
  if (!cfg) {
    return NextResponse.json(
      { configured: false, note: "The neural voice is not configured; the browser voice will be used." },
      { status: 503 }
    );
  }

  let body: { text?: unknown; voice?: unknown };
  try {
    body = (await request.json()) as { text?: unknown; voice?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected JSON { text, voice? }." }, { status: 400 });
  }

  const text = String(body.text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*#`>_|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
  if (text.length < 2) return NextResponse.json({ error: "Text is required." }, { status: 422 });

  const requested = String(body.voice ?? "");
  const voice = VOICES.has(requested) ? requested : "asteria";

  try {
    const res = await fetch(`${cfg.url}/__edge/tts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-quorum-edge-key": cfg.secret,
      },
      body: JSON.stringify({ text, voice }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("audio/")) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        {
          configured: true,
          note: "The neural voice did not answer; the browser voice will be used.",
          error: detail.slice(0, 240),
        },
        { status: 502 }
      );
    }
    return new NextResponse(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": "private, max-age=0",
        "x-quorum-voice": res.headers.get("x-quorum-voice") ?? "aura-2",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        note: "The neural voice did not answer; the browser voice will be used.",
        error: (err as Error).message.slice(0, 240),
      },
      { status: 502 }
    );
  }
}
