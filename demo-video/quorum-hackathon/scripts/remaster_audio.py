"""Remove residual hiss/noise and rebuild the Quorum demo soundtrack.

The picture is never re-encoded.  The delivered AAC is replaced with a freshly
mixed 48 kHz stereo master built from the existing narration and the original
licensed music: tone-matched recorded speech, de-essed sibilance, a gentler and
lower music bed, EBU R128 loudness, and true-peak safe limiting.
"""

from pathlib import Path
import json
import math
import re
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, sosfiltfilt

P = Path(__file__).resolve().parent.parent
RATE = 48000
DURATION = 230.0
SOURCE = P / "Quorum-Hackathon-Demo-4K-3m50-Voice-Fixed.mp4"
BACKUP = P / "revisions/Quorum-Hackathon-Demo-4K-3m50-before-noise-removal.mp4"
NAMED = P / "Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4"
MIX = P / "work/noise-free-mix.wav"
MASTER = P / "work/master-noise-free.wav"
REPORT = P / "review/audio-noise-removal.json"

VOICE_SECTIONS = (("opening", 0, 12), ("supplier", 12, 45), ("workflow", 45, 77),
                  ("review", 77, 125), ("recommendation", 125, 175),
                  ("control", 175, 202), ("mcp", 202, 230))
RECORDED = ((0, 12), (125, 175))


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def load(path):
    rate, data = wavfile.read(path)
    if data.dtype.kind == "i":
        data = data.astype(np.float32) / float(2 ** (8 * data.dtype.itemsize - 1))
    else:
        data = data.astype(np.float32)
    return rate, data


def db(value):
    return 20.0 * np.log10(np.maximum(value, 1e-12))


def biquad_peaking(fs, f0, q, gain_db):
    a_amp = 10 ** (gain_db / 40.0)
    w = 2 * math.pi * f0 / fs
    alpha = math.sin(w) / (2 * q)
    b = [1 + alpha * a_amp, -2 * math.cos(w), 1 - alpha * a_amp]
    a = [1 + alpha / a_amp, -2 * math.cos(w), 1 - alpha / a_amp]
    return np.array(b) / a[0], np.array(a) / a[0]


def biquad_high_shelf(fs, f0, gain_db, slope=1.0):
    a_amp = 10 ** (gain_db / 40.0)
    w = 2 * math.pi * f0 / fs
    alpha = math.sin(w) / 2 * math.sqrt((a_amp + 1 / a_amp) * (1 / slope - 1) + 2)
    c = math.cos(w)
    root = math.sqrt(a_amp)
    b0 = a_amp * ((a_amp + 1) + (a_amp - 1) * c + 2 * root * alpha)
    b1 = -2 * a_amp * ((a_amp - 1) + (a_amp + 1) * c)
    b2 = a_amp * ((a_amp + 1) + (a_amp - 1) * c - 2 * root * alpha)
    a0 = (a_amp + 1) - (a_amp - 1) * c + 2 * root * alpha
    a1 = 2 * ((a_amp - 1) - (a_amp + 1) * c)
    a2 = (a_amp + 1) - (a_amp - 1) * c - 2 * root * alpha
    return np.array([b0, b1, b2]) / a0, np.array([a0, a1, a2]) / a0


def apply_biquad(x, coeffs):
    b, a = coeffs
    return sosfilt(np.array([[b[0], b[1], b[2], 1.0, a[1], a[2]]]), x).astype(np.float32)


def band_energy(segment, rate, bands=None):
    from scipy.signal import welch
    mono = segment.mean(axis=1) if segment.ndim > 1 else segment
    f, power = welch(mono.astype(np.float64), rate, nperseg=8192)
    bands = bands or {"low": (60, 250), "mid": (250, 1000), "pres": (1000, 4000),
                      "sib": (5000, 9000), "air": (9000, 16000)}
    return {name: float(10 * np.log10(power[(f >= lo) & (f < hi)].mean() + 1e-30))
            for name, (lo, hi) in bands.items()}


