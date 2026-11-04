"""Add the recorded intro and rebuild a noise-reduced, three-minute voice stem."""

from pathlib import Path
import json
import re
import subprocess
import numpy as np
from scipy.io import wavfile
from scipy.signal import correlate, resample_poly

P = Path(__file__).resolve().parent.parent
RATE = 48000
STARTS = {"opening": 0, "supplier": 12, "workflow": 45, "review": 77, "control": 125, "mcp": 152}
ENDS = {"opening": 12, "supplier": 45, "workflow": 77, "review": 125, "control": 152, "mcp": 180}


def read(path):
    rate, data = wavfile.read(path)
    scale = float(2 ** (data.dtype.itemsize * 8 - 1)) if data.dtype.kind == "i" else 1
    return rate, data.astype(np.float32) / scale


def delay(raw, cleaned, rate=RATE):
    a, b = raw[4*rate:8*rate], cleaned[4*rate:8*rate]
    correlation = correlate(b, a, mode="full", method="fft")
    centre, limit = len(a) - 1, round(.05 * rate)
    return int(np.argmax(correlation[centre-limit:centre+limit+1]) - limit)


def compensate(data, samples):
    if samples > 0:
        return np.pad(data[samples:], (0, samples))
    if samples < 0:
        return np.pad(data[:samples], (-samples, 0))
    return data


