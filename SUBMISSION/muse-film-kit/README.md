# Muse Image landing-film kit

This kit regenerates Quorum's five-chapter landing-page film with Meta Muse
Image. It renders five silent chapter MP4s directly into `public/film/`, so the
existing landing-page cinema player and chapter controls keep working.

Muse Image uses Meta Model API at `https://api.meta.ai/v1`, model
`muse-image-1.0`, with `POST /images/generations` for the character anchor and
`POST /images/edits` for subsequent shots. Chapter 1, frame 1 establishes the
lead procurement officer; every other shot uses it as a character and palette
reference for continuity.

## Requirements

- Bun
- `ffmpeg` and `ffprobe`
- Meta Model API access with Muse Image enabled

The generator reads `MUSE_API_KEY` (or `MODEL_API_KEY`) and optional
`MUSE_BASE_URL` from the process environment or the repository-root
`.env.local`. It never prints the key. The default generation makes 40 images;
at Meta's published $0.01/image price, the full set is about **$0.40**.

## Generate and render

Run commands from this directory:

```bash
# First, create and inspect the shared character-reference frame.
bun run generate-frames.ts --force --only 1 --limit 1

# Once the anchor looks right, generate the remaining shots. Existing frames
# are skipped, so this does not regenerate or rebill the anchor.
bun run generate-frames.ts

# Render 5 chapters, 8 shots each, 2 seconds per shot, 24 fps, 2.39:1.
./assemble-film.sh
```

The generated JPEG stills live under `frames/chapter-N/`. Rendered output is
`../../public/film/chapter-N.mp4`. Generated text is avoided in the images;
the landing-page player carries all titles and chapter copy. The final edit is
silent and uses slow, alternating camera drifts over the Muse Image frames.
The renderer defaults to 1920×804, H.264 CRF 20, and the `fast` encoder
preset. Set `WIDTH`, `HEIGHT`, `OUTLINE`, or `ENCODER_PRESET` to trade output
size and render time against resolution and compression quality.

For focused regeneration:

```bash
bun run generate-frames.ts --force --only 3 --limit 2
CHAPTERS="3" ./assemble-film.sh
```

To regenerate one frame, specify both its chapter and frame number, for
example `bun run generate-frames.ts --only 4 --frame 8`.

`--limit` is the number of frames per selected chapter. `SECONDS_PER_FRAME`
and `FPS` can be changed for a different pace, but the landing-page player
expects each chapter to remain a silent H.264 MP4.

## Visual direction

One Zambian procurement officer carries the story from an overflowing paper
archive through source verification and committee review. A red cloth ribbon
connects the archive, source pages, reviewed variance and final decision. The
images use lived-in Lusaka interiors, practical light and tactile paper rather
than synthetic dashboards, floating graphics or invented on-screen claims.

## Meta references

- [Muse Image generation docs](https://dev.meta.ai/docs/image-generation)
- [Generate image API reference](https://dev.meta.ai/docs/api-reference/images/create-image)
- [Meta Model API overview](https://dev.meta.ai/docs/overview)
