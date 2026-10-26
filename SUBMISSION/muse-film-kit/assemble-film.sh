#!/usr/bin/env bash
# assemble-film.sh — turn generated frames into the five chapter MP4s.
#
# Meta Global AI Developer Hackathon 2026 edition.
#
# Usage:
#   ./assemble-film.sh            # assembles all chapters found in ./frames
#   CHAPTERS="1 3" ./assemble-film.sh
#
# Requires: ffmpeg. Output: ../../public/film/chapter-N.mp4 (drop-in for the
# landing-page cinema player — same filenames, silent, 24 fps, yuv420p).
set -euo pipefail

FPS="${FPS:-24}"
SECONDS_PER_FRAME="${SECONDS_PER_FRAME:-2}"
FRAMES_DIR="${FRAMES_DIR:-./frames}"
OUT_DIR="${OUT_DIR:-../../public/film}"

command -v ffmpeg >/dev/null 2>&1 || { echo "❌ ffmpeg is required (apt install ffmpeg / brew install ffmpeg)"; exit 1; }
mkdir -p "$OUT_DIR"

for chapter_dir in "$FRAMES_DIR"/chapter-*; do
    [ -d "$chapter_dir" ] || continue
    chapter_id="$(basename "$chapter_dir" | sed 's/chapter-//')"
    if [ -n "${CHAPTERS:-}" ]; then
        case " $CHAPTERS " in
            *" $chapter_id "*) ;;
            *) continue ;;
        esac
    fi

    frame_count=$(ls "$chapter_dir"/frame-*.png 2>/dev/null | wc -l)
    if [ "$frame_count" -eq 0 ]; then
        echo "ℹ️  chapter $chapter_id: no frames, skipping"
        continue
    fi

    out="$OUT_DIR/chapter-$chapter_id.mp4"
    echo "🎬 chapter $chapter_id: $frame_count frames × ${SECONDS_PER_FRAME}s → $out"

    # Ken Burns over each frame (slow zoom-in), hard cuts between frames.
    filter=""
    for i in $(seq 1 "$frame_count"); do
        n=$(printf "%02d" "$i")
        filter+="-loop 1 -t $SECONDS_PER_FRAME -i \"$chapter_dir/frame-$n.png\" "
    done
    for i in $(seq 0 $((frame_count - 1))); do
        filter+="[$i:v]scale=1280:720,zoompan=z='min(zoom+0.0008,1.12)':d=${SECONDS_PER_FRAME}*${FPS}:s=1280x720:fps=${FPS},format=yuv420p[v$i];"
    done
    for i in $(seq 0 $((frame_count - 1))); do
        filter+="[v$i]"
    done
    filter+="concat=n=${frame_count}:v=1:a=0[outv]"

    eval ffmpeg -y $filter -map "[outv]" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart "$out"
    echo "  ✅ wrote $out"
done

echo ""
echo "✅ Done. The landing-page cinema player reads public/film/chapter-{1..5}.mp4 — refresh and play."
