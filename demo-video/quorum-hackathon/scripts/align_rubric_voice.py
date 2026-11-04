"""Local word timestamps for the corrected narration, independent of Meta ASR."""
from pathlib import Path
import json,os,argparse
os.environ['HF_HOME']='/private/tmp/quorum-alignment-cache'
import mlx_whisper
P=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--variant',choices=['rubric','recordings'],default='rubric');parser.add_argument('--per-scene',action='store_true');args=parser.parse_args();folder='rubric' if args.variant=='rubric' else 'recordings-led'
if args.per_scene:
    scenes=json.loads((P/f'narration-{args.variant}.json').read_text())['scenes']
    placements=json.loads((P/'review'/f'{args.variant}-audio-placement.json').read_text())
    result={'text':'','segments':[]}
    for scene,placement in zip(scenes,placements):
        one=mlx_whisper.transcribe(str(P/'assets'/folder/'voice'/f"{scene['id']}.wav"),path_or_hf_repo='mlx-community/whisper-base-mlx',word_timestamps=True,language='en',initial_prompt='Quorum. Muse Spark. Meta Model API. LangGraph. Zambia. Chungu Chama.',verbose=False)
        result['text']+=one['text']
        for segment in one['segments']:
            segment['start']+=placement['start'];segment['end']+=placement['start']
            for word in segment.get('words',[]):word['start']+=placement['start'];word['end']+=placement['start']
            result['segments'].append(segment)
else:
    result=mlx_whisper.transcribe(str(P/'assets'/folder/'voice-master.wav'),path_or_hf_repo='mlx-community/whisper-base-mlx',word_timestamps=True,language='en',initial_prompt='Quorum. Muse Spark. LangGraph. Zambian kwacha. Chungu Chama.',verbose=False)
(P/'review'/f'{args.variant}-word-timestamps.json').write_text(json.dumps(result,indent=2)+'\n')
print(result['text'])
