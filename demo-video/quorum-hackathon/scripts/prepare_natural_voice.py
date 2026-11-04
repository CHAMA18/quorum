from pathlib import Path
import json,subprocess
p=Path(__file__).resolve().parent.parent
# Remove only hesitations, false starts, repeated phrases, and excessive silence.
remove=[(5.84,6.63),(7.62,8.77),(12.10,12.86),(14.25,15.48),(17.29,18.08),(19.16,20.72),(22.65,23.24),(35.82,37.0),(38.94,39.68),(40.43,41.14),(44.14,45.32),(48.47,48.89),(50.53,51.03),(51.67,53.84),(57.33,57.86),(60.23,61.0),(63.35,68.97),(70.64,71.04)]
ranges=[];last=1.74
for a,b in remove:ranges.append((last,a));last=b
ranges.append((last,72.15))
filters=[]
for i,(a,b) in enumerate(ranges):filters.append(f'[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[a{i}]')
prev='a0'
for i in range(1,len(ranges)):
 out=f'm{i}';filters.append(f'[{prev}][a{i}]acrossfade=d=0.018:c1=tri:c2=tri[{out}]');prev=out
filters.append(f'[{prev}]atempo=0.97,highpass=f=70,afftdn=nf=-35,acompressor=threshold=0.16:ratio=1.8:attack=15:release=140,loudnorm=I=-16:TP=-2:LRA=7,aresample=48000[voice]')
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(p/'assets/part1.mp4'),'-filter_complex',';'.join(filters),'-map','[voice]','-c:a','pcm_s24le',str(p/'assets/natural-voice-clean.wav')],check=True)
(p/'natural-voice-edits.json').write_text(json.dumps({'source':'Part 1.mp4','method':'Actual recorded speech; no synthetic voice. Short equal-power-like triangular crossfades remove clicks. Light noise reduction, level control.','keep_ranges':ranges,'removed_ranges':remove},indent=2))
print('Prepared original voice with hesitations and false starts removed.')
