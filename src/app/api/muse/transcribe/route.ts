import { NextRequest, NextResponse } from "next/server";
import { museConfigFromEnv, museTranscribe } from "@/lib/muse";

/**
 * POST /api/muse/transcribe — the assistant's ears.
 *
 * The browser sends one recorded clip (WAV, push-to-talk) and Muse Voice
 * Transcribe turns it into text. The clip never touches the sidecar and is
 * never stored: it goes straight to Meta Model API and comes back as a
 * sentence. No key configured? The route says so, and the bubble falls back
 * to typing — the product never depends on a secret to work.
 *
 * Body: multipart/form-data with a single `audio` part (WAV).
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const cfg = museConfigFromEnv();
  if (!cfg) {
    return NextResponse.json({
      configured: false,
      text: "",
      note: "Voice needs a Meta Model API key — set MUSE_API_KEY and reload. Type instead for now.",
    });
  }

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

  try {
    const result = await museTranscribe(cfg, audio, "clip.wav");
    if (!result.text) {
      return NextResponse.json({
        configured: true,
        text: "",
        note: "Muse heard nothing on that clip — try again, closer to the mic.",
      });
    }
    return NextResponse.json({ configured: true, text: result.text, turns: result.turns });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        error: (err as Error).message.slice(0, 300),
        note: "The voice service did not answer — type your question instead.",
      },
      { status: 502 }
    );
  }
}
