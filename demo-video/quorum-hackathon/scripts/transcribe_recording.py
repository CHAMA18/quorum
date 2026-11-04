"""Transcribe a supplied recording using the project's configured Meta ASR."""

from pathlib import Path
import argparse
import json
import re
import subprocess
import urllib.error
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    env = dict(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", (project.parents[1] / ".env.local").read_text(), re.M))
    env = {key: value.strip().strip('"').strip("'") for key, value in env.items()}
    key = env.get("MUSE_API_KEY") or env.get("LLM_API_KEY")
    if not key:
        raise SystemExit("The project's Meta ASR key is not configured.")
    # A seekable file gives the WAV header an exact sample count.
    temporary = project / "review" / ("transcription-" + args.source.stem + ".wav")
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(args.source),
        "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(temporary),
    ], check=True)
    wav = temporary.read_bytes()
    boundary = "quorum-" + uuid.uuid4().hex
    settings = {"model": env.get("MUSE_VOICE_MODEL", "muse-voice-transcribe-1.0"),
                "audioEncoding": "WAV", "mode": "ENDPOINTING", "languageBias": ["English"],
                "keywords": ["Quorum", "Meta", "procurement", "MCP", "Muse Spark"]}
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n'.encode()
            + json.dumps(settings).encode()
            + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
            + wav + f'\r\n--{boundary}--\r\n'.encode())
    request = urllib.request.Request(
        env.get("MUSE_BASE_URL", "https://api.meta.ai/v1").rstrip("/") + "/asr/transcribe",
        data=body, headers={"Authorization": "Bearer " + key,
                            "Accept": "application/json", "Content-Type": "multipart/form-data; boundary=" + boundary},
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Meta ASR returned HTTP {error.code}; credentials were not printed.") from None
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
