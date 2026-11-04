"""Assemble and verify the recorded-intro revision without re-rendering unchanged footage."""

from pathlib import Path
import argparse
import json
import re
import subprocess

P = Path(__file__).resolve().parent.parent
OUTPUT = P / "Quorum-Hackathon-Demo-Intro-Clean.mp4"


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def probe(path):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size:stream=codec_name,duration,nb_frames,width,height,r_frame_rate,channels,sample_rate",
        "-of", "json", str(path),
    ], text=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    alignment = json.loads((P / "review/intro-clean-caption-verification.json").read_text())
    assert len(alignment["scenes"]) == 6
    assert all(s["word_match"] >= .9 for s in alignment["scenes"])
    assert alignment["words"][-1]["end"] >= 178.5
    voice_check = run([
        "ffmpeg", "-hide_banner", "-i", str(P / "assets/narration-intro-clean.wav"),
        "-af", "silencedetect=noise=-40dB:d=1.5", "-f", "null", "-",
    ], capture_output=True, text=True)
    starts = [float(s) for s in re.findall(r"silence_start: ([0-9.]+)", voice_check.stderr)]
    ends = [float(s) for s in re.findall(r"silence_end: ([0-9.]+)", voice_check.stderr)]
    if len(ends) < len(starts):
        ends.append(180.0)
    silent_ranges = [[a, b] for a, b in zip(starts, ends)]
    assert all(b - a < 3 for a, b in silent_ranges), silent_ranges
    plan = json.loads((P / "narration-script.json").read_text())
    chapters = [";FFMETADATA1", "title=Quorum — procurement demo",
                "comment=Recorded creator intro; continuing narration from the creator-supplied Lusaka voice reference. Voice-only noise reduction; original music retained."]
    for scene in plan["scenes"]:
        chapters += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={scene['start']*1000}",
                     f"END={scene['end']*1000}", "title=" + scene["id"].title()]
    metadata = P / "review/intro-clean-chapters.txt"
    metadata.write_text("\n".join(chapters) + "\n")
    seam = json.loads((P / "review/intro-clean-seam.json").read_text())["frames"]
    assert len(seam) == 12
    # Snapshot reports round requested timestamps to milliseconds.
    assert all(abs(f["time"] - (12 + i / 30)) <= .00051 for i, f in enumerate(seam))
    playlist = P / "review/intro-clean-seam.ffconcat"
    lines = ["ffconcat version 1.0"]
    for frame in seam:
        path = P / "review/intro-clean-seam" / Path(frame["path"]).name
        assert path.is_file()
        lines += ["file '" + str(path) + "'", "option framerate 30", "duration 0.033333333"]
    last_path = P / "review/intro-clean-seam" / Path(seam[-1]["path"]).name
    lines += ["file '" + str(last_path) + "'", "option framerate 30"]
    playlist.write_text("\n".join(lines) + "\n")
    filters = (
        "[0:v]trim=start_frame=0:end_frame=360,setpts=PTS-STARTPTS,setsar=1,format=yuv420p[intro];"
        "[1:v]fps=30,trim=end_frame=12,setpts=PTS-STARTPTS,setsar=1,format=yuv420p[seam];"
        "[2:v]split=2[body-source][tail-source];"
        "[body-source]trim=start_frame=492:end_frame=5070,setpts=PTS-STARTPTS,"
        "tpad=stop_mode=clone:stop=120,setsar=1,format=yuv420p[body];"
        "[tail-source]trim=start_frame=5070:end_frame=5400,setpts=PTS-STARTPTS,"
        "setsar=1,format=yuv420p[tail];"
        "[intro][seam][body][tail]concat=n=4:v=1:a=0,fps=30[picture];"
        "[picture][3:v]overlay=shortest=1:format=auto:enable='lt(t,12)+gte(t,12.4)'[v]"
    )
    # The 12 native transition frames already include captions; the overlay skips that interval.
    # The extra MCP time holds its static panel, leaving the animated closing intact.
    encode = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning", "-stats", "-stats_period", "5",
        "-filter_complex_threads", "2", "-i", str(P / "assets/meta-intro-picture.mp4"),
        "-f", "concat", "-safe", "0", "-i", str(playlist),
        "-i", str(P / "renders/fullscreen-picture.mp4"),
        "-i", str(P / "renders/intro-clean-captions.mov"),
        "-i", str(P / "assets/master-intro-clean.wav"), "-f", "ffmetadata", "-i", str(metadata),
        "-filter_complex", filters, "-map", "[v]", "-map", "4:a:0",
        "-map_metadata", "5", "-map_chapters", "5", "-c:v", "libx264", "-threads", "4",
        "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-frames:v", "5400", "-t", "180",
        "-movflags", "+faststart", str(OUTPUT),
    ]
    if not args.verify_only:
        print("Exporting the recorded intro, cleaned narration, captions and music…", flush=True)
        with (P / "review/intro-clean-export.log").open("w") as log:
            run(encode, stdout=log, stderr=log)
    result = probe(OUTPUT)
    video = next(s for s in result["streams"] if s["codec_name"] == "h264")
    audio = next(s for s in result["streams"] if s["codec_name"] == "aac")
    assert (video["width"], video["height"], video["r_frame_rate"]) == (1920, 1080, "30/1")
    assert int(video["nb_frames"]) == 5400 and abs(float(result["format"]["duration"]) - 180) < .001
    assert audio["channels"] == 2 and audio["sample_rate"] == "48000"
    loudness = run([
        "ffmpeg", "-hide_banner", "-i", str(OUTPUT), "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=10:print_format=json", "-f", "null", "-",
    ], capture_output=True, text=True)
    metrics = json.JSONDecoder().raw_decode(loudness.stderr[loudness.stderr.rfind("{"):])[0]
    assert -17 <= float(metrics["input_i"]) <= -15, metrics
    assert float(metrics["input_tp"]) <= -1.0, metrics
    result.update({
        "recorded_intro_source": "Meta Hackathon.mp4", "continuing_voice_reference": "Lusaka.m4a",
        "noise_reduction_on_voice_only": True, "music_retained": True, "tempo_or_pitch_changed": False,
        "voice_only_silent_ranges_over_1_5_seconds": silent_ranges,
        "last_spoken_word_end": alignment["words"][-1]["end"],
        "narration_scenes": alignment["scenes"], "caption_count": alignment["captions"],
        "audio_loudness": metrics, "full_decode_passed": True,
    })
    (P / "review/intro-clean-final-verification.json").write_text(json.dumps(result, indent=2))
    for second in [.7, 6, 12.2, 12.4, 18, 54, 106, 135, 164, 178]:
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", str(second), "-i", str(OUTPUT),
             "-frames:v", "1", str(P / f"review/intro-clean-final-{second}.png")])
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(OUTPUT),
         "-vf", "fps=1/15,scale=480:-1,tile=4x3", "-frames:v", "1",
         str(P / "review/intro-clean-final-contact.jpg")])
    print(json.dumps({"file": str(OUTPUT), "duration": 180, "frames": 5400,
                      "size_mb": round(int(result["format"]["size"]) / 1e6, 2),
                      "lufs": metrics["input_i"], "true_peak_dbtp": metrics["input_tp"],
                      "last_spoken_word_end": alignment["words"][-1]["end"]}), flush=True)


if __name__ == "__main__":
    main()
