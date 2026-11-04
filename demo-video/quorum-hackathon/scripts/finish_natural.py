from pathlib import Path
import json,re,html,subprocess,shutil
p=Path(__file__).resolve().parent.parent
# Map the original transcript through the speech edit and its gentle 3% slow-down.
plan=json.loads((p/'natural-voice-edits.json').read_text())
original=json.loads((p/'original-transcript.json').read_text())
(p/'original-transcript.json').write_text(json.dumps(original,indent=2))
words=[];offset=0;speed=.97
for i,(a,b) in enumerate(plan['keep_ranges']):
 for w in original['words']:
  if w['type']=='word' and a<=w['start']<b:
   text=w['text'].replace('Corum','Quorum').replace('Corum.','Quorum.')
   words.append({'text':text,'start':.7+(offset+w['start']-a)/speed,'end':.7+(offset+min(w['end'],b)-a)/speed})
 offset+=b-a-.018
captions=[];group=[]
for i,w in enumerate(words):
 group.append(w)
 if len(group)>=7 or re.search('[.!?,:]$',w['text']) or i==len(words)-1:
  captions.append({'text':' '.join(x['text'] for x in group),'start':group[0]['start'],'end':group[-1]['end']+.08,'kind':'spoken'});group=[]
tour=[
 (54,60,'Move from the notice to mandatory requirements.'),
 (60,67,'Assess every bidder against the issued criteria.'),
 (67,74,'Technical capability: 60%. Delivery schedule: 40%.'),
 (74,80,'Keep scores and evidence in the same tender file.'),
 (82,87,'Run a read-only review against the issued criteria.'),
 (87,94,'Include every admitted bidder. Consent is explicit.'),
 (94,100,'Compare both bidders against the same requirements.'),
 (100,107,'Missing evidence stays “not evidenced.”'),
 (107,114,'Turn evidence gaps into questions for the committee.'),
 (114,121,'Verify references, delivery milestones and price build-up.'),
 (121,128,'AI advice does not score, rank, or award the tender.'),
 (130,136,'Inspect evaluator sheets, score differences and consensus.'),
 (136,143,'Inspect score differences and the recorded consensus.'),
 (143,150,'Keep decision records alongside the evaluation.'),
 (150,155,'Keep award, contract and complaint records connected.'),
 (157,162,'We have published Quorum’s MCP integration.'),
 (162,169,'Connect compatible AI clients to its read-only tools.')]
captions.extend({'text':t,'start':a,'end':b,'kind':'guide'} for a,b,t in tour)
for i,c in enumerate(captions):
 if i+1<len(captions):c['end']=min(c['end'],captions[i+1]['start']-.015)
caphtml=''.join(f'<div id="cap-{i}" class="clip caption" data-start="{c["start"]:.3f}" data-duration="{c["end"]-c["start"]:.3f}" data-track-index="0"><span>{html.escape(c["text"])}</span></div>' for i,c in enumerate(captions))
(p/'compositions/captions.html').write_text('<template><style>#root{width:100%;height:100%;position:relative;pointer-events:none}.caption{position:absolute;left:192px;right:192px;top:920px;text-align:center;font:400 36px/1.25 Montserrat,sans-serif;color:#f5f2ed}.caption span{display:inline-block;background:#121318;padding:7px 22px;border-radius:4px}</style><div id="root" data-composition-id="captions" data-duration="180" data-width="1920" data-height="1080">'+caphtml+'</div><script>const tl=gsap.timeline({paused:true});window.__timelines["captions"]=tl;</script></template>')
def stamp(s):
 ms=round(s*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
(p/'Quorum-Demo.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}' for i,c in enumerate(captions))+'\n')
(p/'captions.json').write_text(json.dumps(captions,indent=2))
# Spread the actual recorded speech into the 180-second mix; preserve its voice and pitch.
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(p/'assets/natural-voice-clean.wav'),'-af','adelay=700,apad,atrim=duration=180','-c:a','pcm_s24le',str(p/'assets/narration.wav')],check=True)
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(p/'assets/narration.wav'),'-ss','33','-i',str(p/'assets/signal-to-noise.mp3'),'-filter_complex',"[0:a]aformat=channel_layouts=stereo,asplit=2[voice][key];[1:a]atrim=duration=180,asetpts=PTS-STARTPTS,highpass=f=100,lowpass=f=11000,equalizer=f=2200:width_type=o:width=2:g=-7,loudnorm=I=-25:TP=-5:LRA=8,aresample=48000,volume='if(lt(t,49),0.6,if(lt(t,55),0.6+(t-49)/6,1.6))':eval=frame,afade=t=in:d=1.5,afade=t=out:st=175:d=5[music];[music][key]sidechaincompress=threshold=0.018:ratio=4:attack=30:release=500:makeup=1[ducked];[voice][ducked]amix=inputs=2:normalize=0,atrim=duration=180,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000[mix]",'-map','[mix]','-c:a','pcm_s24le',str(p/'assets/master.wav')],check=True)
f=p/'index.html';s=f.read_text().replace('data-volume="0"','data-volume="1"');f.write_text(s)
f=p/'compositions/mcp.html';s=f.read_text().replace('Published MCP.<div class="accent">Quorum, in your AI tools.</div>','Published MCP.<div class="accent">Quorum, in your AI tools.</div>');f.write_text(s)
(p/'VIDEO-DESCRIPTION.txt').write_text('Quorum — AI-assisted procurement, with people in control.\n\nProduct: https://quorum-solutions.com\nPublished MCP: https://m8ven.ai/mcp/chama18-quorum-5uxqrc\n\nVoice: the creator’s actual recorded speech, edited to remove hesitations and repeated phrases. No predefined or cloned narrator. The supplied second recording is silent; on-screen guidance carries that walkthrough. Demonstration tender data; AI advice does not score, rank or award. The remote MCP surface is read only.\n\nMusic: “Signal to Noise” by Scott Buckley — released under CC BY 4.0. www.scottbuckley.com.au\nTrack (No Piano Melody mix): https://www.scottbuckley.com.au/library/signal-to-noise/\nLicense: https://creativecommons.org/licenses/by/4.0/\nMusic trimmed, level adjusted, equalized and ducked under speech. Include this music attribution in the public upload description.\n')
(p/'README.md').write_text('# Quorum — three-minute hackathon demo\n\nFinal delivery: Quorum-Hackathon-Demo-3min.mp4.\n\n1920×1080, 30fps, exactly 180 seconds. Voice is actual speech from Part 1.mp4 with hesitation edits, gentle noise reduction, dynamics and a pitch-preserving 3% slow-down. Part 2.mp4 is silent and receives on-screen guidance. No predefined narrator or synthetic clone is used.\n\nEdit the six scene files in compositions/ and index.html, or open the project in HyperFrames.\n\nPreview: `npx hyperframes@0.9.9 preview --background`\nCheck: `npx hyperframes@0.9.9 check`\nRender: `npx hyperframes@0.9.9 render --quality delivery --output Quorum-Hackathon-Demo-3min.mp4`\n\nThe original source videos are copied into assets/. Natural voice editing decisions are in natural-voice-edits.json; spoken subtitles and on-screen guide cues are distinguished in captions.json.\n\nCopy the music credit from VIDEO-DESCRIPTION.txt into the public upload description.\n')
print('Natural voice master complete; captions:',len(captions))
