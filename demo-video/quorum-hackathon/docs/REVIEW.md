# Final review — noise removal and remaster

Delivery: [Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4](https://github.com/CHAMA18/quorum/releases/download/demo-v1/Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4) (release asset; see [../DELIVERY.md](../DELIVERY.md) for the checksum). The attached Voice-Fixed path points to the same local bytes; the pre-remaster file is preserved at revisions/Quorum-Hackathon-Demo-4K-3m50-before-noise-removal.mp4.

The audible background in the previous mix came from two places. The creator's recorded takes were 7.9 dB brighter in sibilance and 12.5 dB brighter in the 9–16 kHz air band than the generated narration, so an air/hiss floor appeared and disappeared at 125 s and 175 s. The music bed was also ducked with a 35 ms attack and 650 ms release, producing dips of up to 12.6 dB at speech onsets.

The remaster high-passes the voice at 65 Hz, applies a 4.5 dB high shelf at 8 kHz and a 1.2 dB cut at 6.4 kHz to the recorded takes, de-esses both voices dynamically (0.30 generated, 0.50 recorded), and applies a 2.5 dB shelf at 11.5 kHz. The recorded-to-generated sibilance gap falls from +7.9 to +4.7 dB and the air gap from +12.5 to +8.6 dB. The music bed is rebuilt from the original track: 55 Hz high-pass, 15 kHz low-pass, a −13.1 dB source gain, a 45% presence carve, and −6.5 dB ducking with a 140 ms attack and 900 ms release, sitting 23 dB below the voice. The high-pass and rebuilt bed remove sub-rumble and the bed's fast pumping.

The final master measures −16.01 LUFS integrated, −1.59 dBTP before encoding and −1.55 dBTP after AAC encoding, LRA 4.4 LU. The delivery is AAC LC at 48 kHz stereo, 283 kb/s average. The H.264 packet hash is identical to the previous delivery (SHA-256 9503…ccf), so the picture is unchanged: 3840×2160, 30 fps, 6,900 frames, 230.000 s, seven chapters. Full decode passes. Speech timing is untouched, and the captions and the 228.92 s final word remain valid.

Evidence: review/audio-noise-removal.json. Perceived naturalness remains subjective; the processed audio has not been auditioned by a human reviewer.

# Voice continuity repair

Delivery: Quorum-Hackathon-Demo-4K-3m50-Voice-Fixed.mp4. The original requested Quorum-Hackathon-Demo-4K-3m50.mp4 path is updated to the same corrected file. Its previous contents are preserved at revisions/Quorum-Hackathon-Demo-4K-3m50-before-voice-fix.mp4, and the previous editable source is archived at revisions/before-voice-continuity-source.zip.

Diagnosis compared the processed narration with its original source. The old noise filter attenuated 352 originally audible 50 ms speech windows by more than 12 dB. Its fifth-percentile attenuation was 18.66 dB. This can make quiet parts of words and breaths disappear. Scene voice levels also ranged from −19.5 to −16.5 LUFS.

The repair restores the generated speech from its original continuous WAVs without noise suppression. Waveform matching preserves its position in the existing picture; 54 source sections were matched, with minimum normalised correlation 0.799. Forty-five artificial pause boundaries were moved to quieter points in the original waveform, retaining the source speech around the cuts. Recorded speech retains noise reduction with 20% aligned original detail; its internal edits use 12 ms crossfades. Gentle broad presence, 1.6:1 compression, and a latency-compensated peak ceiling keep the delivery clear. There is no global tempo or pitch change and no new noise gate.

The seven voice sections now measure between −18.8 and −18.5 LUFS. Independent transcription checks cover all seven scenes and preserve the important negations. Median word-start differences from the existing captions are 0–10 ms; the 90th-percentile differences are at most 50 ms. Existing burned-in captions therefore remain in sync. The final word ends at 228.92 seconds, and there is no voice-only silence of two seconds or longer.

The final MP4 is exactly 230.000 seconds, 3840×2160, 30 fps, and 6,900 H.264 frames. A SHA-256 hash of the copied video packets matches the preceding delivery exactly, so its previously reviewed picture is preserved without video re-encoding. All seven chapter markers remain. That delivery's soundtrack was stereo AAC at 48 kHz and 256 kb/s, measured at −16.18 LUFS integrated, −1.89 dBTP, and 4.20 LU loudness range. The encoded soundtrack passes a full decode and has peak headroom.

The editable project points to assets/master-noise-free.wav. Native 4K text and graphics, upscaled 1080p product footage, the AI recommendation at 2:05, committee sequence, and closing are retained. The project is checked again after the audio source replacement, and current preview frames cover the recommendation and closing.

Audio was compared, transcribed, and measured; it has not been auditioned by a human reviewer. Perceived timbre and naturalness remain subjective. Recorded sections and locally generated sections are still distinct source recordings of the creator's voice.

Evidence: review/voice-continuity-before.json, review/voice-continuity-repair.json, review/voice-fixed-speech-verification.json, review/voice-fixed-mix.json, review/voice-fixed-final-verification.json, review/voice-fixed-check.json, and review/voice-fixed-preview. Music attribution and upload chapter timestamps remain in VIDEO-DESCRIPTION.txt.