def main():
    _, old_voice = read(P / "assets/narration-lusaka.wav")
    _, cleaned = read(P / "assets/narration-denoised-unaligned.wav")
    body_delay = delay(old_voice, cleaned)
    cleaned = compensate(cleaned, body_delay)
    raw_rate, intro_raw = read(P / "review/meta-intro-source.wav")
    _, intro_clean = read(P / "review/meta-intro-denoise-test.wav")
    intro_raw = resample_poly(intro_raw, RATE // raw_rate, 1)
    intro_delay = delay(intro_raw, intro_clean)
    intro_clean = compensate(intro_clean, intro_delay)
    source_intro = intro_clean[round(3.2 * RATE):round(13.2 * RATE)]
    wavfile.write(P / "assets/intro-recorded-denoised.wav", RATE, source_intro)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i",
                    str(P / "assets/intro-recorded-denoised.wav"), "-af",
                    "loudnorm=I=-18:TP=-2:LRA=11,aresample=48000", "-c:a", "pcm_s24le",
                    str(P / "assets/intro-recorded-levelled.wav")], check=True)
    _, levelled_intro = read(P / "assets/intro-recorded-levelled.wav")
    output = np.zeros(180 * RATE, dtype=np.float32)
    intro_at = round(.12 * RATE)
    output[intro_at:intro_at + len(levelled_intro)] = levelled_intro
    bridge = cleaned[round(14.38 * RATE):round(15.8 * RATE)].copy()
    edge = round(.005 * RATE)
    bridge[:edge] *= np.linspace(0, 1, edge)
    bridge[-edge:] *= np.linspace(1, 0, edge)
    bridge_at = round(10.30 * RATE)
    output[bridge_at:bridge_at + len(bridge)] = bridge
    output[12*RATE:152*RATE] = cleaned[16*RATE:156*RATE]
    original_alignment = json.loads((P / "review/lusaka-narration-alignment.json").read_text())
    words = [word for word in original_alignment["words"] if word["scene"] == "mcp"]
    boundaries = []
    word_count = 0
    for previous, following in zip(words, words[1:]):
        word_count += 1
        if re.search(r"[.!?]$", previous["text"]) and word_count >= 3:
            boundaries.append((previous["end"] + following["start"]) / 2)
            word_count = 0
    assert boundaries, "No safe sentence boundaries in the MCP narration"
    added_pause = 4 / len(boundaries)
    cuts = [156.0] + boundaries + [180.0]
    destination = 152.0
    for index, (a, b) in enumerate(zip(cuts, cuts[1:])):
        chunk = cleaned[round(a*RATE):round(b*RATE)].copy()
        chunk[:edge] *= np.linspace(0, 1, edge)
        chunk[-edge:] *= np.linspace(1, 0, edge)
        sample = round(destination * RATE)
        output[sample:sample + len(chunk)] = chunk
        destination += len(chunk) / RATE + (added_pause if index < len(cuts)-2 else 0)
    assert abs(destination - 180) < .001, destination
    wavfile.write(P / "assets/narration-intro-clean-raw.wav", RATE, output)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i",
                    str(P / "assets/narration-intro-clean-raw.wav"), "-af",
                    "loudnorm=I=-18:TP=-2:LRA=11,aresample=48000", "-c:a", "pcm_s24le",
                    str(P / "assets/narration-intro-clean.wav")], check=True)
    plan = json.loads((P / "narration-script.json").read_text())
    for scene in plan["scenes"]:
        scene["start"], scene["end"] = STARTS[scene["id"]], ENDS[scene["id"]]
        if scene["id"] == "opening":
            scene["text"] = "Over 450 million US dollars is lost every year due to faulty procurement means. Through Quorum, we seek to address this challenge. Let me show you how it works."
    plan.update({"status": "intro_and_clean_voice_prepared", "delivery_file": "Quorum-Hackathon-Demo-Intro-Clean.mp4",
                 "voice_sources": ["Meta Hackathon.mp4 — recorded opening", "Lusaka.m4a — existing cloned narration"],
                 "voice_noise_reduction": "RNNoise on the separate speech stem; music is mixed afterwards"})
    (P / "narration-script.json").write_text(json.dumps(plan, indent=2))
    index = P / "index.html"
    text = index.read_text()
    def host(match):
        tag = match.group()
        for name in STARTS:
            if re.search(r'(?<![-\w])id="' + name + '"', tag):
                duration = ENDS[name] - STARTS[name] + (.4 if name != "mcp" else 0)
                tag = re.sub(r'data-start="[^"]+"', f'data-start="{STARTS[name]}"', tag)
                tag = re.sub(r'data-duration="[^"]+"', f'data-duration="{duration:g}"', tag)
                break
        return tag
    text = re.sub(r'<div\b[^>]*data-composition-src="[^"]+"[^>]*>', host, text)
    for old, new in [(16,12),(49,45),(81,77),(129,125),(156,152)]:
        text = text.replace('},' + str(old) + ');', '},' + str(new) + ');')
    text = text.replace("assets/master-lusaka.wav", "assets/master-intro-clean.wav")
    index.write_text(text)
    (P / "compositions/opening.html").write_text('''<template><style>*{box-sizing:border-box;margin:0}#root{width:100%;height:100%;position:relative;overflow:hidden;background:#121318}video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}</style><div id="root" data-composition-id="opening" data-duration="12.4" data-width="1920" data-height="1080"><video id="opening-v0" class="clip" src="assets/meta-intro-picture.mp4" muted playsinline data-start="0" data-duration="12.4" data-track-index="0"></video></div><script>const tl=gsap.timeline({paused:true});window.__timelines["opening"]=tl;</script></template>''')
    mcp = P / "compositions/mcp.html"
    text = mcp.read_text().replace('data-duration="24"', 'data-duration="28"').replace('14.3','18.3').replace('14.5','18.5')
    mcp.write_text(text)
    def rms(data):
        return float(20*np.log10(np.sqrt(np.mean(data*data)) + 1e-12))
    report = {"recorded_intro_source": "Meta Hackathon.mp4", "recorded_intro_range": [3.2,13.2],
              "recorded_intro_position": .12, "bridge_source": "previous voice track, 14.38–15.8 seconds",
              "bridge_position": 10.30, "body_shift_seconds": -4, "mcp_added_seconds": 4,
              "mcp_sentence_boundaries": boundaries, "mcp_added_pause_seconds": added_pause,
              "body_denoiser_delay_compensated_samples": body_delay,
              "intro_denoiser_delay_compensated_samples": intro_delay,
              "noise_test_before_dbfs": rms(intro_raw[round(.4*RATE):round(2.5*RATE)]),
              "noise_test_after_dbfs": rms(intro_clean[round(.4*RATE):round(2.5*RATE)]),
              "speech_tempo_changed": False, "music_denoised": False,
              "scene_starts": STARTS, "scene_ends": ENDS}
    (P / "review/intro-clean-edit-plan.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
