# Muse Film Kit — regenerate the Quorum demo film with Muse Image

**Meta Global AI Developer Hackathon 2026 edition.** The landing page's five-chapter
demo film was originally rendered with CogVideoX-3 (open weights). This kit regenerates
all five chapters with **Muse Image via the Meta Model API**, so the film itself becomes
part of the build-with-Meta story.

The cinema player on the landing page reads `public/film/chapter-{1..5}.mp4` — the
assembler writes exactly those filenames, so nothing in the app changes.

## What's here

| File | Purpose |
| --- | --- |
| `prompts.json` | 5 chapters × 8 frames, each prompt written to the chapter's story beat and Quorum's visual language (near-black `#14161b` operations-room palette, single signal-red accent `#e8382a`, Lusaka procurement office, no text/watermarks) |
| `generate-frames.ts` | Bun script that calls the image-generation endpoint for every frame and saves `frames/chapter-N/frame-KK.png` |
| `assemble-film.sh` | ffmpeg Ken Burns (slow zoom) per frame → `chapter-N.mp4`, silent, 24 fps, yuv420p, `+faststart` |

## Prerequisites

1. **Meta Model API token** — from your Meta developer console (dev.meta.ai). Hackathon
   participants receive API credits; the film costs roughly **40 images** (5 chapters × 8
   frames), well inside the credit allowance.
2. **Bun** — already the project's runtime (`bun install` once at the repo root).
3. **ffmpeg** — `apt install ffmpeg` / `brew install ffmpeg`.

## Run it

```bash
cd SUBMISSION/muse-film-kit

# 1. Point the generator at your Meta Model API image endpoint.
#    Check the exact endpoint + model id in your console / the Model API docs.
export META_API_KEY="<your-token>"
# export META_IMAGE_URL="<your-meta-model-api-base-url>/v1/images/generations"
# export META_IMAGE_MODEL="<muse-image-model-id>"

# 2. Generate the 40 frames (idempotent — reruns skip existing frames).
bun run generate-frames.ts            # add --force to redo, --only 1,3 to restrict

# 3. Assemble the five chapter MP4s into public/film/.
./assemble-film.sh

# 4. Review: bun run dev → landing page → the film plays the new chapters.
```

## Tuning

- **Pacing** — `SECONDS_PER_FRAME=3 ./assemble-film.sh` slows each chapter to 24 s.
- **Resolution** — edit `meta.size` in `prompts.json` (e.g. `1920x1080`) and the
  `scale=1280:720` + `s=1280x720` values in `assemble-film.sh` to match.
- **Look** — `style_suffix` in `prompts.json` is appended to every frame prompt; it is
  the single place to restyle the whole film.
- **Partial regeneration** — `bun run generate-frames.ts --only 5 --force` regenerates
  chapter 5 only.

## Notes

- The request/response shape for image generation is isolated in `callImageApi()` in
  `generate-frames.ts`. It implements the generic OpenAI-compatible
  `POST /v1/images/generations` shape (`{prompt, size, n}` → `b64_json | url`). If the
  Meta Model API differs, adapt that one function — everything else is endpoint-agnostic.
- Keep the existing CogVideoX files until the new chapters are reviewed; the assembler
  overwrites `public/film/chapter-N.mp4` only after a chapter's frames all render.
- The film is silent by design — the landing page plays it muted, sequenced by Quorum's
  own cinema player (title cards, chapter ticks, master clock).
