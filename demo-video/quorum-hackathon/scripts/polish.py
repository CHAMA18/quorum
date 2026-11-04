from pathlib import Path
import re,subprocess
p=Path(__file__).resolve().parent.parent
ref=p/'compositions/transitions-dissolve.html'
if ref.exists():
 (p/'references').mkdir(exist_ok=True);ref.rename(p/'references/transitions-dissolve.html.txt')
for name,t in [('integrity',252),('matrix',167)]:
 f=p/f'assets/evidence-{name}.png'
 if not f.exists():subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-ss',str(t),'-i',str(p/'assets/part2.mp4'),'-frames:v','1',str(f)],check=True)
def change(scene,idx,source=None,crop=None,freeze=None):
 f=p/f'compositions/{scene}.html';s=f.read_text();m=re.search(fr'<video[^>]*\bid="{scene}-v{idx}"[^>]*></video>',s)
 if not m:return
 tag=m.group()
 if source is not None:tag=re.sub(r'data-media-start="[^"]+"',f'data-media-start="{source}"',tag)
 if crop:
  x,y,w,h=crop;scale=min(1728/w,634/h);left=(1728-w*scale)/2-x*scale;top=(634-h*scale)/2-y*scale
  tag=re.sub(r'style="[^"]+"',f'style="width:{1920*scale:.3f}px;height:{1080*scale:.3f}px;left:{left:.3f}px;top:{top:.3f}px"',tag)
 if freeze:
  tag=tag.replace('<video','<img').replace('</video>','').replace(' muted playsinline','').replace('src="assets/part2.mp4"',f'src="assets/evidence-{freeze}.png"');tag=re.sub(r' data-media-start="[^"]+"','',tag)
 s=s[:m.start()]+tag+s[m.end():];f.write_text(s)
change('supplier',0,source=31)
change('supplier',3,crop=(1240,280,480,300))
change('workflow',0,source=37)
change('workflow',2,crop=(483,430,950,225),freeze='matrix')
change('review',0,source=163,crop=(445,48,1030,620))
change('review',1,crop=(483,430,950,530))
change('review',2,source=220,crop=(500,205,920,520))
change('review',3,crop=(500,205,920,380))
change('control',1,crop=(480,230,960,385),freeze='integrity')
change('control',2,crop=(970,620,460,340),freeze='integrity')
scenes=[('opening',0,16),('supplier',16,33),('workflow',49,32),('review',81,48),('control',129,27),('mcp',156,24)]
index=p/'index.html';s=index.read_text()
for name,st,dur in scenes[:-1]:
 f=p/f'compositions/{name}.html';text=f.read_text();text=text.replace(f'data-duration="{dur}"',f'data-duration="{dur+.4}"',1)
 tags=list(re.finditer(r'<(?:video|img)[^>]*\bid="[^"]+-v\d+"[^>]*>',text))
 if tags:
  m=tags[-1];tag=m.group();v=float(re.search(r'data-duration="([^"]+)"',tag).group(1));tag=re.sub(r'data-duration="[^"]+"',f'data-duration="{v+.4}"',tag);text=text[:m.start()]+tag+text[m.end():]
 f.write_text(text)
 pattern=fr'(id="{name}" class="clip scene"[^>]+data-duration="){dur}("[\s>])';s=re.sub(pattern,fr'\g<1>{dur+.4}\2',s)
index.write_text(s)
print('Applied evidence holds, readable crops, and chapter overlaps.')
