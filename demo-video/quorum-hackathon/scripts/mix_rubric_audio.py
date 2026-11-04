from pathlib import Path
import json,subprocess
import numpy as np
from scipy.io import wavfile
P=Path(__file__).resolve().parent.parent
script=json.loads((P/'narration-rubric.json').read_text())
script['scenes'][-2]['end']=166
script['scenes'][-1]['start']=166
(P/'narration-rubric.json').write_text(json.dumps(script,indent=2)+'\n')
rate=24000;master=np.zeros(180*rate,dtype=np.float32);report=[]
for scene in script['scenes']:
 r,a=wavfile.read(P/'assets/rubric/voice'/f"{scene['id']}.wav")
 assert r==rate
 start=scene['start']+.35
 assert start+len(a)/r<scene['end'],scene['id']
 # Equalise speech section RMS without stretching its voice or pitch.
 active=a[np.abs(a)>.012];rms=np.sqrt(np.mean(active**2));gain=min(2.0,.14/max(rms,.001));a=a*gain
 edge=min(120,len(a)//2);a[:edge]*=np.linspace(0,1,edge);a[-edge:]*=np.linspace(1,0,edge)
 offset=round(start*rate);master[offset:offset+len(a)]+=a
 report.append({'scene':scene['id'],'start':start,'end':start+len(a)/rate,'sourceDuration':len(a)/rate,'gain':float(gain),'tempoChanged':False})
wavfile.write(P/'assets/rubric/voice-master.wav',rate,master)
(P/'review/rubric-audio-placement.json').write_text(json.dumps(report,indent=2)+'\n')
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(P/'assets/rubric/voice-master.wav'),'-i',str(P/'assets/signal-to-noise.mp3'),'-filter_complex','[0:a]aresample=48000,highpass=f=65[a];[1:a]atrim=0:180,volume=0.06,afade=t=in:d=2,afade=t=out:st=176:d=4[b];[a][b]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=7[m]','-map','[m]','-ar','48000','-ac','2',str(P/'assets/rubric/master.wav')],check=True)