def k_weight(x, rate):
    # ITU-R BS.1770-4 K-weighting, coefficients for 48 kHz.
    b1 = np.array([1.53512485958697, -2.69169618940638, 1.19839281085285])
    a1 = np.array([1.0, -1.69065929318241, 0.73248077421585])
    b2 = np.array([1.0, -2.0, 1.0])
    a2 = np.array([1.0, -1.99004745483398, 0.99007225036621])
    y = sosfilt(np.array([[b1[0], b1[1], b1[2], 1.0, a1[1], a1[2]]]), x, axis=0)
    return sosfilt(np.array([[b2[0], b2[1], b2[2], 1.0, a2[1], a2[2]]]), y, axis=0)


def integrated_loudness(x, rate):
    """BS.1770-4 gated integrated loudness (L/R weights 1.0)."""
    y = k_weight(np.asarray(x, dtype=np.float64), rate)
    if y.ndim == 1:
        y = y[:, None]
    block = int(round(0.4 * rate))
    hop = int(round(0.1 * rate))
    if len(y) < block:
        return -70.0
    power = np.array([np.mean(y[i:i + block] ** 2, axis=0) for i in range(0, len(y) - block + 1, hop)])
    total = power.sum(axis=1)
    with np.errstate(divide="ignore"):
        loud = -0.691 + 10 * np.log10(total + 1e-30)
    loud = loud[total > 0]
    if not len(loud):
        return -70.0
    absolute = loud[loud > -70.0]
    if not len(absolute):
        return -70.0
    relative = -0.691 + 10 * np.log10(np.mean(10 ** ((absolute + 0.691) / 10)) ) - 10.0
    gated = absolute[absolute > relative]
    if not len(gated):
        gated = absolute
    return float(-0.691 + 10 * np.log10(np.mean(10 ** ((gated + 0.691) / 10))))


def true_peak(x, rate, oversample=4):
    from scipy.signal import resample_poly
    peak = 0.0
    for channel in range(x.shape[1]):
        up = resample_poly(x[:, channel].astype(np.float64), oversample, 1)
        peak = max(peak, float(np.max(np.abs(up))))
    return 20 * math.log10(max(peak, 1e-12))


def true_peak_envelope(x, rate, oversample=4, chunk=1.0):
    """Per-sample inter-sample peak estimate for a stereo signal."""
    from scipy.signal import resample_poly
    size = int(chunk * rate)
    channels = []
    for channel in range(x.shape[1]):
        pieces = []
        for start in range(0, len(x), size):
            stop = min(len(x), start + size)
            pad_a, pad_b = 64, 64
            a, b = max(0, start - pad_a), min(len(x), stop + pad_b)
            up = resample_poly(x[a:b, channel].astype(np.float64), oversample, 1)
            begin = (start - a) * oversample
            end = begin + (stop - start) * oversample
            up = up[begin:end]
            up = up[:len(up) // oversample * oversample].reshape(-1, oversample)
            pieces.append(np.max(np.abs(up), axis=1))
        channels.append(np.concatenate(pieces)[:len(x)])
    return np.max(np.stack(channels, axis=1), axis=1)


def limit_true_peak(x, rate, ceiling_db=-1.6):
    """Look-ahead peak limiter that keeps inter-sample peaks under ceiling."""
    from scipy.ndimage import maximum_filter1d
    ceiling = 10 ** (ceiling_db / 20)
    envelope = true_peak_envelope(x, rate)
    block = 240  # 5 ms
    count = len(x) // block
    peaks = envelope[:count * block].reshape(-1, block).max(axis=1)
    # Look ahead by two blocks so gain is already down when the peak arrives.
    peaks = maximum_filter1d(peaks, size=5, mode="nearest")
    gain_db = 20 * np.log10(np.clip(ceiling / np.maximum(peaks, 1e-9), 0, 1) + 1e-9)
    gain_db = np.r_[gain_db[2:], np.repeat(gain_db[-1], 2)]
    gain_db = smooth_gain_db(gain_db, 1.0 / 0.005, 0.003, 0.080)
    gain = 10 ** (gain_db / 20)
    gain = np.interp(np.arange(len(x)), np.arange(count) * block + block / 2, gain,
                     left=gain[0], right=gain[-1]).astype(np.float32)
    return x * gain[:, None]


def smooth_gain_db(target_db, rate, attack, release):
    """One-pole attack/release on a dB gain curve, block-wise."""
    out = np.empty_like(target_db)
    current = target_db[0]
    ca = math.exp(-1 / (attack * rate))
    cr = math.exp(-1 / (release * rate))
    for i, value in enumerate(target_db):
        coefficient = ca if value < current else cr
        current = coefficient * current + (1 - coefficient) * value
        out[i] = current
    return out


def deess(x, rate, amount, threshold_pct=94, band=(5000, 9000)):
    """Reduce isolated sibilant peaks without touching the rest of the voice."""
    sos = butter(4, band, btype="bandpass", fs=rate, output="sos")
    sibilance = sosfilt(sos, x).astype(np.float32)
    block = 240  # 5 ms
    count = len(x) // block
    frames = sibilance[:count * block].reshape(-1, block)
    level = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-20)
    threshold = np.percentile(level, threshold_pct)
    over = np.clip(level / max(threshold, 1e-6) - 1.0, 0.0, 1.0)
    gain_db = 20 * np.log10(1.0 - amount * over + 1e-6)
    gain_db = smooth_gain_db(gain_db, 1.0 / 0.005, 0.004, 0.05)
    gain = 10 ** (gain_db / 20)
    gain = np.interp(np.arange(len(x)), np.arange(count) * block + block / 2, gain,
                     left=gain[0], right=gain[-1]).astype(np.float32)
    return x - sibilance * (1 - gain), float(np.min(gain)), float(20 * np.log10(np.max(gain) + 1e-12))


