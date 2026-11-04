"""Restore un-gated speech and move artificial pauses into waveform valleys."""

from pathlib import Path
import json
import re
import subprocess
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, correlate, resample_poly, sosfilt, sosfiltfilt

P=Path(__file__).resolve().parent.parent
RATE=48000


def read(path):
    rate,x=wavfile.read(path)
    if x.dtype.kind=='i':x=x.astype(np.float32)/float(2**(8*x.dtype.itemsize-1))
    if rate!=RATE:x=resample_poly(x,RATE,rate).astype(np.float32)
    return x.astype(np.float32)


def run(args,**kw):return subprocess.run(args,check=True,**kw)


def pcm(path,x):
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','f32le','-ar',str(RATE),'-ac','1',
         '-i','pipe:0','-c:a','pcm_s24le',str(path)],input=x.astype(np.float32).tobytes())


def fade(x,n=720):
    x=x.copy();n=min(n,len(x)//2)
    ramp=(.5-.5*np.cos(np.linspace(0,np.pi,n))).astype(np.float32)
    x[:n]*=ramp;x[-n:]*=ramp[::-1]
    return x


def loudness(x):
    r=run(['ffmpeg','-hide_banner','-f','f32le','-ar',str(RATE),'-ac','1','-i','pipe:0',
           '-af','ebur128=framelog=quiet','-f','null','-'],input=x.astype(np.float32).tobytes(),capture_output=True)
    text=r.stderr.decode().split('Summary:')[-1]
    return float(re.search(r'I:\s+(-?[0-9.]+) LUFS',text).group(1))


def match_piece(raw,filtered,target,a,b,expected,search=2.7):
    first,last=round(a*RATE),round(b*RATE)
    width=min(round(.48*RATE),last-first)
    assert width>2500,(a,b)
    # The loudest interior half-second is stable enough to match despite the old denoiser.
    energy=np.r_[0,np.cumsum(raw[first:last].astype(np.float64)**2)]
    power=energy[width:]-energy[:-width]
    margin=min(round(.06*RATE),max(0,(len(power)-1)//2))
    local=margin+int(np.argmax(power[margin:len(power)-margin or None]))
    source_anchor=first+local
    ref=filtered[source_anchor:source_anchor+width]
    expected_anchor=expected+(source_anchor-first)/RATE
    lo=max(0,round((expected_anchor-search)*RATE));hi=min(len(target),round((expected_anchor+search)*RATE)+width)
    segment=target[lo:hi]
    # Float64 prevents FFT roundoff in digital silence from resembling a correlation peak.
    c=correlate(segment.astype(np.float64),ref.astype(np.float64),mode='valid',method='fft')
    e=np.r_[0,np.cumsum(segment.astype(np.float64)**2)]
    norm=np.sqrt(np.maximum(e[width:]-e[:-width],1e-15)*np.sum(ref.astype(np.float64)**2))
    score=c/norm
    score[(e[width:]-e[:-width])/width<1e-7]=-1
    best=int(np.argmax(score));quality=float(score[best])
    assert quality>.55,('Source speech did not match',a,b,expected,quality)
    offset=(lo+best-source_anchor)/RATE
    return {'a':a,'b':b,'offset':offset,'correlation':quality,'expected':expected}


def main():
    current=read(P/'assets/narration-recommendation.wav')
    assert len(current)==230*RATE
    output=np.zeros_like(current)
    # Recorded sources retain a blend of denoised speech and aligned original detail.
    original_intro=read(P/'review/meta-intro-source.wav')
    original_intro=sosfilt(butter(2,60,fs=RATE,btype='highpass',output='sos'),original_intro).astype(np.float32)
    clean_intro=read(P/'review/meta-intro-denoise-test.wav')
    clean_intro=np.pad(clean_intro[479:],(0,479))
    recorded=.8*clean_intro[round(3.2*RATE):round(13.2*RATE)]+.2*original_intro[round(3.2*RATE):round(13.2*RATE)]
    # Gain is referenced to the existing recording, not another speaker or spectral average.
    old=current[round(.12*RATE):round(10.12*RATE)]
    recorded*=np.sqrt(np.mean(old**2)/(np.mean(recorded**2)+1e-15))
    output[round(.12*RATE):round(10.12*RATE)]=fade(recorded,480)

    band=butter(2,[180,4200],fs=RATE,btype='bandpass',output='sos')
    target=sosfiltfilt(band,current).astype(np.float32)
    alignment=json.loads((P/'review/lusaka-narration-alignment.json').read_text())
    mcp_pauses=json.loads((P/'review/intro-clean-edit-plan.json').read_text())['mcp_sentence_boundaries']
    removals={'supplier':[(45.66,46.88)],'review':[(107.84,109.86)],'control':[(140.58,141.44)]}
    starts={'supplier':12,'workflow':45,'review':77,'control':175,'mcp':202}
    ends={'supplier':45,'workflow':77,'review':125,'control':202,'mcp':230}
    matches=[];relocated=[]
    for scene in alignment['scenes']:
        name=scene['scene']
        raw=read(P/f'assets/lusaka-narration/{name}.wav')
        raw=sosfilt(butter(2,50,fs=RATE,btype='highpass',output='sos'),raw).astype(np.float32)
        filtered=sosfiltfilt(band,raw).astype(np.float32)
        if name=='opening':
            # Recover the whole handoff, including the end of “works”.
            piece=match_piece(raw,filtered,target,8.9,len(raw)/RATE,10.24,.3)
            pieces=[piece];bound_start,bound_end=10.13,12
        else:
            pieces=[]
            cuts=scene['cuts'];first=cuts[0]
            span=scene['spoken_end']-scene['spoken_start']-(cuts[-1]-first)
            pause=span/max(1,len(cuts)-2)
            for i,(a,b) in enumerate(zip(cuts,cuts[1:])):
                old_start=scene['spoken_start']+(a-first)+i*pause
                shift=starts[name]-(scene['spoken_start']-.2)
                ranges=[(a,b)]
                for ca,cb in removals.get(name,[]):
                    sa=a+ca-old_start;sb=a+cb-old_start
                    next_ranges=[]
                    for pa,pb in ranges:
                        if sb<=pa or sa>=pb:next_ranges.append((pa,pb));continue
                        if sa>pa:next_ranges.append((pa,min(pb,sa)))
                        if sb<pb:next_ranges.append((max(pa,sb),pb))
                    ranges=next_ranges
                for pa,pb in ranges:
                    if pb-pa<.06:continue
                    old_position=old_start+pa-a
                    added=.8*sum(v<old_position for v in mcp_pauses) if name=='mcp' else 0
                    expected=old_position+shift+added
                    piece=match_piece(raw,filtered,target,pa,pb,expected)
                    pieces.append(piece)
            bound_start,bound_end=starts[name],ends[name]
        # Keep every source sample at an ordinary pause; choose a quiet cut instead of a phoneme.
        for left,right in zip(pieces,pieces[1:]):
            if abs(left['b']-right['a'])>1/RATE or right['offset']-left['offset']<.025:continue
            centre=left['b'];radius=min(.18,(left['b']-left['a'])/3,(right['b']-right['a'])/3)
            candidates=np.arange(round((centre-radius)*RATE),round((centre+radius)*RATE),48)
            n=480
            power=np.array([np.mean(raw[max(0,k-n):min(len(raw),k+n)]**2) for k in candidates])
            cost=10*np.log10(power+1e-14)+4*np.abs(candidates/RATE-centre)/radius
            best=int(np.argmin(cost));boundary=float(candidates[best]/RATE)
            old_n=round(centre*RATE)
            old_power=np.mean(raw[max(0,old_n-n):min(len(raw),old_n+n)]**2)
            relocated.append({'scene':name,'source_cut_before':centre,'source_cut_after':boundary,
                              'edge_rms_before_dbfs':float(10*np.log10(old_power+1e-14)),
                              'edge_rms_after_dbfs':float(10*np.log10(power[best]+1e-14))})
            left['b']=right['a']=boundary
        # Use one gain for a continuous original take, preserving its natural inflection.
        ratios=[]
        previous_end=None
        for piece in pieces:
            a,b=round(piece['a']*RATE),round(piece['b']*RATE)
            t=round((piece['a']+piece['offset'])*RATE)
            size=min(b-a,len(current)-t)
            if size>0 and t>=0:
                ratios.append(np.sqrt(np.mean(current[t:t+size]**2)/(np.mean(raw[a:a+size]**2)+1e-15)))
        gain=float(np.median(ratios))
        (P/f'review/voice-continuity-{name}-matches.json').write_text(json.dumps(pieces,indent=2))
        for piece in pieces:
            a,b=round(piece['a']*RATE),round(piece['b']*RATE)
            t=round((piece['a']+piece['offset'])*RATE)
            clip=fade(raw[a:b]*gain,480)
            lo=max(t,round(bound_start*RATE));hi=min(t+len(clip),round(bound_end*RATE))
            overlap=max(0,previous_end-lo) if previous_end is not None else 0
            assert overlap<.18*RATE,('Unexpected source overlap',name,overlap/RATE)
            if hi>lo:
                overlap=min(overlap,hi-lo)
                if overlap:
                    ramp=(.5-.5*np.cos(np.linspace(0,np.pi,overlap))).astype(np.float32)
                    output[lo:lo+overlap]=output[lo:lo+overlap]*(1-ramp)+clip[lo-t:lo-t+overlap]*ramp
                output[lo+overlap:hi]=clip[lo-t+overlap:hi-t]
            previous_end=hi
            matches.append({'scene':name,**piece,'source_gain':gain,'placed_start':lo/RATE,'placed_end':hi/RATE})

    # Rebuild the recorded chapter with short crossfades, preserving sentence positions.
    dry=read(P/'review/recommendation-source.wav')
    dry=sosfilt(butter(2,60,fs=RATE,btype='highpass',output='sos'),dry).astype(np.float32)
    clean=read(P/'assets/recommendation-recording-denoised.wav')
    clean=np.pad(clean[479:],(0,479))
    recorded=.8*clean+.2*dry
    edit=json.loads((P/'review/recommendation-voice-edits.json').read_text())
    for sentence in edit['sentences']:
        reference_pieces=[];pieces=[]
        for a,b in sentence['source_ranges']:
            lo,hi=round((a-198)*RATE),round((b-198)*RATE)
            reference_pieces.append(fade(clean[lo:hi],288));pieces.append(recorded[lo:hi].copy())
        reference=np.concatenate(reference_pieces)
        blocks=reference[:len(reference)//480*480].reshape(-1,480)
        active=np.flatnonzero(np.sqrt(np.mean(blocks**2,axis=1))>.004)
        crop_a=max(0,(int(active[0])-4)*480) if len(active) else 0
        crop_b=min(len(reference),(int(active[-1])+5)*480) if len(active) else len(reference)
        joined=pieces[0]
        for following in pieces[1:]:
            n=min(576,len(joined),len(following))
            ramp=(.5-.5*np.cos(np.linspace(0,np.pi,n))).astype(np.float32)
            joined=np.r_[joined[:-n],joined[-n:]*(1-ramp)+following[:n]*ramp,following[n:]]
        # Crossfade removes only 12 ms per join; restore that time after the complete phrase.
        joined=np.pad(joined,(0,max(0,len(reference)-len(joined))))
        clip=fade(joined[crop_a:crop_b],480)
        wanted=round((sentence['end']-sentence['start'])*RATE)
        assert abs(len(clip)-wanted)<5,(sentence['text'],len(clip),wanted)
        if len(clip)<wanted:clip=np.pad(clip,(0,wanted-len(clip)))
        at=round((125+sentence['start'])*RATE)
        old=current[at:at+wanted]
        clip=clip[:wanted]*np.sqrt(np.mean(old**2)/(np.mean(clip[:wanted]**2)+1e-15))
        output[at:at+wanted]=clip

    pcm(P/'assets/narration-continuity-restored.wav',output)
    # Gentle presence and dynamics; no gate and no noise suppression on generated speech.
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(P/'assets/narration-continuity-restored.wav'),
         '-af','equalizer=f=2800:t=q:w=0.8:g=1.2,acompressor=threshold=0.15:ratio=1.6:attack=15:release=180:makeup=1:knee=2.5:detection=rms',
         '-c:a','pcm_s24le',str(P/'assets/narration-continuity-processed.wav')])
    processed=read(P/'assets/narration-continuity-processed.wav')
    plan=json.loads((P/'narration-script.json').read_text())
    levels=[]
    for scene in plan['scenes']:
        lo,hi=scene['start']*RATE,scene['end']*RATE
        measured=loudness(processed[lo:hi]);gain_db=-18.5-measured
        processed[lo:hi]*=10**(gain_db/20)
        levels.append({'scene':scene['id'],'before_lufs':measured,'gain_db':gain_db,'target_lufs':-18.5})
    # Catch occasional restored consonant peaks without clipping or shifting the voice clock.
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','f32le','-ar',str(RATE),'-ac','1',
         '-i','pipe:0','-af','alimiter=limit=0.794328:attack=5:release=80:level=0:latency=1',
         '-t','230','-c:a','pcm_s24le',str(P/'assets/narration-voice-fixed.wav')],input=processed.tobytes())
    processed=read(P/'assets/narration-voice-fixed.wav')
    for scene,level in zip(plan['scenes'],levels):
        level['final_lufs']=loudness(processed[scene['start']*RATE:scene['end']*RATE])
    report={'duration':230,'generated_speech_noise_suppression_removed':True,'recorded_speech_denoised_blend':.8,
            'source_matches':matches,'pause_repairs':relocated,'scene_level_matching':levels,
            'recorded_phrase_crossfade_ms':12,'tempo_or_pitch_changed':False,
            'peak_dbfs':float(20*np.log10(np.max(np.abs(processed))))}
    (P/'review/voice-continuity-repair.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'source_matches':len(matches),'minimum_correlation':min(m['correlation'] for m in matches),
                      'pause_repairs':len(relocated),'scene_levels':levels,'peak_dbfs':report['peak_dbfs']}),flush=True)


if __name__=='__main__':main()
