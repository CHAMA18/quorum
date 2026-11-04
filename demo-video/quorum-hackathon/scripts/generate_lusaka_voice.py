"""Generate scene narration locally from the user-supplied Lusaka reference."""

from pathlib import Path
import argparse
import json
import os
import time
import traceback
import faulthandler

os.environ.setdefault("HF_HOME", "/tmp/quorum-voice-cache/hf")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import mlx.core as mx
import numpy as np
from scipy.io import wavfile
from mlx_audio.tts.utils import load_model

PROJECT = Path(__file__).resolve().parent.parent
REFERENCE_TEXT = "So that's what we need to understand is how best can we create content that is of value to the whole world."


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", action="append")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    scenes = json.loads((PROJECT / "narration-script.json").read_text())["scenes"]
    output = PROJECT / "assets" / "lusaka-narration"
    output.mkdir(parents=True, exist_ok=True)
    mx.set_cache_limit(64 * 1024 * 1024)
    mx.set_memory_limit(6 * 1024 ** 3)
    mx.set_wired_limit(4 * 1024 ** 3)
    print("Loading local Qwen3-TTS voice model...", flush=True)
    model = load_model("/tmp/quorum-voice-model", lazy=True)
    mx.clear_cache()
    for index, scene in enumerate(scenes):
        if args.scene and scene["id"] not in args.scene:
            continue
        destination = output / (scene["id"] + ".wav")
        if destination.exists() and not args.scene:
            print(f"Keeping existing {destination.name}", flush=True)
            continue
        mx.random.seed(args.seed + index)
        started = time.monotonic()
        print(f"Generating {scene['id']}...", flush=True)
        text = scene["text"].replace("MCP", "M C P").replace("AI", "A I")
        parts = list(model.generate(
            text=text,
            ref_audio=str(PROJECT / "assets" / "lusaka-reference.wav"),
            ref_text=REFERENCE_TEXT,
            lang_code="english",
            temperature=0.8,
            top_p=0.95,
            repetition_penalty=1.05,
            max_tokens=1800,
            verbose=False,
        ))
        if not parts:
            raise RuntimeError(f"No speech was produced for {scene['id']}")
        sample_rate = parts[0].sample_rate
        audio = np.concatenate([np.asarray(part.audio).reshape(-1) for part in parts])
        wavfile.write(destination, sample_rate, audio.astype(np.float32))
        metadata = {
            "scene": scene["id"], "text": scene["text"], "synthesis_text": text,
            "source": "Lusaka.m4a", "reference_range": [31.58, 38.86],
            "reference_text": REFERENCE_TEXT,
            "model": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit",
            "seed": args.seed + index, "sample_rate": sample_rate,
            "duration_seconds": len(audio) / sample_rate,
            "generation_seconds": round(time.monotonic() - started, 2),
            "generated_voice": True,
        }
        destination.with_suffix(".json").write_text(json.dumps(metadata, indent=2))
        print(json.dumps(metadata), flush=True)
        mx.clear_cache()


if __name__ == "__main__":
    faulthandler.enable()
    try:
        main()
    except BaseException:
        (PROJECT / "review/lusaka-generation-error.txt").write_text(traceback.format_exc())
        raise