def section_bounds():
    return [(int(start * RATE), int(end * RATE)) for _, start, end in VOICE_SECTIONS]


def process_voice(voice):
    out = voice.copy()
    # Remove sub-rumble without thinning the voice.
    out = sosfilt(butter(2, 65, btype="highpass", fs=RATE, output="sos"), out).astype(np.float32)
    # A little presence for intelligibility on every section.
    out = apply_biquad(out, biquad_peaking(RATE, 3200, 0.9, 0.9))
    # Suppress the synthetic/room air band that reads as hiss on headphones.
    out = apply_biquad(out, biquad_high_shelf(RATE, 11500, -2.5))
    # Recorded takes are much brighter than the generated narration; match them.
    recorded_gain = np.zeros(len(out), dtype=np.float32)
    for start, end in RECORDED:
        a, b = int(start * RATE), int(end * RATE)
        blend = np.ones(b - a, dtype=np.float32)
        edge = int(0.15 * RATE)
        blend[:edge] = np.linspace(0, 1, edge, endpoint=False)
        blend[-edge:] = np.linspace(1, 0, edge)
        recorded_gain[a:b] = np.maximum(recorded_gain[a:b], blend)
    recorded_voice = apply_biquad(out, biquad_high_shelf(RATE, 8000, -4.5))
    recorded_voice = apply_biquad(recorded_voice, biquad_peaking(RATE, 6400, 1.1, -1.2))
    out = out * (1 - recorded_gain) + recorded_voice * recorded_gain
    # Dynamic sibilance control: stronger on the brighter recorded takes.
    generated, _, _ = deess(out, RATE, 0.30)
    recorded, _, _ = deess(out, RATE, 0.50, threshold_pct=92)
    out = generated * (1 - recorded_gain) + recorded * recorded_gain
    # Match each scene to a common voice level.
    levels = []
    for name, start, end in VOICE_SECTIONS:
        a, b = int(start * RATE), int(end * RATE)
        measured = integrated_loudness(out[a:b], RATE)
        gain_db = -18.6 - measured
        out[a:b] *= 10 ** (gain_db / 20)
        levels.append({"scene": name, "before_lufs": measured, "gain_db": gain_db})
    peak = np.max(np.abs(out))
    if peak > 0.9:
        out *= 0.9 / peak
    for entry in levels:
        name, start, end = next(s for s in VOICE_SECTIONS if s[0] == entry["scene"])
        entry["after_lufs"] = integrated_loudness(out[int(start * RATE):int(end * RATE)], RATE)
    return out, levels


