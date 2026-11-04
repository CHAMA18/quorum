"""Mix narration and music with voice-driven spectral carving and gentle ducking."""

from pathlib import Path
import json
import subprocess
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

P = Path(__file__).resolve().parent.parent
RATE = 48000


def main(voice_filename="assets/narration-lusaka.wav", music_filename="assets/music-lusaka-carved.wav",
         master_filename="assets/master-lusaka.wav", report_filename="review/lusaka-mix.json",
         update_index=True, voice_denoising=False):
    rate, voice = wavfile.read(P / voice_filename)
    if rate != RATE:
        raise RuntimeError("Narration must be 48 kHz")
    if voice.dtype.kind == "i":
        voice = voice.astype(np.float32) / float(2 ** (voice.dtype.itemsize * 8 - 1))
    duration = len(voice) / RATE
    music_bytes = subprocess.check_output([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", "33", "-i",
        str(P / "assets/signal-to-noise.mp3"), "-t", str(duration), "-af",
        "highpass=f=80,loudnorm=I=-28:TP=-8:LRA=10,aresample=48000", "-ar", "48000",
        "-ac", "2", "-f", "f32le", "pipe:1",
    ])
    music = np.frombuffer(music_bytes, dtype=np.float32).reshape(-1, 2).copy()
    if len(music) < len(voice):
        raise RuntimeError("Music source does not cover the narration duration")
    count = len(voice)
    voice, music = voice[:count], music[:count]
    block = 960
    rms = np.sqrt(np.mean(voice[:count // block * block].reshape(-1, block) ** 2, axis=1) + 1e-12)
    activity = np.clip((20 * np.log10(rms + 1e-8) + 48) / 24, 0, 1)
    envelope, current = [], 0.0
    for target in activity:
        coefficient = np.exp(-.02 / (.035 if target > current else .65))
        current = coefficient * current + (1 - coefficient) * target
        envelope.append(current)
    envelope = np.interp(np.arange(count), np.arange(len(envelope)) * block, envelope).astype(np.float32)
    presence = sosfilt(butter(2, [250, 4000], btype="bandpass", fs=RATE, output="sos"), music, axis=0)
    music -= (presence * (.65 * envelope[:, None])).astype(np.float32)
    music *= (10 ** ((-8 * envelope) / 20))[:, None]
    time = np.arange(count, dtype=np.float32) / RATE
    music *= (np.minimum(time / 1.5, 1) * np.clip((duration - time) / 5, 0, 1))[:, None]
    wavfile.write(P / music_filename, RATE, music.astype(np.float32))
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(P / voice_filename),
        "-i", str(P / music_filename), "-filter_complex",
        "[0:a]aformat=channel_layouts=stereo[voice];[voice][1:a]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=10,aresample=48000[mix]",
        "-map", "[mix]", "-t", str(duration), "-c:a", "pcm_s24le", str(P / master_filename),
    ], check=True)
    if update_index:
        index = P / "index.html"
        text = index.read_text().replace("assets/master-delivery.wav", master_filename)
        index.write_text(text)
    (P / report_filename).write_text(json.dumps({
        "voice": voice_filename, "music": music_filename,
        "master": master_filename, "duration_seconds": duration, "target_lufs": -16, "true_peak_ceiling_dbtp": -1.5,
        "music_carve": {"detector": "voice RMS", "presence_band_hz": [250, 4000],
                        "max_presence_reduction_db": -9.1, "max_broadband_duck_db": -8,
                        "attack_seconds": .035, "release_seconds": .65},
        "voice_tempo_changed": False, "voice_denoising": voice_denoising,
    }, indent=2))
    print("Full-length voice-first master prepared.")


if __name__ == "__main__":
    main()
