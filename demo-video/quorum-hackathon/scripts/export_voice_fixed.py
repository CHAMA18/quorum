"""Replace only the demo soundtrack, verify it, and preserve the previous delivery."""

from pathlib import Path
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor

P=Path(__file__).resolve().parent.parent
ORIGINAL=P/'Quorum-Hackathon-Demo-4K-3m50.mp4'
FINAL=P/'Quorum-Hackathon-Demo-4K-3m50-Voice-Fixed.mp4'
BACKUP=P/'revisions/Quorum-Hackathon-Demo-4K-3m50-before-voice-fix.mp4'


def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)


def video_hash(path):
    return subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:v:0',
                                    '-c:v','copy','-f','hash','-hash','sha256','-'],text=True).strip()


def main():
    speech=json.loads((P/'review/voice-fixed-speech-verification.json').read_text())
    assert len(speech['scenes'])==7 and all(s['word_match']>.9 for s in speech['scenes'])
    assert all(s['matched_word_median_timing_delta']<.1 for s in speech['scenes'])
    source=BACKUP if BACKUP.exists() else ORIGINAL
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(source),
         '-i',str(P/'assets/master-voice-fixed.wav'),'-map','0:v:0','-map','1:a:0',
         '-map_metadata','0','-map_chapters','0','-c:v','copy','-c:a','aac','-b:a','256k',
         '-ar','48000','-ac','2','-t','230','-movflags','+faststart',str(FINAL)])
    result=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams',
                                               '-show_chapters','-of','json',str(FINAL)],text=True))
    video=next(s for s in result['streams'] if s['codec_type']=='video')
    audio=next(s for s in result['streams'] if s['codec_type']=='audio')
    assert (video['width'],video['height'],video['r_frame_rate'])==(3840,2160,'30/1')
    assert int(video['nb_frames'])==6900 and abs(float(result['format']['duration'])-230)<.001
    assert audio['channels']==2 and audio['sample_rate']=='48000'
    assert len(result['chapters'])==7
    with ThreadPoolExecutor(max_workers=2) as pool:
        old_hash,new_hash=list(pool.map(video_hash,[source,FINAL]))
    assert old_hash==new_hash,'Encoded picture changed'
    decoded=run(['ffmpeg','-hide_banner','-i',str(FINAL),'-vn','-af',
                 'loudnorm=I=-16:TP=-1.5:LRA=10:print_format=json','-f','null','-'],capture_output=True,text=True)
    metrics=json.JSONDecoder().raw_decode(decoded.stderr[decoded.stderr.rfind('{'):])[0]
    assert -17<=float(metrics['input_i'])<=-15,metrics
    assert float(metrics['input_tp'])<=-1,metrics
    silent=run(['ffmpeg','-hide_banner','-i',str(P/'assets/narration-voice-fixed.wav'),
                '-af','silencedetect=noise=-40dB:d=2','-f','null','-'],capture_output=True,text=True)
    starts=[float(s) for s in re.findall(r'silence_start: ([0-9.]+)',silent.stderr)]
    ends=[float(s) for s in re.findall(r'silence_end: ([0-9.]+)',silent.stderr)]
    if len(ends)<len(starts):ends.append(230.)
    ranges=list(zip(starts,ends));assert all(b-a<3 for a,b in ranges),ranges
    repair=json.loads((P/'review/voice-continuity-repair.json').read_text())
    result.update({'picture_packet_hash':new_hash,'picture_identical_to_previous_delivery':True,
                   'audio_full_decode_passed':True,'audio_loudness':metrics,
                   'last_word_end':speech['last_word_end'],'voice_silent_ranges_over_2_seconds':ranges,
                   'scene_voice_levels':repair['scene_level_matching'],
                   'pause_boundaries_repaired':len(repair['pause_repairs']),
                   'narration_verification':[ {k:v for k,v in s.items() if k!='segments'} for s in speech['scenes']]})
    (P/'review/voice-fixed-final-verification.json').write_text(json.dumps(result,indent=2))
    # Keep the exact previously supplied file before atomically updating its requested path.
    if not BACKUP.exists():os.link(ORIGINAL,BACKUP)
    link=P/'.voice-fixed-canonical.mp4'
    if link.exists():link.unlink()
    os.link(FINAL,link);os.replace(link,ORIGINAL)
    print(json.dumps({'file':str(FINAL),'canonical_file_updated':str(ORIGINAL),
                      'duration':230,'frames':6900,'picture_identical':True,
                      'loudness':metrics,'size_mb':round(FINAL.stat().st_size/1e6,2),
                      'last_word_end':speech['last_word_end']}),flush=True)


if __name__=='__main__':main()
