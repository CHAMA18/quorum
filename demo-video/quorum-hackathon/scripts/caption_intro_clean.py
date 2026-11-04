"""Time spoken subtitles against the final cleaned voice, one scene at a time."""

from pathlib import Path
import argparse
import difflib
import html
import json
import os
import re

os.environ.setdefault("HF_HOME", "/tmp/quorum-voice-cache/hf")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import mlx.core as mx
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
from PIL import ImageFont
from mlx_audio.stt.utils import load_model

P = Path(__file__).resolve().parent.parent


def tokens(text):
    text = re.sub(r"\ba\s+i\b", "ai", text.lower()).replace("corum", "quorum")
    text = re.sub(r"\bm\s+c\s+p\b", "mcp", text)
    return re.findall(r"[a-z0-9]+", text)


def stamp(seconds):
    value = round(seconds * 1000)
    return f"{value//3600000:02}:{value//60000%60:02}:{value//1000%60:02},{value%1000:03}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reuse-transcripts", action="store_true")
    args = parser.parse_args()
    mx.set_cache_limit(64*1024*1024)
    mx.set_memory_limit(4*1024**3)
    mx.set_wired_limit(2*1024**3)
    plan = json.loads((P / "narration-script.json").read_text())
    rate, audio = wavfile.read(P / "assets/narration-intro-clean.wav")
    audio = audio.astype(np.float32) / (2**31)
    audio = resample_poly(audio, 1, 3).astype(np.float32)
    recognizer = None if args.reuse_transcripts else load_model("/tmp/quorum-whisper")
    words, reports = [], []
    for scene in plan["scenes"]:
        start, end = scene["start"], scene["end"]
        if args.reuse_transcripts:
            segments = json.loads((P / f"review/intro-clean-{scene['id']}-words.json").read_text())["segments"]
        else:
            result = recognizer.generate(audio[start*16000:end*16000], language="en", temperature=0.0,
                                         word_timestamps=True, condition_on_previous_text=False,
                                         initial_prompt="Quorum, faulty procurement, US dollars, AI, MCP, Meta-powered document review.", verbose=None)
            segments = result.segments
        segment_words = [dict(word) for segment in segments for word in segment.get("words", [])]
        for word in segment_words:
            word["word"] = word["word"].strip().replace("Corum", "Quorum").replace("corum", "Quorum")
        if scene["id"] == "opening":
            for i, word in enumerate(segment_words[:-1]):
                if word["word"].strip(".,").lower() == "40" and segment_words[i+1]["word"].lower().startswith("procurement"):
                    word["word"] = "faulty"
        raw_transcript = " ".join(word["word"] for word in segment_words)
        # Correct recognizer spellings from the established spoken script without moving words.
        for word in segment_words:
            word["word"] = re.sub(r"\bAEI\b", "AI", word["word"])
            if scene["id"] == "control":
                word["word"] = re.sub(r"\bauthorizes\b", "authorised", word["word"])
        transcript = " ".join(word["word"] for word in segment_words)
        match = difflib.SequenceMatcher(a=tokens(scene["text"]), b=tokens(transcript)).ratio()
        report = {"scene": scene["id"], "expected": scene["text"], "transcript": transcript,
                  "raw_transcript": raw_transcript, "word_match": match, "segments": segments}
        reports.append(report)
        (P / f"review/intro-clean-{scene['id']}-words.json").write_text(json.dumps(report, indent=2))
        if match < .9:
            raise RuntimeError(f"Review cleaned {scene['id']} speech: transcript match {match:.3f}")
        required = {"supplier": "decide", "review": "fill", "control": "write"}
        if scene["id"] in required:
            phrase = required[scene["id"]]
            assert re.search(r"does(?:n't| not)\s+" + phrase, transcript.lower()), "Verify spoken negation in " + scene["id"]
        for word in segment_words:
            if word["word"]:
                words.append({"text": word["word"], "start": word["start"] + start,
                              "end": word["end"] + start, "scene": scene["id"]})
        print(f"Verified cleaned {scene['id']}: {match:.3f}", flush=True)
    font = ImageFont.truetype(str(P / "assets/fonts/Montserrat.ttf"), 36)
    font.set_variation_by_axes([400])
    bad_ends = {"a", "an", "the", "and", "or", "to", "of", "that", "required", "reference", "committed"}
    captions, cursor = [], 0
    while cursor < len(words):
        stop = cursor
        while stop < len(words) and words[stop]["scene"] == words[cursor]["scene"]:
            candidate = " ".join(word["text"] for word in words[cursor:stop+1])
            if stop > cursor and (stop - cursor >= 12 or font.getlength(candidate) > 1440):
                break
            stop += 1
            if stop - cursor >= 3 and re.search(r"[.!?]$", words[stop-1]["text"]):
                break
        if stop <= cursor:
            stop = cursor + 1
        for _ in range(4):
            if stop - cursor > 4 and words[stop-1]["text"].lower().strip(".,:;") in bad_ends:
                stop -= 1
            else:
                break
        group = words[cursor:stop]
        text = " ".join(word["text"] for word in group)
        text = re.sub(r"\bA\s+I\b", "AI", text)
        text = re.sub(r"\bM\s+C\s+P\b", "MCP", text)
        text = re.sub(r"\s+-", "-", text)
        text = re.sub(r"(\d)\s+%", r"\1%", text)
        next_start = words[stop]["start"] if stop < len(words) else 179.3
        captions.append({"text": text, "start": group[0]["start"],
                         "end": min(group[-1]["end"] + .25, next_start - .035),
                         "kind": "spoken", "scene": group[0]["scene"]})
        cursor = stop
    # The first line follows the speech onset, rather than a recognizer's late first-word boundary.
    first_window = audio[:16000]
    blocks = first_window[:len(first_window)//160*160].reshape(-1,160)
    active = np.flatnonzero(np.sqrt(np.mean(blocks**2, axis=1)) > .008)
    if active.size:
        captions[0]["start"] = min(captions[0]["start"], max(.08, active[0] * .01))
    assert all(c["end"] > c["start"] for c in captions), "Invalid caption timing"
    assert all(a["end"] <= b["start"] for a,b in zip(captions,captions[1:])), "Overlapping captions"
    (P / "captions.json").write_text(json.dumps(captions, indent=2))
    (P / "Quorum-Demo.srt").write_text("\n\n".join(
        f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(captions)) + "\n")
    clips = "".join(f'<div id="cap-{i}" class="clip caption" data-start="{c["start"]:.3f}" data-duration="{c["end"]-c["start"]:.3f}" data-track-index="0"><span>{html.escape(c["text"])}</span></div>' for i,c in enumerate(captions))
    (P / "compositions/captions.html").write_text('<template><style>#root{width:100%;height:100%;position:relative;pointer-events:none}.caption{position:absolute;left:192px;right:192px;top:920px;text-align:center;font:400 36px/1.25 Montserrat,sans-serif;color:#f5f2ed}.caption span{display:inline-block;background:#121318;padding:7px 22px;border-radius:4px}</style><div id="root" data-composition-id="captions" data-duration="180" data-width="1920" data-height="1080">' + clips + '</div><script>const tl=gsap.timeline({paused:true});window.__timelines["captions"]=tl;</script></template>')
    (P / "review/intro-clean-caption-verification.json").write_text(json.dumps({"scenes": [{k:s[k] for k in ["scene","expected","transcript","word_match"]} for s in reports], "words": words, "captions": len(captions)}, indent=2))
    print(f"Prepared {len(captions)} captions timed against the cleaned voice.", flush=True)


if __name__ == "__main__":
    main()
