"""Export and verify the complete full-screen demo with the Lusaka voice."""

from pathlib import Path
import argparse
import json
import re
import subprocess

P = Path(__file__).resolve().parent.parent
OUTPUT = P / "Quorum-Hackathon-Demo-Fullscreen-Lusaka.mp4"


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def probe(path):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size:stream=index,codec_name,start_time,duration,nb_frames,width,height,r_frame_rate,channels,sample_rate",
        "-of", "json", str(path),
    ], text=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    alignment = json.loads((P / "review/lusaka-narration-alignment.json").read_text())
    assert len(alignment["scenes"]) == 6 and all(s["script_match"] >= .9 for s in alignment["scenes"])
    assert alignment["scenes"][-1]["spoken_end"] >= 178.5
    voice_check = run(["ffmpeg", "-hide_banner", "-i", str(P / "assets/narration-lusaka.wav"),
                       "-af", "silencedetect=noise=-40dB:d=1.5", "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(s) for s in re.findall(r"silence_start: ([0-9.]+)", voice_check.stderr)]
    ends = [float(s) for s in re.findall(r"silence_end: ([0-9.]+)", voice_check.stderr)]
    if len(ends) < len(starts):
        ends.append(180.0)
    silent_ranges = [[a, b] for a, b in zip(starts, ends)]
    assert all(b - a < 3 for a, b in silent_ranges), silent_ranges
    plan = json.loads((P / "narration-script.json").read_text())
    chapters = [";FFMETADATA1", "title=Quorum — procurement demo", "comment=Narration generated locally from the creator-supplied Lusaka voice sample."]
    for scene in plan["scenes"]:
        chapters += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={scene['start']*1000}",
                     f"END={scene['end']*1000}", "title=" + scene["id"].title()]
    metadata = P / "review/lusaka-chapters.txt"
    metadata.write_text("\n".join(chapters) + "\n")
    encode = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "warning", "-i", str(P / "renders/fullscreen-picture.mp4"),
         "-i", str(P / "renders/spoken-captions.mov"), "-i", str(P / "assets/master-lusaka.wav"),
         "-f", "ffmetadata", "-i", str(metadata), "-filter_complex", "[0:v][1:v]overlay=shortest=1:format=auto[v]",
         "-map", "[v]", "-map", "2:a:0", "-map_metadata", "3", "-map_chapters", "3",
         "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", "30",
         "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-t", "180", "-movflags", "+faststart", str(OUTPUT)]
    if not args.verify_only:
        run(encode)
    result = probe(OUTPUT)
    video = next(s for s in result["streams"] if s["codec_name"] == "h264")
    audio = next(s for s in result["streams"] if s["codec_name"] == "aac")
    assert video["width"] == 1920 and video["height"] == 1080 and video["r_frame_rate"] == "30/1"
    assert int(video["nb_frames"]) == 5400 and abs(float(result["format"]["duration"]) - 180) < .001
    assert audio["channels"] == 2 and audio["sample_rate"] == "48000"
    loudness = run(["ffmpeg", "-hide_banner", "-i", str(OUTPUT), "-af",
                    "loudnorm=I=-16:TP=-1.5:LRA=10:print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    metrics = json.JSONDecoder().raw_decode(loudness.stderr[loudness.stderr.rfind("{"):])[0]
    assert -17 <= float(metrics["input_i"]) <= -15, metrics
    assert float(metrics["input_tp"]) <= -1.0, metrics
    result.update({"voice_source": "Lusaka.m4a", "voice_generated_locally": True,
                   "voice_only_silent_ranges_over_1_5_seconds": silent_ranges,
                   "narration_scenes": alignment["scenes"], "audio_loudness": metrics})
    (P / "review/lusaka-final-verification.json").write_text(json.dumps(result, indent=2))
    for second in [8, 38, 64, 114, 143, 164, 178]:
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", str(second), "-i", str(OUTPUT),
             "-frames:v", "1", str(P / f"review/lusaka-final-{second}.png")])
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(OUTPUT),
         "-vf", "fps=1/15,scale=480:-1,tile=4x3", "-frames:v", "1", str(P / "review/lusaka-final-contact.jpg")])
    print(json.dumps({"file": str(OUTPUT), "duration": 180, "frames": 5400,
                      "size_mb": round(int(result["format"]["size"]) / 1e6, 1),
                      "lufs": metrics["input_i"], "true_peak_dbtp": metrics["input_tp"],
                      "voice_continues_through_final_scene": True}), flush=True)


if __name__ == "__main__":
    main()
