"""Keep the rendered UHD picture and attach the final master with chapter markers."""

from pathlib import Path
import json
import subprocess

P=Path(__file__).resolve().parent.parent
FINAL=P/"Quorum-Hackathon-Demo-4K-3m50.mp4"
NATIVE=P/"renders/recommendation-native-4k.mp4"


def main():
    plan=json.loads((P/"narration-script.json").read_text())
    titles=["Introduction","Supplier document check","Tender workflow","Evidence review",
            "AI recommendation and committee","Evaluation integrity and human decision","Published MCP and closing"]
    lines=[";FFMETADATA1","title=Quorum — 3:50 hackathon demo in 4K",
           "comment=Recorded creator introduction and recommendation chapter; continuing narration based on the supplied Lusaka voice reference. UHD graphics with upscaled 1080p footage."]
    for scene,title in zip(plan["scenes"],titles):
        lines.extend(["[CHAPTER]","TIMEBASE=1/1000",f"START={scene['start']*1000}",
                      f"END={scene['end']*1000}","title="+title])
    metadata=P/"review/recommendation-chapters.txt"
    metadata.write_text("\n".join(lines)+"\n")
    assert FINAL.is_file()
    # Only this task's new render is moved; previous delivered edits are preserved.
    FINAL.replace(NATIVE)
    subprocess.run([
        "ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(NATIVE),
        "-i",str(P/plan.get("audio_master","assets/master-recommendation.wav")),"-f","ffmetadata","-i",str(metadata),
        "-map","0:v:0","-map","1:a:0","-map_metadata","2","-map_chapters","2",
        "-c:v","copy","-c:a","aac","-b:a","256k","-ar","48000","-ac","2",
        "-t","230","-movflags","+faststart",str(FINAL),
    ],check=True)
    print("Final UHD picture retained; 48 kHz stereo AAC master and seven chapters attached.",flush=True)


if __name__=="__main__":main()
