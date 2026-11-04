"""Download the local speech model without changing global model caches."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import subprocess

REPO = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit"
DEST = Path("/tmp/quorum-voice-model")


def main():
    metadata = json.loads(subprocess.check_output([
        "curl", "-4fsSL", "--retry", "2", "https://huggingface.co/api/models/" + REPO,
    ], text=True))
    names = [item["rfilename"] for item in metadata["siblings"]
             if item["rfilename"].endswith((".json", ".txt", ".safetensors"))]
    DEST.mkdir(parents=True, exist_ok=True)

    def fetch(name):
        output = DEST / name
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.is_file() and name not in ["config.json", "model.safetensors.index.json"]:
            return
        partial = output.with_name(output.name + ".partial")
        subprocess.run([
            "curl", "-4fLsS", "--retry", "4", "--retry-all-errors", "--connect-timeout", "15",
            "--speed-time", "30", "--speed-limit", "1000", "--continue-at", "-", "--output", str(partial),
            f"https://huggingface.co/{REPO}/resolve/main/{name}",
        ], check=True)
        partial.rename(output)
        print(f"Downloaded {name}: {output.stat().st_size / 1_000_000:.1f} MB", flush=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch, names))
    print(f"Ready: {DEST}", flush=True)


if __name__ == "__main__":
    main()
