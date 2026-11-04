from pathlib import Path
import re,html,json,zipfile
p=Path(__file__).resolve().parent.parent
backup=p/'revisions/before-fullscreen.zip';backup.parent.mkdir(exist_ok=True)
if not backup.exists():
 with zipfile.ZipFile(backup,'w',zipfile.ZIP_DEFLATED) as z:
  for f in [p/'index.html',p/'SPEC.md',p/'REVIEW.md',*sorted((p/'compositions').glob('*.html'))]:z.write(f,str(f.relative_to(p)))
base='''*{box-sizing:border-box;margin:0} #root{width:100%;height:100%;position:relative;overflow:hidden;background:#121318;color:#f5f2ed;font-family:Montserrat,sans-serif}.viewport{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#121318}video,img.clip{position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:cover}.section-title{position:absolute;left:480px;top:110px;width:960px;text-align:center;z-index:20}.section-title span{display:inline-block;max-width:100%;font-size:34px;line-height:1.25;font-weight:700;letter-spacing:-.025em;background:rgba(12,13,16,.92);padding:12px 24px;border-radius:5px}.intro-card{position:absolute;left:96px;top:705px;width:1160px;z-index:20}.intro-card-inner{display:inline-block;padding:22px 28px;background:rgba(12,13,16,.92);border-radius:6px}.intro-head{font-size:48px;line-height:1.16;font-weight:700;letter-spacing:-.035em}.intro-sub{font-size:28px;line-height:1.35;color:#ddd4d0;margin-top:12px}.accent{color:#ff958b}.demo-label{position:absolute;right:96px;top:1010px;font:400 28px/1.2 Montserrat,sans-serif;color:#f5f2ed;background:rgba(12,13,16,.92);padding:6px 12px;border-radius:4px;z-index:20}'''
meta=[]
for name,duration in [('opening',16.4),('supplier',33.4),('workflow',32.4),('review',48.4),('control',27.4)]:
 file=p/f'compositions/{name}.html';s=file.read_text()
 media=[]
 for m in re.finditer(r'<(video|img)\b[^>]*\bid="'+name+r'-v\d+"[^>]*>(?:</video>)?',s):
  tag=m.group();tag=re.sub(r'\sstyle="[^"]*"','',tag)
  if name=='opening':tag=re.sub(r'data-duration="[^"]+"',f'data-duration="{duration}"',tag)
  media.append(tag)
 if not media:raise RuntimeError('No source media found for '+name)
 if name=='opening':
  overlay='''<div id="opening-problem" class="clip intro-card" data-start="0" data-duration="4.3" data-track-index="1"><div class="intro-card-inner"><div class="intro-head">Procurement delays reach people.</div><div class="intro-sub">A hospital cannot use a tender still waiting for review.</div></div></div><div id="opening-answer" class="clip intro-card" data-start="4.3" data-duration="9.5" data-track-index="1"><div class="intro-card-inner"><div class="intro-head">A clearer review. <span class="accent">A human decision.</span></div><div class="intro-sub">AI-assisted procurement for public institutions.</div></div></div>'''
 else:
  title={'supplier':'From upload to insight.','workflow':'One tender. One connected file.','review':'Evidence gaps become clear questions.','control':'People retain the decision.'}[name]
  overlay=f'<div id="{name}-chapter" class="clip section-title" data-start="0" data-duration="3.6" data-track-index="1"><span>{title}</span></div>'
  if name=='workflow':overlay+='<div id="workflow-demo-label" class="clip demo-label" data-start="0" data-duration="8" data-track-index="2">Demonstration tender data</div>'
 anim=[]
 for tag in media[1:]:
  ident=re.search(r'\sid="([^"]+)"',tag).group(1);st=re.search(r'data-start="([^"]+)"',tag).group(1)
  anim.append(f'tl.fromTo("#{ident}",{{opacity:0}},{{opacity:1,duration:.32,ease:"power2.inOut",immediateRender:false}},{st});')
 if name!='opening':
  anim.append(f'tl.fromTo("#{name}-chapter span",{{opacity:0,y:-10}},{{opacity:1,y:0,duration:.35,ease:"power3.out"}},.12);')
  anim.append(f'tl.to("#{name}-chapter span",{{opacity:0,duration:.3,ease:"power2.inOut"}},3.25);')
 else:
  anim.append('tl.to("#opening-problem .intro-card-inner",{opacity:0,duration:.25,ease:"power2.inOut"},4.02);')
  anim.append('tl.fromTo("#opening-answer .intro-card-inner",{opacity:0,y:10},{opacity:1,y:0,duration:.45,ease:"power3.out"},4.3);')
  anim.append('tl.to("#opening-answer .intro-card-inner",{opacity:0,duration:.35,ease:"power2.inOut"},13.4);')
 file.write_text(f'<template><style>{base}</style><div id="root" data-composition-id="{name}" data-duration="{duration}" data-width="1920" data-height="1080"><div class="viewport" id="{name}-viewport">'+''.join(media)+'</div>'+overlay+'</div><script>const tl=gsap.timeline({paused:true});'+''.join(anim)+f'window.__timelines["{name}"]=tl;</script></template>')
 meta.append({'scene':name,'mediaCount':len(media),'bounds':[0,0,1920,1080],'sourceAspectRatio':'16:9, original recording fully visible'})
# Caption backgrounds sit over the full-size picture; no strip is reserved for them.
f=p/'compositions/captions.html';s=f.read_text().replace('top:920px','top:910px').replace('background:#121318;padding:7px 22px','background:rgba(12,13,16,.92);padding:7px 22px');f.write_text(s)
f=p/'index.html';s=f.read_text().replace('src="assets/master.wav"','src="assets/master-delivery.wav"');s=s.replace('tl.fromTo("#workflow",{x:90,opacity:0},{x:0,opacity:1,duration:.4,ease:"power3.out",immediateRender:false},49);','tl.fromTo("#workflow",{opacity:0},{opacity:1,duration:.4,ease:"power2.inOut",immediateRender:false},49);');f.write_text(s)
(p/'review/fullscreen-layout.json').write_text(json.dumps(meta,indent=2))
f=p/'SPEC.md';s=f.read_text();s+='\nFULL-SCREEN REVISION: Every product video and evidence image fills 1920×1080 from x=0, y=0. Original 16:9 screen recordings remain completely visible. Large header/footer areas, inset borders and split intro are removed. Temporary 34px chapter labels and 36px captions overlay the image. Existing speech, music, shot sources, scene times, published MCP and total 180s duration are retained.\n';f.write_text(s)
f=p/'BRIEF.md';s=f.read_text();s+='\nUser revision: screen content should fill the whole frame. Apply edge-to-edge source footage across all five product scenes; captions are overlays. Render a new full-screen MP4.\n';f.write_text(s)
print('Full-screen layouts written for',len(meta),'product scenes; original audio and timing retained.')
