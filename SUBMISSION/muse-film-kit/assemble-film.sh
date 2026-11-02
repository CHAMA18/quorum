#!/usr/bin/env bash
# Render Muse Image stills into silent, widescreen landing-page chapters.
#
# Usage:
#   ./assemble-film.sh
#   CHAPTERS="1 3" ./assemble-film.sh
#
# Requires ffmpeg. By default writes public/film/chapter-N.mp4.
set -euo pipefail
shopt -s nullglob

FPS="${FPS:-24}"
SECONDS_PER_FRAME="${SECONDS_PER_FRAME:-2}"
FRAMES_DIR="${FRAMES_DIR:-./frames}"
OUT_DIR="${OUT_DIR:-../../public/film}"
WIDTH="${WIDTH:-1920}"
HEIGHT="${HEIGHT:-804}"
OUTLINE="${OUTLINE:-20}"
ENCODER_PRESET="${ENCODER_PRESET:-fast}"

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is required." >&2; exit 1; }
command -v ffprobe >/dev/null 2>&1 || { echo "ffprobe is required." >&2; exit 1; }
[[ "$FPS" =~ ^[0-9]+$ && "$SECONDS_PER_FRAME" =~ ^[0-9]+$ ]] || {
  echo "FPS and SECONDS_PER_FRAME must be positive whole numbers." >&2
  exit 1
}
(( FPS > 0 && SECONDS_PER_FRAME > 0 )) || {
  echo "FPS and SECONDS_PER_FRAME must be greater than zero." >&2
  exit 1
}

mkdir -p "$OUT_DIR"
frames_per_shot=$((FPS * SECONDS_PER_FRAME))

for chapter_dir in "$FRAMES_DIR"/chapter-*; do
  [[ -d "$chapter_dir" ]] || continue
  chapter_id="${chapter_dir##*/chapter-}"
  if [[ -n "${CHAPTERS:-}" ]] && [[ " ${CHAPTERS} " != *" ${chapter_id} "* ]]; then
    continue
  fi

  frames=("$chapter_dir"/frame-*.jpg)
  frame_count=${#frames[@]}
  if (( frame_count == 0 )); then
    echo "Chapter $chapter_id has no JPEG frames; skipping."
    continue
  fi

  for ((i = 0; i < frame_count; i++)); do
    expected=$(printf '%s/frame-%02d.jpg' "$chapter_dir" "$((i + 1))")
    if [[ "${frames[$i]}" != "$expected" ]]; then
      echo "Chapter $chapter_id frames must be numbered consecutively from frame-01.jpg." >&2
      exit 1
    fi
  done

  output="$OUT_DIR/chapter-$chapter_id.mp4"
  temp_output="$output.tmp.mp4"
  echo "Rendering chapter $chapter_id: $frame_count shots × ${SECONDS_PER_FRAME}s at ${WIDTH}×${HEIGHT}."

  inputs=()
  filter_parts=()
  concat_inputs=""
  for ((i = 0; i < frame_count; i++)); do
    inputs+=( -loop 1 -framerate 1 -t 1 -i "${frames[$i]}" )
    pan_direction=1
    (( i % 2 == 0 )) || pan_direction=-1
    filter_parts+=(
      "[$i:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},zoompan=z='min(zoom+0.00075,1.10)':x='(iw-iw/zoom)*(0.5+(${pan_direction}*0.18*on/${frames_per_shot}))':y='(ih-ih/zoom)*0.5':d=${frames_per_shot}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1,format=yuv420p[v$i]"
    )
    concat_inputs+="[v$i]"
  done

  filter_complex="$(IFS=';'; echo "${filter_parts[*]}")"
  filter_complex+=";${concat_inputs}concat=n=${frame_count}:v=1:a=0[outv]"
  expected_seconds=$((frame_count * SECONDS_PER_FRAME))

  ffmpeg -hide_banner -loglevel warning -y \
    "${inputs[@]}" \
    -filter_complex "$filter_complex" \
    -map '[outv]' -an \
    -c:v libx264 -preset "$ENCODER_PRESET" -crf "$OUTLINE" -profile:v high \
    -pix_fmt yuv420p -movflags +faststart -t "$expected_seconds" \
    "$temp_output"

  duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$temp_output")"
  if ! awk -v actual="$duration" -v expected="$expected_seconds" 'BEGIN { delta=actual-expected; if (delta < 0) delta=-delta; exit !(delta <= 0.08) }'; then
    echo "Chapter $chapter_id render duration is ${duration}s; expected ${expected_seconds}s." >&2
    exit 1
  fi
  mv "$temp_output" "$output"
  echo "Rendered $output (${duration}s)."
done

echo "All selected chapters rendered to $OUT_DIR."
