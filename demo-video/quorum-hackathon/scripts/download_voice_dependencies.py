"""Fetch resolved Apple Silicon wheels through an IPv4 connection."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import re
import subprocess
import sys

DEST = Path("/tmp/quorum-voice-wheels")


def supported(filename):
    if not filename.endswith(".whl"):
        return False
    python, abi, platform = filename[:-4].split("-")[-3:]
    if platform == "any":
        return any(tag in {"py3", "py2.py3", "py310", "py311", "py312"} for tag in python.split("."))
    if "macosx" not in platform or not any(arch in platform for arch in ["arm64", "universal2"]):
        return False
    if python == "py3" and abi == "none":
        return True
    if python == "cp312" and abi in ["cp312", "abi3"]:
        return True
    return abi == "abi3" and python.startswith("cp3") and int(python[3:]) <= 12


def fetch(requirement):
    name, version = requirement.split("==")
    metadata = json.loads(subprocess.check_output([
        "curl", "-4fsSL", "--retry", "3", "--connect-timeout", "15",
        f"https://pypi.org/pypi/{name}/{version}/json",
    ], text=True))
    wheels = [item for item in metadata["urls"] if supported(item["filename"])]
    if not wheels:
        raise RuntimeError(f"No supported wheel for {requirement}")
    wheel = sorted(wheels, key=lambda item: ("arm64" not in item["filename"], len(item["filename"])))[0]
    output = DEST / wheel["filename"]
    if output.exists() and output.stat().st_size == wheel["size"]:
        return
    subprocess.run([
        "curl", "-4fLsS", "--http1.1", "--retry", "4", "--retry-all-errors", "--connect-timeout", "15",
        "--speed-time", "20", "--speed-limit", "100000", "--continue-at", "-", "--output", str(output), wheel["url"],
    ], check=True)
    if output.stat().st_size != wheel["size"]:
        raise RuntimeError(f"Incomplete download: {output.name}")
    print(f"Ready {requirement}: {output.stat().st_size / 1e6:.1f} MB", flush=True)


def main():
    DEST.mkdir(exist_ok=True)
    requirements = re.findall(r"^([a-zA-Z0-9_-]+==[^\s]+)$", Path("/tmp/quorum-voice-requirements.txt").read_text(), re.M)
    if len(sys.argv) > 1:
        requirements = [item for item in requirements if item in sys.argv[1:]]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, requirements))
    print("All voice-engine wheels downloaded.", flush=True)


if __name__ == "__main__":
    main()