def build_music(voice):
    duration = len(voice) / RATE
    raw = P / "work/music-raw.wav"
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", "33",
         "-i", str(P / "assets/signal-to-noise.mp3"), "-t", str(duration),
         "-af", "highpass=f=55,lowpass=f=15000,aresample=48000",
         "-ac", "2", "-c:a", "pcm_f32le", str(raw)])
    _, music = load(raw)
    music = music[:len(voice)]
    if len(music) < len(voice):
        music = np.pad(music, ((0, len(voice) - len(music)), (0, 0)))
    # Gentle presence carve leaves room for speech without hollowing the bed.
    block = 480
    count = len(voice) // block
    frames = voice[:count * block].reshape(-1, block)
    level = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-20)
    activity = np.clip((db(level) + 46) / 26, 0, 1)
    duck_db = smooth_gain_db(-6.5 * activity, 1.0 / 0.01, 0.14, 0.9)
    duck_db = np.interp(np.arange(len(voice)), np.arange(count) * block + block / 2, duck_db,
                        left=duck_db[0], right=duck_db[-1])
    duck = (10 ** (duck_db / 20)).astype(np.float32)
    presence = sosfilt(butter(2, [260, 4000], btype="bandpass", fs=RATE, output="sos"),
                       music, axis=0).astype(np.float32)
    carve = 0.45 * activity
    carve = np.interp(np.arange(len(voice)), np.arange(count) * block + block / 2, carve,
                      left=carve[0], right=carve[-1]).astype(np.float32)
    music = music - presence * carve[:, None]
    music = music * duck[:, None]
    # Smooth opening and a long, natural close.
    time = np.arange(len(voice), dtype=np.float32) / RATE
    music *= np.minimum(time / 1.8, 1)[:, None]
    music *= np.clip((DURATION - time) / 6.0, 0, 1)[:, None]
    # Calibrate the bed against the voice during speech.
    voiced = voice > np.percentile(np.abs(voice), 60)
    music_level = 10 * np.log10(np.mean(music[voiced].astype(np.float64) ** 2) + 1e-20)
    voice_level = 10 * np.log10(np.mean(voice[voiced].astype(np.float64) ** 2) + 1e-20)
    gain_db = (voice_level - 23.0) - music_level
    music *= 10 ** (gain_db / 20)
    return music.astype(np.float32), gain_db


