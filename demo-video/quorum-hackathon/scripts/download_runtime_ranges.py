"""Resume the two remaining runtime wheels in verified HTTP byte ranges."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path("/tmp/quorum-voice-wheels")


def download(item):
    output = ROOT / item["filename"]
    size = item["size"]
    if output.exists() and output.stat().st_size == size:
        return
    prefix = output.stat().st_size if output.exists() else 0
    chunk_size = 1024 * 1024
    chunks = [(start, min(size, start + chunk_size)) for start in range(prefix, size, chunk_size)]

    def get(part):
        start, end = part
        target = ROOT / f"{output.name}.{start}.part"
        if not target.exists() or target.stat().st_size != end - start:
            subprocess.run(["curl", "-4fLsS", "--connect-timeout", "10", "--max-time", "90",
                            "--retry", "3", "--retry-all-errors", "--range", f"{start}-{end-1}",
                            "--max-filesize", str(chunk_size * 2), "--output", str(target), item["url"]], check=True)
        if target.stat().st_size != end - start:
            raise RuntimeError("Invalid response length for " + target.name)
        print(f"Ready {output.name} bytes {start}-{end}", flush=True)
        return target

    with ThreadPoolExecutor(max_workers=12) as pool:
        parts = list(pool.map(get, chunks))
    with output.open("ab") as final:
        for part in parts:
            final.write(part.read_bytes())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    if output.stat().st_size != size or digest != item["digests"]["sha256"]:
        raise RuntimeError("Wheel integrity check failed: " + output.name)
    for part in parts:
        part.unlink()
    print(f"Verified {output.name}", flush=True)


if __name__ == "__main__":
    metal = json.loads(Path("/tmp/quorum-metal-meta.json").read_text())
    pillow = json.loads(Path("/tmp/quorum-pillow-meta.json").read_text())
    choices = [next(x for x in metal["urls"] if "macosx_14_0_arm64" in x["filename"]),
               next(x for x in pillow["urls"] if "cp312-cp312-macosx_11_0_arm64" in x["filename"])]
    for choice in choices:
        download(choice)
