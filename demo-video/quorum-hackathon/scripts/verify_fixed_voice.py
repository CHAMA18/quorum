"""Transcribe repaired speech and check its words and timing against the picture captions."""

from pathlib import Path
import difflib
import json
import os
import re
os.environ.setdefault('HF_HUB_OFFLINE','1')
os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
import mlx.core as mx
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
from mlx_audio.stt.utils import load_model

P=Path(__file__).resolve().parent.parent


def tokens(text):
    text=re.sub(r'\ba\s+i\b','ai',text.lower()).replace('corum','quorum')
    text=re.sub(r'\bm\s+c\s+p\b','mcp',text)
    return re.findall(r'[a-z0-9]+',text)


def main():
    mx.set_cache_limit(64*1024*1024);mx.set_memory_limit(4*1024**3);mx.set_wired_limit(2*1024**3)
    rate,audio=wavfile.read(P/'assets/narration-voice-fixed.wav')
    assert rate==48000 and len(audio)==230*rate
    audio=resample_poly(audio.astype(np.float32)/2**31,1,3).astype(np.float32)
    model=load_model('/tmp/quorum-whisper')
    plan=json.loads((P/'narration-script.json').read_text())
    old=json.loads((P/'review/recommendation-caption-verification.json').read_text())
    reports=[];all_words=[]
    for scene in plan['scenes']:
        result=model.generate(audio[scene['start']*16000:scene['end']*16000],language='en',temperature=0.0,
                              word_timestamps=True,condition_on_previous_text=False,
                              initial_prompt='Quorum, AI, MCP, Meta-powered procurement, committee consideration, verdict signed.',verbose=None)
        words=[{'text':w['word'].strip(),'start':w['start']+scene['start'],'end':w['end']+scene['start'],'scene':scene['id']}
               for segment in result.segments for w in segment.get('words',[])]
        match=difflib.SequenceMatcher(a=tokens(scene['text']),b=tokens(result.text)).ratio()
        assert match>.9,(scene['id'],match,result.text)
        required={'supplier':'decide','review':'fill','control':'write'}
        if scene['id'] in required:
            assert re.search(r"does(?:n't| not)\s+"+required[scene['id']],result.text.lower()),result.text
        previous=[w for w in old['words'] if w['scene']==scene['id']]
        delta=[]
        matcher=difflib.SequenceMatcher(a=[' '.join(tokens(w['text'])) for w in previous],b=[' '.join(tokens(w['text'])) for w in words],autojunk=False)
        for a,b,n in matcher.get_matching_blocks():
            delta.extend(abs(previous[a+i]['start']-words[b+i]['start']) for i in range(n))
        p90=float(np.percentile(delta,90)) if delta else None
        report={'scene':scene['id'],'expected':scene['text'],'transcript':result.text,'word_match':match,
                'matched_word_median_timing_delta':float(np.median(delta)) if delta else None,
                'matched_word_p90_timing_delta':p90,'segments':result.segments}
        reports.append(report);all_words.extend(words)
        (P/f"review/voice-fixed-{scene['id']}-words.json").write_text(json.dumps(report,indent=2))
        print(f"Verified {scene['id']}: match {match:.3f}; median caption delta {report['matched_word_median_timing_delta']:.3f}s",flush=True)
    assert all_words[-1]['end']>228.5
    (P/'review/voice-fixed-speech-verification.json').write_text(json.dumps({'scenes':reports,'words':all_words,'last_word_end':all_words[-1]['end'],'captions':len(json.loads((P/'captions.json').read_text()))},indent=2))


if __name__=='__main__':main()
