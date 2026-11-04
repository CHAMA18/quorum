"""Remove three awkward clauses and preserve scene timing with sentence pauses."""

from pathlib import Path
import json
import re
import shutil
import subprocess
import numpy as np
from scipy.io import wavfile

P = Path(__file__).resolve().parent.parent
RATE = 48000


def main():
    source = P / "assets/narration-intro-clean.wav"
    backup = P / "assets/narration-intro-clean-before-phrase-fixes.wav"
    if not backup.exists():
        shutil.copy2(source, backup)
    rate, data = wavfile.read(backup)
    assert rate == RATE
    audio = data.astype(np.float32) / (2**31)
    result = audio.copy()
    verification = json.loads((P / "review/intro-clean-caption-verification.json").read_text())
    plan = json.loads((P / "narration-script.json").read_text())
    requests = {
        "supplier": (41.66, 42.88, "certify the document or", "It doesn't certify the document or decide whether the supplier qualifies.", "It doesn't decide whether the supplier qualifies."),
        "review": (103.84, 105.86, "or quietly treat it as a pass", "It doesn't fill in the gap or quietly treat it as a pass.", "It doesn't fill in the gap."),
        "control": (136.58, 137.44, "rank bidders", "The AI doesn't write those scores, rank bidders, or award the tender.", "The AI doesn't write those scores or award the tender."),
    }
    decisions = []
    for scene in plan["scenes"]:
        if scene["id"] not in requests:
            continue
        cut_start, cut_end, phrase, before, after = requests[scene["id"]]
        words = [word for word in verification["words"] if word["scene"] == scene["id"]]
        pauses = []
        for previous, following in zip(words, words[1:]):
            if re.search(r"[.!?]$", previous["text"]) and not cut_start <= previous["end"] <= cut_end + .1:
                pauses.append((previous["end"] + following["start"]) / 2)
        assert pauses
        extra = (cut_end - cut_start) / len(pauses)
        points = sorted(set([float(scene["start"]), float(scene["end"]), cut_start, cut_end] + pauses))
        destination = round(scene["start"] * RATE)
        section = np.zeros(round((scene["end"] - scene["start"]) * RATE), dtype=np.float32)
        cursor = 0
        edge = round(.006 * RATE)
        for a,b in zip(points, points[1:]):
            if a >= cut_start - .0001 and b <= cut_end + .0001:
                continue
            chunk = audio[round(a*RATE):round(b*RATE)].copy()
            size = min(edge, len(chunk)//2)
            if size:
                chunk[:size] *= np.linspace(0,1,size)
                chunk[-size:] *= np.linspace(1,0,size)
            section[cursor:cursor+len(chunk)] = chunk
            cursor += len(chunk)
            if any(abs(b - pause) < .0001 for pause in pauses):
                cursor += round(extra * RATE)
        assert abs(cursor - len(section)) < 8, (scene["id"],cursor,len(section))
        result[destination:destination+len(section)] = section
        scene["text"] = scene["text"].replace(before, after)
        decisions.append({"scene": scene["id"], "removed_clause": phrase, "source_range": [cut_start,cut_end],
                          "sentence_pause_addition_seconds": extra, "scene_duration_preserved": True})
    subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","f32le","-ar","48000",
                    "-ac","1","-i","pipe:0","-c:a","pcm_s24le",str(source)], input=result.tobytes(), check=True)
    (P / "narration-script.json").write_text(json.dumps(plan, indent=2))
    (P / "review/intro-clean-phrase-edits.json").write_text(json.dumps(decisions, indent=2))
    print(json.dumps(decisions, indent=2))


if __name__ == "__main__":
    main()