def main():
    (P / "work").mkdir(exist_ok=True)
    assert SOURCE.is_file()
    rate, voice = load(P / "assets/narration-voice-fixed.wav")
    assert rate == RATE and len(voice) == int(RATE * DURATION)
    if voice.ndim > 1:
        voice = voice.mean(axis=1)
    # Compare against the preserved pre-remaster file, not the file being replaced.
    previous = BACKUP if BACKUP.exists() else SOURCE
    before_wav = P / "work/delivered.wav"
    if not before_wav.exists():
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(previous),
             "-vn", "-c:a", "pcm_f32le", str(before_wav)])
    before_mix = load(before_wav)[1]
    if before_mix.ndim == 1:
        before_mix = np.stack([before_mix, before_mix], 1)

    processed_voice, levels = process_voice(voice)
    music, music_gain = build_music(processed_voice)
    wavfile.write(P / "work/music-noise-free.wav", RATE, music.astype(np.float32))
    mix = np.stack([processed_voice, processed_voice], 1) + music
    wavfile.write(P / "work/mix-noise-free.wav", RATE, mix.astype(np.float32))
    # Set integrated loudness first, then control inter-sample peaks without
    # throwing away level: the previous sample-peak limiter lost 0.9 dB here.
    mix *= 10 ** ((-16.0 - integrated_loudness(mix, RATE)) / 20)
    for _ in range(4):
        limited = limit_true_peak(mix, RATE, -1.6)
        measured = integrated_loudness(limited, RATE)
        peak = true_peak(limited, RATE)
        if measured < -16.2 and peak < -1.65:
            mix *= 10 ** ((-16.0 - measured) / 20)
            continue
        break
    wavfile.write(MIX, RATE, limited.astype(np.float32))
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(MIX),
         "-c:a", "pcm_s24le", str(MASTER)])
    assert -16.3 < integrated_loudness(limited, RATE) < -15.7
    assert true_peak(limited, RATE) <= -1.45

    # Swap only the audio tracks; the H.264 packets stay byte-identical.
    BACKUP.parent.mkdir(exist_ok=True)
    if not BACKUP.exists():
        subprocess.run(["cp", "-c", str(SOURCE), str(BACKUP)], check=True)
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(SOURCE), "-i", str(MASTER),
         "-map", "0:v:0", "-map", "1:a:0", "-map_metadata", "0", "-map_chapters", "0",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "320000", "-ar", "48000", "-ac", "2",
         "-t", str(DURATION), "-movflags", "+faststart", str(NAMED)])
    # Full decode check, then measure the audio that a viewer actually receives.
    run(["ffmpeg", "-v", "error", "-i", str(NAMED), "-vn", "-f", "null", "-"])
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(NAMED), "-vn",
         "-c:a", "pcm_f32le", str(P / "work/decoded-noise-free.wav")])
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_format", "-show_streams",
                                                "-show_chapters", "-of", "json", str(NAMED)], text=True))
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    assert (video["width"], video["height"], video["r_frame_rate"]) == (3840, 2160, "30/1")
    assert int(video["nb_frames"]) == 6900 and abs(float(probe["format"]["duration"]) - DURATION) < 0.001
    assert audio["sample_rate"] == "48000" and audio["channels"] == 2
    assert len(probe["chapters"]) == 7
    hash_old = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(SOURCE), "-map", "0:v:0",
                                        "-c:v", "copy", "-f", "hash", "-hash", "sha256", "-"], text=True).strip()
    hash_new = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(NAMED), "-map", "0:v:0",
                                        "-c:v", "copy", "-f", "hash", "-hash", "sha256", "-"], text=True).strip()
    assert hash_old == hash_new, "Encoded picture changed"

    old_mix = before_mix
    new_mix = limited
    _, encoded = load(P / "work/decoded-noise-free.wav")
    encoded_lufs = integrated_loudness(encoded, RATE)
    encoded_tp = true_peak(encoded, RATE)
    assert -16.5 < encoded_lufs < -15.7, encoded_lufs
    assert encoded_tp <= -1.0, encoded_tp
    def voice_bands(x, a, b):
        return band_energy(x[int(a * RATE):int(b * RATE)], RATE)
    gen_old = voice_bands(old_mix, 60, 125)
    rec_old = voice_bands(old_mix, 130, 170)
    gen_new = voice_bands(new_mix, 60, 125)
    rec_new = voice_bands(new_mix, 130, 170)
    # Music pumping: max 20 ms level step in the music stem region.
    def pumping(x):
        env = db(np.sqrt(np.mean(x[:len(x) // 960 * 960].reshape(-1, 960).astype(np.float64) ** 2, axis=1) + 1e-20))
        return float(np.percentile(np.abs(np.diff(env)), 99.5)), float(np.max(np.abs(np.diff(env))))
    _, old_bed = load(P / "assets/music-voice-fixed.wav")
    if old_bed.ndim == 1:
        old_bed = np.stack([old_bed, old_bed], 1)
    report = {
        "delivery": str(NAMED),
        "canonical_path_updated": str(SOURCE),
        "duration_seconds": DURATION,
        "sample_rate": RATE,
        "voice_sections": levels,
        "music_bed": {"source_gain_db": music_gain, "duck_attack_s": 0.14, "duck_release_s": 0.9,
                      "max_duck_db": -6.5, "presence_carve": 0.45,
                      "target_below_voice_db": -23.0},
        "before": {"integrated_lufs": integrated_loudness(old_mix, RATE), "true_peak_dbtp": true_peak(old_mix, RATE),
                   "recorded_vs_generated": {k: rec_old[k] - gen_old[k] for k in gen_old},
                   "music_pumping_20ms": pumping(old_bed)},
        "after": {"integrated_lufs": integrated_loudness(new_mix, RATE), "true_peak_dbtp": true_peak(new_mix, RATE),
                  "recorded_vs_generated": {k: rec_new[k] - gen_new[k] for k in gen_new},
                  "music_pumping_20ms": pumping(music)},
        "encoded_delivery": {"integrated_lufs": encoded_lufs, "true_peak_dbtp": encoded_tp,
                             "audio_codec": "AAC LC 320 kb/s 48 kHz stereo", "full_decode_passed": True},
        "noise_reduction": {"high_shelf_11k5_db": -2.5, "recorded_high_shelf_8k_db": -4.5,
                            "recorded_6k4_peak_db": -1.2,
                            "deess_generated": 0.30, "deess_recorded": 0.50,
                            "highpass_hz": 65,
                            "music_lowpass_hz": 15000},
    }
    REPORT.write_text(json.dumps(report, indent=2))
    import os
    link = P / ".noise-free-canonical.mp4"
    if link.exists():
        link.unlink()
    os.link(NAMED, link)
    os.replace(link, SOURCE)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
