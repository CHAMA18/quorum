# Delivery

The 4K master is published as a GitHub Release asset rather than committed to
Git. It is 181,506,041 bytes (173 MiB), above GitHub's 100 MB per-file limit,
and this account's Git LFS budget is exhausted.

- Release page: <https://github.com/CHAMA18/quorum/releases/tag/demo-v1>
- Download: <https://github.com/CHAMA18/quorum/releases/download/demo-v1/Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4>
- File: `Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4`
- Size: 181,506,041 bytes
- SHA-256: `efda2320449aefccae42ca7a091bc0eddc72e713633e5f8bc38cdccf17bae33f`

```sh
curl -L -o Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4 \
  https://github.com/CHAMA18/quorum/releases/download/demo-v1/Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4
shasum -a 256 Quorum-Hackathon-Demo-4K-3m50-Noise-Free.mp4
```

3840×2160, 30 fps, 230.000 seconds, 6,900 frames, seven chapters, AAC LC 48 kHz
stereo at 283 kb/s average, −16.01 LUFS integrated, −1.55 dBTP after encoding.
The local attached `Quorum-Hackathon-Demo-4K-3m50-Voice-Fixed.mp4` is a hard
link to the same bytes.

The editable `assets/master-noise-free.wav` (63 MB) and
`assets/narration-voice-fixed.wav` (32 MB) stems are intentionally local-only
and ignored by Git. Rebuild them with `scripts/remaster_audio.py`, or keep the
working copies alongside the project. The source clips and music track in
`assets/` (`part1.mp4`, `part2.mp4`, `meta-intro-picture.mp4`,
`recommendation-committee.mp4`, `recommendation-results.mp4`, and
`signal-to-noise.mp3`) are local-only for the same reason; the final 4K master
is the release asset above.

Music: “Signal to Noise” by Scott Buckley, released under CC BY 4.0.
Attribution and upload copy are in `docs/VIDEO-DESCRIPTION.txt`.
