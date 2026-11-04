"""Build a fifty-second chapter from the creator's recorded explanation."""

from pathlib import Path
import json
import subprocess
import numpy as np
from scipy.io import wavfile

P = Path(__file__).resolve().parent.parent
RATE = 48000


def edge_fade(audio, seconds=.006):
    audio = audio.copy()
    n = min(round(seconds * RATE), len(audio) // 2)
    audio[:n] *= np.linspace(0, 1, n)
    audio[-n:] *= np.linspace(1, 0, n)
    return audio


def main():
    clean = P / "assets/recommendation-recording-denoised.wav"
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i",
        str(P / "review/recommendation-source.wav"), "-af",
        "highpass=f=60,arnndn=m=assets/audio-tools/speech-denoise.rnnn:mix=1",
        "-c:a", "pcm_s24le", str(clean),
    ], check=True, cwd=P)
    rate, raw = wavfile.read(clean)
    assert rate == RATE
    raw = raw.astype(np.float32) / 2**31
    # RNNoise adds one 10 ms frame; maintain the recorded word boundaries.
    raw = np.pad(raw[479:], (0, 479))
    sentences = [
        ("The AI presents the strongest documented fit for the committee consideration.",
         [(201.80, 202.64), (209.10, 214.30)]),
        ("It then evaluates both sides.", [(219.25, 221.30)]),
        ("It then submits information to the committee.", [(223.49, 225.35)]),
        ("Based off of information that it will give you as a committee, you then proceed to then select.",
         [(240.45, 245.40)]),
        ("So as a committee, you have the ability to set up what we call the full committee that has to make up their own decision.",
         [(256.66, 259.96), (260.40, 268.70)]),
        ("This is a panel of the committee.", [(272.44, 274.03)]),
        ("We can add any other person to the committee to constitute the quorum, who then makes the final decision in terms of who to award a particular contract.",
         [(274.30, 278.18), (278.36, 284.88)]),
        ("Each person has to have the verdict signed.", [(285.16, 287.98)]),
    ]
    clips, reports = [], []
    for text, ranges in sentences:
        pieces = [edge_fade(raw[round((a - 198)*RATE):round((b - 198)*RATE)]) for a,b in ranges]
        clip = np.concatenate(pieces)
        # Remove only leading/trailing dead air; retain the speaker's internal delivery.
        blocks = clip[:len(clip)//480*480].reshape(-1,480)
        active = np.flatnonzero(np.sqrt(np.mean(blocks**2,axis=1)) > .004)
        if active.size:
            a = max(0, (active[0]-4)*480)
            b = min(len(clip), (active[-1]+5)*480)
            clip = clip[a:b]
        clips.append(edge_fade(clip))
        reports.append({"text":text, "source_ranges":ranges, "speech_duration":len(clip)/RATE})
    speech_count = sum(len(c) for c in clips)
    available = 50*RATE - speech_count
    assert 0 < available < 18*RATE, speech_count/RATE
    # Divide reading room among sentence ends, without changing speech tempo.
    weights = np.array([.6,1.3,.55,.75,.7,.7,.5,.65, .5])
    pauses = np.rint(available * weights / weights.sum()).astype(int)
    pauses[-1] += available-int(pauses.sum())
    output = np.zeros(50*RATE, np.float32)
    cursor = pauses[0]
    for i, clip in enumerate(clips):
        output[cursor:cursor+len(clip)] = clip
        reports[i].update({"start":cursor/RATE, "end":(cursor+len(clip))/RATE})
        cursor += len(clip) + pauses[i+1]
    assert cursor == len(output)
    temporary = P / "assets/recommendation-voice-edited.wav"
    wavfile.write(temporary,RATE,output)
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(temporary),
        "-af", "loudnorm=I=-18:TP=-2:LRA=10,aresample=48000", "-c:a", "pcm_s24le",
        str(P / "assets/recommendation-voice.wav"),
    ],check=True)
    (P / "review/recommendation-voice-edits.json").write_text(json.dumps({
        "source":"Meta Hackathon.mp4", "duration":50, "latency_compensated_samples":479,
        "tempo_or_pitch_changed":False, "sentences":reports,
        "text":" ".join(s[0] for s in sentences),
    },indent=2))
    print(json.dumps({"speech_seconds":speech_count/RATE,"reading_pauses":pauses.tolist(),"sentences":reports}),flush=True)


if __name__ == "__main__":
    main()
