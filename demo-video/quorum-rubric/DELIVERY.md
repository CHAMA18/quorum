# Current submission edition

`Quorum-Hackathon-Demo-Rubric-3min.mp4` is the separate 180-second, 3840x2160, 30fps submission edition. It preserves the earlier 230-second deliveries in `../quorum-hackathon/`. Use the measured metadata in `review/delivery-verification.json` as the final technical record.

Editable source: `index.html`, seven files in `compositions/`, one captions composition, and `captions.json`. The code-generated edition can be rebuilt with `python3 scripts/build-rubric-demo.py` from the repository root after capturing the fictional production fixture and preparing its soundtrack. Audio sources are local-only; the supplied creator voice reference and existing music asset remain in the original project. See `../quorum-hackathon/scripts/` for generation, mixing and word alignment helpers. The reproducible product integration is `bun scripts/judge-proof.ts --production --keep-server`.

Runtime/render: HyperFrames 0.9.9. `render --quality delivery --resolution landscape-4k --fps 30 --workers 1 -o Quorum-Hackathon-Demo-Rubric-3min.mp4`. Single-worker streaming avoids multi-gigabyte temporary frame storage.

The UI crops are raster captures from the actual local product, enlarged for readability. Titles, evidence cards and captions render at 4K. Gate responses are excerpts from actual HTTP integration output. All procurement names, documents, prices and signing accounts in this edition are fictional. Filing is a local simulation. No national e-GP transaction, human pilot result or money recovered is claimed.

Upload credit: “Signal to Noise” by Scott Buckley, released under CC BY 4.0. https://www.scottbuckley.com.au/library/signal-to-noise/ · https://creativecommons.org/licenses/by/4.0/ . Narration is generated from the creator-authorised Lusaka voice reference. No third-party supplier tax certificate is used in this edition.
