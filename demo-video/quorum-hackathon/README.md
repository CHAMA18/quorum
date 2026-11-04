# Quorum — 3:50 hackathon demo in 4K

Latest delivery: [Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4](https://github.com/CHAMA18/quorum/releases/download/demo-v1/Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4) — see [DELIVERY.md](DELIVERY.md) for the release page and SHA-256. The 181.5 MB master is distributed as a release asset because GitHub's LFS budget is exhausted and it exceeds the 100 MB per-file Git limit. The attached Quorum-Hackathon-Demo-4K-3m50-Voice-Fixed.mp4 path points to the same local bytes. The pre-remaster version is preserved at revisions/Quorum-Hackathon-Demo-4K-3m50-before-noise-removal.mp4.

3840×2160, 30 fps, exactly 230 seconds. The added chapter at 2:05–2:55 shows the actual AI recommendation, bidder evidence summaries, committee panel, and member registration flow from Meta Hackathon.mp4. The recommendation remains visibly advisory; human evaluation and decision records follow it.

The opening and new chapter use the creator's actual recorded speech. The remaining narration uses the existing local Lusaka.m4a voice clone. Noise reduction is retained on the recorded speech. The generated narration is restored from its clean original without noise suppression, recovering quiet speech that the previous filter attenuated. Forty-five pause boundaries were moved into quieter waveform valleys, recorded joins use short crossfades, and section levels match within 0.3 LU. Gentle clarity and compression preserve tempo, pitch, and natural inflection. The original music is retained and mixed beneath all seven narrated scenes. There are 64 subtitle cues, with a separate Quorum-Demo.srt.

The HTML composition, captions, titles, and closing graphics render at native 4K. The original product recordings are 1920×1080 and are upscaled in the UHD export; the edit does not claim additional captured detail.

Editable source: index.html and compositions/. The final audio master and editable stems are local-only (ignored by Git); the master is in the demo-v1 release, and the stems can be rebuilt with scripts/remaster_audio.py. Source recordings are in demo-video/source. The source clips and music track in assets/ are also local-only; see DELIVERY.md for the inventory. No speech-model download or media API is needed to render the existing edit.

## Project layout

- `index.html`, `compositions/` — HyperFrames composition source.
- `assets/` — media required to render the current cut.
- `scripts/` — build, repair and verification helpers.
- `docs/` — review, narration, storyboard and upload copy.
- `review/` — machine-readable verification reports.
- `revisions/`, `renders/`, `work/` — local-only artefacts, ignored by Git.

```sh
npx --yes hyperframes@0.9.9 preview --background
npx --yes hyperframes@0.9.9 check
npx --yes hyperframes@0.9.9 render --quality delivery --resolution landscape-4k --crf 12 --workers 1 --frames-cache-dir off --output Quorum-Hackathon-Demo-4K-3m50.mp4
python3 scripts/finish_recommendation_4k.py
python3 scripts/verify_recommendation_4k.py
```

The editable local preview is http://localhost:3002/#project/quorum-hackathon when the background server is running. The HyperFrames desktop app is another editing option: https://hyperframes.studio/studio/download?src=cli

The voice repair is documented in `scripts/repair_voice_continuity.py`, `scripts/verify_fixed_voice.py`, and `scripts/export_voice_fixed.py`. Measurements and speech checks are in review/voice-continuity-repair.json, review/voice-fixed-speech-verification.json, and review/voice-fixed-final-verification.json. The final video stream matches the previous delivery byte for byte; only the soundtrack was rebuilt.

The noise-removal remaster is documented in scripts/remaster_audio.py and review/audio-noise-removal.json. It keeps the same picture and speech timing, matches the louder recorded takes to the generated narration, removes sub-rumble, rebuilds the licensed music bed with slower ducking at 23 dB below the voice, and delivers −16.01 LUFS with −1.55 dBTP after AAC encoding. The previous delivered MP4 is preserved at revisions/Quorum-Hackathon-Demo-4K-3m50-before-voice-fix.mp4.

New finishing helpers in scripts/: prepare_recommendation_voice.py, build_recommendation_revision.py, mix_lusaka_audio.py, finish_recommendation_4k.py, and verify_recommendation_4k.py. Source ranges and transcript checks are documented in review/recommendation-voice-edits.json and review/recommendation-caption-verification.json. Preparation scripts document one-time edits; the current stems are the source for rendering.

The previous Intro-Clean and Fullscreen-Lusaka MP4s are preserved. Revisions/before-recommendation-4k-source.zip contains the previous editable source. Include the licensed music attribution from docs/VIDEO-DESCRIPTION.txt when uploading. The RNNoise model source is https://github.com/GregorR/rnnoise-models.

Final verification and review evidence: docs/REVIEW.md and review/voice-fixed-final-verification.json. Audio is transcribed and measured; perceived voice similarity and naturalness are subjective.
