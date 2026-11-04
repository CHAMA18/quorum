"""Align source narration wording to locally recognised word timestamps."""
from pathlib import Path
import json,re,difflib,argparse
P=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--variant',choices=['rubric','recordings'],default='rubric');args=parser.parse_args();variant=args.variant
script=json.loads((P/f'narration-{variant}.json').read_text())
placed=json.loads((P/'review'/f'{variant}-audio-placement.json').read_text())
recognised=json.loads((P/'review'/f'{variant}-word-timestamps.json').read_text())
allwords=[w for s in recognised['segments']for w in s.get('words',[])]
norm=lambda w:''.join(re.findall(r'\w+',w.lower()))
output=[];diagnostics=[]
for scene,placement in zip(script['scenes'],placed):
 expected=scene['text'].split();actual=[w for w in allwords if w['start']>=placement['start']-.2 and w['start']<placement['end']+.15]
 if not actual:raise RuntimeError('No word timestamps: '+scene['id'])
 timings=[None]*len(expected);equal=0
 for op,a,b,c,d in difflib.SequenceMatcher(None,[norm(w)for w in expected],[norm(w['word'])for w in actual],autojunk=False).get_opcodes():
  if op=='equal':
   for i,j in zip(range(a,b),range(c,d)):timings[i]=(actual[j]['start'],actual[j]['end']);equal+=1
  elif b>a:
   start=actual[c]['start'] if c<len(actual) else actual[-1]['end'];end=actual[d-1]['end']if d>c else start+.12*(b-a)
   for i in range(a,b):timings[i]=(start+(end-start)*(i-a)/(b-a),start+(end-start)*(i-a+1)/(b-a))
 group=[];first=None;last=None
 def flush():
  global group,first,last
  if group:output.append({'start':round(first,3),'end':round(last+.08,3),'text':' '.join(group),'scene':scene['id']})
  group=[];first=None;last=None
 for word,(start,end)in zip(expected,timings):
  if group and(len(' '.join(group+[word]))>64 or end-first>4.3 or start-last>.8):flush()
  if first is None:first=start
  group.append(word);last=end
  if re.search(r'[.!?;:]$',word)and len(group)>3:flush()
 flush();diagnostics.append({'scene':scene['id'],'expectedWords':len(expected),'recognisedWords':len(actual),'exactWordAnchors':equal})
for a,b in zip(output,output[1:]):a['end']=min(a['end'],b['start']-.01)
output=[c for c in output if c['end']>c['start']]
(P/'review'/f'{variant}-aligned-captions.json').write_text(json.dumps(output,indent=2)+'\n')
(P/'review'/f'{variant}-word-alignment-report.json').write_text(json.dumps({'method':'Local Whisper word timestamps; source wording matched by sequence alignment; substitutions interpolated within recognised spans','manualListeningPerformed':False,'scenes':diagnostics,'captions':len(output)},indent=2)+'\n')
print(len(output),'caption phrases aligned to word spans')
