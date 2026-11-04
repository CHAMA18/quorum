# Demo build scripts

Each script resolves the project root from its own location, so it can be run
from anywhere:

```sh
python3 scripts/remaster_audio.py
python3 scripts/verify_fixed_voice.py
```

Current helpers:

- `remaster_audio.py` — rebuilds the clean soundtrack and the final MP4.
- `verify_fixed_voice.py` — transcribes the narration and checks word timing.
- `export_voice_fixed.py` — attaches a rebuilt master to the preserved picture.
- `finish_recommendation_4k.py` — attaches the UHD master and chapter markers.

The remaining scripts document earlier edits and expect the asset names recorded
in the matching `review/` report.
