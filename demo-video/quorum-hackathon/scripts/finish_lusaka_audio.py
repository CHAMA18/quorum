"""Align the cloned narration without stretching the voice; build spoken captions."""

from pathlib import Path
import argparse
import difflib
import hashlib
import html
import json
import os
import re
import subprocess

os.environ.setdefault("HF_HOME", "/tmp/quorum-voice-cache/hf")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np
import mlx.core as mx
from scipy.io import wavfile
from scipy.signal import butter, sosfilt
from mlx_audio.stt.utils import load_model

P = Path(__file__).resolve().parent.parent
RATE = 24000


def clean(text):
    text = text.lower().replace("corum", "quorum").replace("a i", "ai").replace("m c p", "mcp")
    return re.findall(r"[a-z0-9]+", text)


def stamp(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcribe-only", action="store_true")
    parser.add_argument("--scene", action="append")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if args.scene and not args.transcribe_only:
        parser.error("--scene requires --transcribe-only")
    mx.set_cache_limit(64 * 1024 * 1024)
    mx.set_memory_limit(4 * 1024 ** 3)
    mx.set_wired_limit(2 * 1024 ** 3)
    plan = json.loads((P / "narration-script.json").read_text())
    recognizer = None
    narration = np.zeros(180 * RATE, dtype=np.float32)
    all_words, decisions = [], []
    for scene in plan["scenes"]:
        if args.scene and scene["id"] not in args.scene:
            continue
        source = P / "assets/lusaka-narration" / (scene["id"] + ".wav")
        if not source.exists() and args.transcribe_only:
            continue
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        transcript_file = P / "review" / ("lusaka-" + scene["id"] + "-words.json")
        data = json.loads(transcript_file.read_text()) if transcript_file.exists() else {}
        if data.get("sha256") != digest or args.refresh:
            if recognizer is None:
                recognizer = load_model("/tmp/quorum-whisper")
            print("Transcribing generated " + scene["id"], flush=True)
            result = recognizer.generate(str(source), language="en", temperature=0.0,
                                         word_timestamps=True, condition_on_previous_text=False,
                                         initial_prompt="Quorum, AI, MCP, Meta-powered procurement, supplier portal, tender evaluation.", verbose=None)
            data = {"sha256": digest, "text": result.text, "segments": result.segments}
            transcript_file.write_text(json.dumps(data, indent=2))
        match = difflib.SequenceMatcher(a=clean(scene["text"]), b=clean(data["text"])).ratio()
        if match < .9:
            raise RuntimeError(f"Speech does not match {scene['id']} script: {match:.3f}; inspect {transcript_file}")
        if args.transcribe_only:
            print(f"Verified {scene['id']}: script match {match:.3f}", flush=True)
            continue
        words = [dict(w) for segment in data["segments"] for w in segment.get("words", []) if w["word"].strip()]
        if not words:
            raise RuntimeError("No word timings for " + scene["id"])
        rate, audio = wavfile.read(source)
        if rate != RATE:
            raise RuntimeError(f"Unexpected sample rate: {rate}")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        first = max(0, words[0]["start"] - .13)
        last = min(len(audio) / rate, words[-1]["end"] + .18)
        duration = last - first
        target_start = scene["start"] + (.35 if scene["id"] == "opening" else .2)
        target_end = scene["end"] - (.9 if scene["id"] == "mcp" else .2)
        extra = target_end - target_start - duration
        if extra < -.15:
            raise RuntimeError(f"{scene['id']} speech exceeds scene by {-extra:.2f}s; regenerate or shorten copy")
        boundaries = []
        since_boundary = 0
        for index, (a, b) in enumerate(zip(words, words[1:])):
            since_boundary += 1
            if re.search(r"[.!?,;:]$", a["word"].strip()) and since_boundary >= 3:
                boundaries.append((index, (a["end"] + b["start"]) / 2))
                since_boundary = 0
        if extra > 0 and not boundaries:
            raise RuntimeError("No safe pause boundaries for " + scene["id"])
        added_pause = max(0, extra) / max(1, len(boundaries))
        if added_pause > 1.7:
            raise RuntimeError(f"{scene['id']} needs {added_pause:.2f}s added at each breath; expand narration instead")
        cuts = [first] + [time for _, time in boundaries] + [last]
        destination = target_start
        mapping = []
        for i, (a, b) in enumerate(zip(cuts, cuts[1:])):
            chunk = audio[round(a * RATE):round(b * RATE)].astype(np.float32)
            edge = min(round(.003 * RATE), len(chunk) // 2)
            if edge:
                chunk[:edge] *= np.linspace(0, 1, edge)
                chunk[-edge:] *= np.linspace(1, 0, edge)
            dest_sample = round(destination * RATE)
            narration[dest_sample:dest_sample + len(chunk)] = chunk
            mapping.append((a, b, destination - a))
            destination += len(chunk) / RATE + (added_pause if i < len(cuts) - 2 else 0)
        for word in words:
            for a, b, shift in mapping:
                if a - .001 <= word["start"] < b:
                    text = word["word"].strip().replace("Corum", "Quorum").replace("corum", "Quorum")
                    all_words.append({"text": text, "start": word["start"] + shift,
                                      "end": word["end"] + shift, "scene": scene["id"]})
                    break
        decisions.append({"scene": scene["id"], "script_match": round(match, 4),
                          "source_duration": len(audio) / RATE, "spoken_start": target_start,
                          "spoken_end": destination, "added_pause_seconds": round(added_pause, 4),
                          "speed_changed": False, "cuts": cuts})
        print(json.dumps(decisions[-1]), flush=True)
    if args.transcribe_only:
        return
    wavfile.write(P / "assets/lusaka-narration-aligned.wav", RATE, narration)
    # Level only: preserve the generated voice's timbre, breaths, and tempo.
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i",
                    str(P / "assets/lusaka-narration-aligned.wav"), "-af",
                    "highpass=f=50,loudnorm=I=-18:TP=-2:LRA=11,aresample=48000", "-c:a", "pcm_s24le",
                    str(P / "assets/narration-lusaka.wav")], check=True)
    captions, group = [], []
    for index, word in enumerate(all_words):
        group.append(word)
        next_word = all_words[index + 1] if index + 1 < len(all_words) else None
        if len(group) >= 8 or (len(group) >= 3 and re.search(r"[.!?]$", word["text"])) or not next_word or next_word["scene"] != word["scene"]:
            captions.append({"text": " ".join(w["text"] for w in group), "start": group[0]["start"],
                             "end": min(word["end"] + .3, next_word["start"] - .035 if next_word else 179.2),
                             "kind": "spoken", "scene": word["scene"]})
            group = []
    for caption in captions:
        caption["text"] = re.sub(r"\bA\s+I\b", "AI", caption["text"])
        caption["text"] = re.sub(r"\bM\s+C\s+P\b", "MCP", caption["text"])
    (P / "captions.json").write_text(json.dumps(captions, indent=2))
    (P / "Quorum-Demo.srt").write_text("\n\n".join(
        f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i, c in enumerate(captions)) + "\n")
    clips = "".join(f'<div id="cap-{i}" class="clip caption" data-start="{c["start"]:.3f}" data-duration="{c["end"]-c["start"]:.3f}" data-track-index="0"><span>{html.escape(c["text"])}</span></div>' for i, c in enumerate(captions))
    (P / "compositions/captions.html").write_text('<template><style>#root{width:100%;height:100%;position:relative;pointer-events:none}.caption{position:absolute;left:192px;right:192px;top:920px;text-align:center;font:400 36px/1.25 Montserrat,sans-serif;color:#f5f2ed}.caption span{display:inline-block;background:#121318;padding:7px 22px;border-radius:4px}</style><div id="root" data-composition-id="captions" data-duration="180" data-width="1920" data-height="1080">' + clips + '</div><script>const tl=gsap.timeline({paused:true});window.__timelines["captions"]=tl;</script></template>')
    (P / "review/lusaka-narration-alignment.json").write_text(json.dumps({"source": "Lusaka.m4a", "generated_voice": True, "scenes": decisions, "words": all_words}, indent=2))
    plan["status"] = "continuous_narration_generated_and_aligned"
    plan["voice_source"] = "Lusaka.m4a"
    plan["generated_voice"] = True
    (P / "narration-script.json").write_text(json.dumps(plan, indent=2))


if __name__ == "__main__":
    main()
