"""Assemble checked HyperFrames graphics with truthful recording extracts."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,subprocess
R=Path(__file__).resolve().parent.parent;P=R/'demo-video/quorum-recordings';A=P/'assets';review=P/'review';overlay=review/'caption-overlays';overlay.mkdir(parents=True,exist_ok=True)
W,H=3840,2160
captions=json.loads((P/'captions.json').read_text())
labels=[(20,45,'PART 1 · RECORDED SUPPLIER WORKFLOW'),(45,72,'EARLIER RECORDING · ILLUSTRATIVE FIELDS VARY'),(72,110,'PART 2 · READ-ONLY BID REVIEW'),(110,134,'UNTITLED VIDEO · COMMITTEE + MEMBER REGISTRATION'),(134,142,'PART 2 · EVALUATION INTEGRITY'),(105,110,'SEPARATE LIVE CHECK: MUSE-SPARK-1.3 · SOURCE QUOTES VERIFIED')]
def font(size,weight):
 f=ImageFont.truetype(str(A/'Montserrat.ttf'),size)
 if hasattr(f,'get_variation_axes'):
  axes=f.get_variation_axes()
  if axes:f.set_variation_by_axes([weight if b'Weight'in a['name']else a['default']for a in axes])
 return f
capfont=font(76,500);labfont=font(54,600);privacyfont=font(56,500)
boundaries={0,5400,28*30,45*30}
for c in captions:boundaries.update([round(c['start']*30),round(c['end']*30)])
for a,b,_ in labels:boundaries.update([a*30,b*30])
boundaries=sorted(n for n in boundaries if 0<=n<=5400);entries=[]
for i,(start,end)in enumerate(zip(boundaries,boundaries[1:])):
 t=(start+end)/60;canvas=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(canvas)
 for c in captions:
  if c['start']<=t<c['end']:
   text=c['text'];box=d.textbbox((0,0),text,font=capfont);width=box[2]-box[0]
   if width>3280:raise RuntimeError('Caption too wide: '+text)
   x=(W-width)/2;y=H-146;d.rounded_rectangle((x-36,y-14,x+width+36,y+102),radius=12,fill=(10,12,16,248));d.text((W/2,y),text,font=capfont,fill='white',anchor='mt')
 for j,(a,b,text)in enumerate(labels):
  if a<=t<b:
   y=190 if j==5 else 76;box=d.textbbox((0,0),text,font=labfont);width=box[2]-box[0];x=W-140-width
   d.rounded_rectangle((x-28,y-14,x+width+28,y+80),radius=8,fill=(16,18,23,248));d.text((x,y),text,font=labfont,fill='white')
 if 28<=t<45:d.text((1398,1562),'Identifying details redacted',font=privacyfont,fill='white')
 f=overlay/f'overlay-{i:03}.png';canvas.save(f);entries.append((f,(end-start)/30))
blank=overlay/'blank.png';Image.new('RGBA',(W,H),(0,0,0,0)).save(blank)
playlist=review/'caption-overlays.ffconcat';lines=['ffconcat version 1.0']
for f,duration in entries:lines.extend(["file '"+str(f)+"'",'option framerate 30',f'duration {duration:.9f}'])
lines.extend(["file '"+str(blank)+"'",'option framerate 30']);playlist.write_text('\n'.join(lines)+'\n')
# Only the three source actions and the checked graphics are assembled here.
# Timings match index.html: graphics 0-20, real footage 20-142, graphics 142-180.
filters='[0:v]split=2[op][out];[op]trim=start=0:end=20,setpts=PTS-STARTPTS[g0];[out]trim=start=20:end=58,setpts=PTS-STARTPTS[g1];[1:v]scale=3840:2160:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[mid];[g0][mid][g1]concat=n=3:v=1:a=0[base];[base][2:v]overlay=0:0:eof_action=pass:repeatlast=1[v]'
output=P/'Quorum-Hackathon-Demo-Recordings-3min-4K.mp4'
command=['ffmpeg','-y','-hide_banner','-i',str(P/'graphics-4K.mp4'),'-i',str(A/'recorded-workflows.mp4'),'-safe','0','-f','concat','-i',str(playlist),'-i',str(A/'master.wav'),'-filter_complex',filters,'-map','[v]','-map','3:a','-r','30','-frames:v','5400','-t','180','-c:v','h264_videotoolbox','-b:v','24000k','-allow_sw','1','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(output)]
(review/'assembly-command.json').write_text(json.dumps({'command':command,'overlayCount':len(entries),'recordedSeconds':122,'duration':180,'frames':5400},indent=2)+'\n')
subprocess.run(command,check=True)
print(output)
