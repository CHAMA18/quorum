"""Render the spoken caption track as a transparent, frame-accurate overlay."""

from pathlib import Path
import json
import subprocess
from PIL import Image, ImageDraw, ImageFont

P = Path(__file__).resolve().parent.parent
FPS = 30


def main(output_name="renders/spoken-captions.mov", prefix="spoken-captions"):
    captions = json.loads((P / "captions.json").read_text())
    directory = P / "review" / (prefix + "-images")
    directory.mkdir(exist_ok=True)
    font = ImageFont.truetype(str(P / "assets/fonts/Montserrat.ttf"), 36)
    if hasattr(font, "get_variation_axes"):
        axes = font.get_variation_axes()
        if axes:
            values = [400 if b"Weight" in axis["name"] else axis["default"] for axis in axes]
            font.set_variation_by_axes(values)
    blank = directory / "blank.png"
    Image.new("RGBA", (1920, 1080), (0, 0, 0, 0)).save(blank)
    timeline, cursor = [], 0
    for index, caption in enumerate(captions):
        start = max(cursor, round(caption["start"] * FPS))
        end = max(start + 1, round(caption["end"] * FPS))
        if start > cursor:
            timeline.append((blank, start - cursor))
        canvas = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        text = caption["text"]
        width = draw.textlength(text, font=font)
        if width > 1492:
            raise RuntimeError("Caption exceeds the safe width: " + text)
        draw.rounded_rectangle((960 - width / 2 - 22, 920, 960 + width / 2 + 22, 979), radius=4, fill=(18, 19, 24, 255))
        draw.text((960, 927), text, font=font, anchor="mt", fill=(245, 242, 237, 255))
        path = directory / f"caption-{index:03}.png"
        canvas.save(path)
        timeline.append((path, end - start))
        cursor = end
    if cursor < 5400:
        timeline.append((blank, 5400 - cursor))
    lines = ["ffconcat version 1.0"]
    for path, frames in timeline:
        lines.extend(["file '" + str(path) + "'", "option framerate 30", f"duration {frames / FPS:.9f}"])
    lines.extend(["file '" + str(blank) + "'", "option framerate 30"])
    playlist = P / "review" / (prefix + ".ffconcat")
    playlist.write_text("\n".join(lines) + "\n")
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", str(playlist), "-r", "30", "-t", "180", "-frames:v", "5400", "-c:v", "qtrle",
        "-pix_fmt", "argb", str(P / output_name),
    ], check=True)
    print(f"Rendered {len(captions)} spoken captions across all 5400 frames.")


if __name__ == "__main__":
    main()
