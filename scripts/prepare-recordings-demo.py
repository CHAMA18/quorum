"""Truthful, normal-speed extracts from the three supplied recordings."""
from pathlib import Path
import subprocess,json,hashlib
R=Path(__file__).resolve().parent.parent;S=R/'demo-video/quorum-hackathon';P=R/'demo-video/quorum-recordings';A=P/'assets';A.mkdir(parents=True,exist_ok=True)
# (chapter, source, source start, seconds, crop x/y/w/h, redact certificate)
rows=[
 ('supplier','Part 1.mp4',31,8,[280,60,1600,900],False),
 ('supplier','Part 1.mp4',39,6,[200,80,1504,846],True),
 ('supplier','Part 1.mp4',52,7,[200,80,1504,846],True),
 ('supplier','Part 1.mp4',63,4,[200,80,1504,846],True),
 ('workflow','Part 2.mp4',78,7,[280,100,1600,900],False),
 ('workflow','Part 2.mp4',165,9,[420,170,1080,608],False),
 ('workflow','Part 2.mp4',151,6,[400,245,1120,630],False),
 ('workflow','Part 2.mp4',130,5,[180,100,1600,900],False),
 ('review','Part 2.mp4',163,8,[180,100,1600,900],False),
 ('review','Part 2.mp4',170,6,[180,100,1600,900],False),
 ('review','Part 2.mp4',213,5,[420,270,1080,608],False),
 ('review','Part 2.mp4',225,5.5,[492,420,460,258],False),
 ('review','Part 2.mp4',230.5,5.5,[492,650,460,258],False),
 ('review','Part 2.mp4',233,4,[975,420,460,258],False),
 ('review','Part 2.mp4',237,4,[975,650,460,258],False),
 ('committee','Untitled video.mp4',262,9,[280,60,1600,900],False),
 ('committee','Untitled video.mp4',271,8,[420,170,1080,608],False),
 ('committee','Untitled video.mp4',285,7,[280,60,1600,900],False),
 ('committee','Part 2.mp4',250,8,[400,170,1120,630],False),
]
plan=[];cursor=20
font='/System/Library/Fonts/Supplemental/Arial.ttf'
for i,(chapter,name,start,duration,crop,privacy)in enumerate(rows):
 destination=A/f'clip-{i:02}.mp4';filters=[]
 if privacy:
  for x,y,w,h in [(705,605,435,172),(1120,520,90,90),(326,343,163,225),(1250,356,465,115),(1250,492,465,58)]:filters.append(f'drawbox=x={x}:y={y}:w={w}:h={h}:color=0x20242b:t=fill')
 x,y,w,h=crop;filters.extend([f'crop={w}:{h}:{x}:{y}','scale=1728:972:flags=lanczos','pad=1920:1080:96:108:color=0x101217','setsar=1'])
 command=['ffmpeg','-y','-hide_banner','-loglevel','error','-ss',str(start),'-i',str(S/name),'-t',str(duration),'-vf',','.join(filters),'-an','-r','30','-c:v','h264_videotoolbox','-b:v','14000k','-allow_sw','1','-pix_fmt','yuv420p',str(destination)]
 subprocess.run(command,check=True)
 plan.append({'id':f'footage-{i:02}','chapter':chapter,'source':name,'sourceStart':start,'duration':duration,'timelineStart':cursor,'crop':crop,'privacyRedaction':privacy,'rate':1,'preparedFile':destination.name});cursor+=duration
 print(f'{i+1}/{len(rows)} {chapter}: {name} {start}-{start+duration}s',flush=True)
assert cursor==142,cursor
playlist=A/'footage.ffconcat';playlist.write_text('ffconcat version 1.0\n'+''.join("file '"+r['preparedFile']+"'\n"for r in plan))
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-safe','0','-f','concat','-i',str(playlist),'-an','-c','copy',str(A/'recorded-workflows.mp4')],check=True)
manifest={'sourceResolution':[1920,1080],'recordedFootageSeconds':122,'timeline':[20,142],'sourceSha256':{n:hashlib.sha256((S/n).read_bytes()).hexdigest()for n in sorted({r[1]for r in rows})},'edits':plan,'notes':['Normal source speed; cuts remove waiting intervals.','Raw recordings preserved.','Crops focus panels and exclude account/dev badges.','Supplier tax identifiers are explicitly redacted.','Recorded demonstration state is separate from the current Zambia integration fixture.']}
(P/'edit-plan.json').write_text(json.dumps(manifest,indent=2)+'\n')
