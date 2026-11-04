from pathlib import Path
import json,subprocess
import numpy as np
from scipy.io import wavfile
P=Path(__file__).resolve().parent.parent
scenes=json.loads((P/'narration-recordings.json').read_text())['scenes'];rate=24000;master=np.zeros(180*rate,dtype=np.float32);report=[]
for scene in scenes:
 r,a=wavfile.read(P/'assets/recordings-led/voice'/f"{scene['id']}.wav");assert r==rate
 start=scene['start']+(0 if scene['id']=='close' else .2)
 assert start+len(a)/r<=scene['end']+.02,(scene['id'],len(a)/r)
 active=a[np.abs(a)>.012];rms=np.sqrt(np.mean(active**2));gain=min(2.0,.14/max(rms,.001));a=a*gain
 edge=120;a[:edge]*=np.linspace(0,1,edge);a[-edge:]*=np.linspace(1,0,edge)
 offset=round(start*rate);end=min(len(master),offset+len(a));master[offset:end]+=a[:end-offset]
 report.append({'scene':scene['id'],'start':start,'end':start+len(a)/r,'sourceDuration':len(a)/r,'gain':float(gain),'tempoChanged':False})
wavfile.write(P/'assets/recordings-led/voice-master.wav',rate,master)
(P/'review/recordings-audio-placement.json').write_text(json.dumps(report,indent=2)+'\n')
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(P/'assets/recordings-led/voice-master.wav'),'-i',str(P/'assets/signal-to-noise.mp3'),'-filter_complex','[0:a]aresample=48000,highpass=f=65[a];[1:a]atrim=0:180,volume=0.06,afade=t=in:d=2,afade=t=out:st=176:d=4[b];[a][b]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=7[m]','-map','[m]','-ar','48000','-ac','2',str(P/'assets/recordings-led/master.wav')],check=True)
