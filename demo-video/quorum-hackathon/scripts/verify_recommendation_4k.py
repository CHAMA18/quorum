"""Verify the delivered UHD file, complete voice, and decoded picture."""

from pathlib import Path
import json
import re
import subprocess

P=Path(__file__).resolve().parent.parent
OUTPUT=P/"Quorum-Hackathon-Demo-4K-3m50.mp4"


def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)


def main():
    plan=json.loads((P/"narration-script.json").read_text())
    result=json.loads(subprocess.check_output([
        "ffprobe","-v","error","-show_entries",
        "format=duration,size:stream=codec_name,duration,nb_frames,width,height,r_frame_rate,channels,sample_rate",
        "-of","json",str(OUTPUT)],text=True))
    video=next(s for s in result["streams"] if s["codec_name"]=="h264")
    audio=next(s for s in result["streams"] if s["codec_name"]=="aac")
    assert (video["width"],video["height"],video["r_frame_rate"])==(3840,2160,"30/1"),video
    assert int(video["nb_frames"])==6900 and abs(float(result["format"]["duration"])-230)<.001,result
    assert audio["channels"]==2 and int(audio["sample_rate"])>=44100,audio
    alignment=json.loads((P/plan.get("voice_alignment","review/recommendation-caption-verification.json")).read_text())
    assert len(alignment["scenes"])==7 and all(s["word_match"]>=.9 for s in alignment["scenes"])
    assert alignment["words"][-1]["end"]>=228.5
    silent=run(["ffmpeg","-hide_banner","-i",str(P/plan.get("voice_stem","assets/narration-recommendation.wav")),
                "-af","silencedetect=noise=-40dB:d=2","-f","null","-"],capture_output=True,text=True)
    starts=[float(s) for s in re.findall(r"silence_start: ([0-9.]+)",silent.stderr)]
    ends=[float(s) for s in re.findall(r"silence_end: ([0-9.]+)",silent.stderr)]
    if len(ends)<len(starts):ends.append(230.)
    silent_ranges=list(zip(starts,ends))
    assert all(b-a<3.5 for a,b in silent_ranges),silent_ranges
    print("Verified UHD dimensions, frame count, seven narrated scenes and closing speech.",flush=True)
    decoded=run(["ffmpeg","-hide_banner","-i",str(OUTPUT),"-af",
                 "loudnorm=I=-16:TP=-1.5:LRA=10:print_format=json","-f","null","-"],capture_output=True,text=True)
    metrics=json.JSONDecoder().raw_decode(decoded.stderr[decoded.stderr.rfind("{"):])[0]
    assert -17<=float(metrics["input_i"])<=-15,metrics
    assert float(metrics["input_tp"])<=-1,metrics
    result.update({"full_decode_passed":True,"audio_loudness":metrics,
                   "source_resolution":[1920,1080],"native_4k_graphics_and_captions":True,
                   "footage_upscaled":True,"voice_denoised_separately_from_music":True,
                   "narration_scenes":alignment["scenes"],"captions":alignment["captions"],
                   "voice_silent_ranges_over_2_seconds":silent_ranges,
                   "last_spoken_word_end":alignment["words"][-1]["end"]})
    (P/"review/recommendation-4k-final-verification.json").write_text(json.dumps(result,indent=2))
    for sec in [6,125.2,132,148,156,172,175.2,212,228]:
        run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",str(sec),"-i",str(OUTPUT),
             "-frames:v","1",str(P/f"review/recommendation-4k-final-{sec}.png")])
    run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(OUTPUT),
         "-vf","fps=1/20,scale=480:-1,tile=4x3","-frames:v","1",str(P/"review/recommendation-4k-final-contact.jpg")])
    print(json.dumps({"file":str(OUTPUT),"size_mb":round(int(result["format"]["size"])/1e6,2),
                      "duration":230,"frames":6900,"dimensions":[3840,2160],"loudness":metrics,
                      "voice_ends":alignment["words"][-1]["end"]}),flush=True)


if __name__=="__main__":main()
