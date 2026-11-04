"""Insert the recorded recommendation chapter and preserve the previous edit."""

from pathlib import Path
import difflib
import html
import json
import re
import subprocess
import zipfile
import numpy as np
from scipy.io import wavfile
from PIL import ImageFont

P = Path(__file__).resolve().parent.parent


def tokens(text):
    return re.findall(r"[a-z0-9]+",text.lower())


def stamp(seconds):
    v=round(seconds*1000)
    return f"{v//3600000:02}:{v//60000%60:02}:{v//1000%60:02},{v%1000:03}"


def main():
    with zipfile.ZipFile(P / "revisions/before-recommendation-4k-source.zip") as archive:
        index=archive.read("index.html").decode()
        captions=json.loads(archive.read("captions.json"))
        plan=json.loads(archive.read("narration-script.json"))
    edit=json.loads((P/"review/recommendation-voice-edits.json").read_text())
    asr=json.loads((P/"review/recommendation-final-words.json").read_text())
    match=difflib.SequenceMatcher(a=tokens(edit["text"]),b=tokens(asr["text"])).ratio()
    assert match>.95, (match,asr["text"])
    assert "strongest documented fit" in asr["text"].lower()
    assert "final decision" in asr["text"].lower() and "verdict signed" in asr["text"].lower()
    words=[]
    for segment in asr["segments"]:
        for word in segment.get("words",[]):
            text=word["word"].strip()
            text=re.sub(r"\bquorum\b","Quorum",text,flags=re.I)
            words.append({"text":text,"start":word["start"],"end":word["end"]})
    expected_words=edit["text"].split()
    if len(expected_words)==len(words) and all(tokens(a)==tokens(b["text"]) for a,b in zip(expected_words,words)):
        for word,text in zip(words,expected_words):word["text"]=text
    font=ImageFont.truetype(str(P/"assets/fonts/Montserrat.ttf"),36)
    font.set_variation_by_axes([400])
    added=[]
    cursor=0
    while cursor<len(words):
        stop=cursor
        while stop<len(words):
            text=" ".join(w["text"] for w in words[cursor:stop+1])
            if stop>cursor and (stop-cursor>=12 or font.getlength(text)>1440):break
            stop+=1
            if stop-cursor>=3 and re.search(r"[.!?]$",words[stop-1]["text"]):break
        while stop-cursor>4 and words[stop-1]["text"].strip(".,:;").lower() in {"a","an","the","and","or","to","of","that","their","particular"}:stop-=1
        group=words[cursor:stop]
        next_start=words[stop]["start"] if stop<len(words) else 49.9
        added.append({"text":" ".join(w["text"] for w in group),"start":125+group[0]["start"],
                      "end":125+min(group[-1]["end"]+.25,next_start-.035),"kind":"spoken","scene":"recommendation"})
        cursor=stop
    added[0]["start"]=max(added[0]["start"],125+edit["sentences"][0]["start"])
    for c in captions:
        if c["start"]>=125:c["start"]+=50;c["end"]+=50
    captions=sorted(captions+added,key=lambda c:c["start"])
    assert all(a["end"]<=b["start"] for a,b in zip(captions,captions[1:]))
    (P/"captions.json").write_text(json.dumps(captions,indent=2))
    (P/"Quorum-Demo.srt").write_text("\n\n".join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(captions))+"\n")
    clips="".join(f'<div id="cap-{i}" class="clip caption" data-start="{c["start"]:.3f}" data-duration="{c["end"]-c["start"]:.3f}" data-track-index="0"><span>{html.escape(c["text"])}</span></div>' for i,c in enumerate(captions))
    (P/"compositions/captions.html").write_text('<template><style>#root{width:100%;height:100%;position:relative;pointer-events:none}.caption{position:absolute;left:192px;right:192px;top:920px;text-align:center;font:400 36px/1.25 Montserrat,sans-serif;color:#f5f2ed}.caption span{display:inline-block;background:#121318;padding:7px 22px;border-radius:4px}</style><div id="root" data-composition-id="captions" data-duration="230" data-width="1920" data-height="1080">'+clips+'</div><script>const tl=gsap.timeline({paused:true});window.__timelines["captions"]=tl;</script></template>')
    new_scene={"id":"recommendation","start":125,"end":175,"text":edit["text"]}
    for scene in plan["scenes"]:
        if scene["start"]>=125:scene["start"]+=50;scene["end"]+=50
    plan["scenes"].insert(4,new_scene)
    plan.update({"duration_seconds":230,"status":"recommendation_and_4k_prepared",
                 "delivery_file":"Quorum-Hackathon-Demo-4K-3m50.mp4","delivery_resolution":[3840,2160],
                 "source_resolution":[1920,1080],"final_verification":"review/recommendation-4k-final-verification.json"})
    plan["voice_sources"].append("Meta Hackathon.mp4 — recorded AI recommendation and committee explanation")
    (P/"narration-script.json").write_text(json.dumps(plan,indent=2)+"\n")
    rate,old=wavfile.read(P/"assets/narration-intro-clean.wav")
    rate2,new=wavfile.read(P/"assets/recommendation-voice.wav")
    assert rate==rate2==48000 and len(new)==50*rate
    voice=np.concatenate([old[:125*rate],new,old[125*rate:]])
    temporary=P/"assets/narration-recommendation-raw.wav"
    wavfile.write(temporary,rate,voice)
    subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",str(temporary),"-c:a","pcm_s24le",str(P/"assets/narration-recommendation.wav")],check=True)
    index=index.replace('data-duration="180"','data-duration="230"').replace('assets/master-intro-clean.wav','assets/master-recommendation.wav')
    for scene,start in [("control",175),("mcp",202)]:
        index=re.sub(r'<div\b(?=[^>]*\bid="'+scene+r'")[^>]*>',lambda m:re.sub(r'data-start="[^"]+"',f'data-start="{start}"',m.group()),index)
    host='<div id="recommendation" class="clip scene" data-composition-id="recommendation" data-composition-src="compositions/recommendation.html" data-start="125" data-duration="50.4" data-width="1920" data-height="1080" data-track-index="0" data-track-kind="graphics"></div>'
    index=index.replace('<div data-hf-id="hf-jl47" id="control"',host+'<div data-hf-id="hf-jl47" id="control"')
    index=index.replace('immediateRender:false},125)','immediateRender:false},175)').replace('immediateRender:false},152)','immediateRender:false},202)').replace('},179.25)','},229.25)')
    marker='tl.fromTo("#control"'
    index=index.replace(marker,'tl.fromTo("#recommendation",{opacity:0},{opacity:1,duration:.4,ease:"power2.inOut",immediateRender:false},125);'+marker)
    (P/"index.html").write_text(index)
    old_report=json.loads((P/"review/intro-clean-caption-verification.json").read_text())
    for word in old_report["words"]:
        if word["start"]>=125:word["start"]+=50;word["end"]+=50
    all_words=sorted(old_report["words"]+[{**w,"start":w["start"]+125,"end":w["end"]+125,"scene":"recommendation"} for w in words],key=lambda w:w["start"])
    scene_reports=old_report["scenes"]
    scene_reports.insert(4,{"scene":"recommendation","expected":edit["text"],"transcript":asr["text"],"word_match":match})
    report={"scenes":scene_reports,"words":all_words,"captions":len(captions),"new_captions":len(added),"duration":230,"delivery_resolution":[3840,2160]}
    (P/"review/recommendation-caption-verification.json").write_text(json.dumps(report,indent=2))
    print(json.dumps({"transcript_match":match,"captions":len(captions),"voice_duration":len(voice)/rate,"last_word_end":all_words[-1]["end"]}),flush=True)


if __name__=="__main__":main()
