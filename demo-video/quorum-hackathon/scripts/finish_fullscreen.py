from pathlib import Path
import json,subprocess
p=Path(__file__).resolve().parent.parent
files=[p/f'renders/fullscreen-{i}.mp4' for i in [1,2,3]]
def probe(path):
 return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=index,codec_name,start_time,duration,nb_frames,width,height,r_frame_rate,channels,sample_rate','-of','json',str(path)],text=True))
for f in files:
 d=probe(f);v=next(s for s in d['streams'] if s['codec_name']=='h264')
 assert v['nb_frames']=='1800', (f,d)
video_start=float(next(s for s in probe(files[0])['streams'] if s['codec_name']=='h264')['start_time'])
playlist=p/'review/fullscreen-segments.txt'
playlist.write_text(''.join(f"file '../renders/{f.name}'\nduration 60\n" for f in files))
original=p/'Quorum-Hackathon-Demo-3min.mp4'
output=p/'Quorum-Hackathon-Demo-Fullscreen.mp4'
# Copy the existing natural-voice/music AAC track without re-encoding.
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-itsoffset',f'{-video_start:.9f}','-f','concat','-safe','0','-i',str(playlist),'-i',str(original),'-f','ffmetadata','-i',str(p/'review/chapters.txt'),'-map','0:v:0','-map','1:a:0','-map_metadata','2','-map_chapters','2','-c:v','copy','-c:a','copy','-t','180','-movflags','+faststart',str(output)],check=True)
d=probe(output);v=next(s for s in d['streams'] if s['codec_name']=='h264')
assert float(d['format']['duration'])==180.0,d
assert v['nb_frames']=='5400' and v['width']==1920 and v['height']==1080 and v['r_frame_rate']=='30/1',d
hashes=[]
for f in [original,output]:
 hashes.append(subprocess.check_output(['ffmpeg','-hide_banner','-loglevel','error','-i',str(f),'-map','0:a:0','-c:a','copy','-f','hash','-hash','sha256','-'],text=True).strip())
assert hashes[0]==hashes[1], hashes
d['natural_voice_audio_unchanged']=True
d['audio_bitstream_hash']=hashes[0]
(p/'review/fullscreen-final-probe.json').write_text(json.dumps(d,indent=2))
for sec,name in [(20,'full-ui'),(38,'document'),(114,'committee-checks'),(164,'mcp')]:
 subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-ss',str(sec),'-i',str(output),'-frames:v','1',str(p/f'review/fullscreen-decoded-{name}.png')],check=True)
for sec in [60,120]:
 subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-ss',str(sec-.1),'-i',str(output),'-vf','scale=480:-1,tile=5x1','-frames:v','1',str(p/f'review/fullscreen-join-{sec}.jpg')],check=True)
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(output),'-vf','fps=1/15,scale=480:-1,tile=4x3','-frames:v','1',str(p/'review/fullscreen-final-contact.jpg')],check=True)
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-ss','8','-i',str(output),'-frames:v','1',str(p/'Quorum-Demo-Fullscreen-Thumbnail.jpg')],check=True)
print(json.dumps({'file':str(output),'duration_seconds':float(d['format']['duration']),'frames':int(v['nb_frames']),'size_mb':round(int(d['format']['size'])/1000000,1),'original_voice_audio_identical':True}))
