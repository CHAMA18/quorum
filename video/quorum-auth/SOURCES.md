# Quorum auth film — sources and build

A silent 12-second loop for the two authentication story panels: a city at first
light, the file being printed, a hand signing it, and the record closing under a
red registration seal.

## Footage

All footage is from [Pexels](https://www.pexels.com/license/) under the Pexels
license (free to use, no attribution required). Downloaded 29 October 2026.

| Asset             | Pexels clip | Used for                         |
| ----------------- | ----------- | -------------------------------- |
| `assets/city.mp4` | 29069413    | City at first light              |
| `assets/press.mp4`| 29975893    | Printing-press detail / the file |
| `assets/signature.mp4` | 7578633 | Hand signing the record          |

The clips were cropped to 4:5, normalised to 30 fps, and colour-treated in
HyperFrames with a restrained warm-noir grade and fine grain.

## Build

```bash
cd video/quorum-auth
npx hyperframes check
npx hyperframes render --format mp4 --quality looks --crf 20 \
  --output renders/quorum-auth-loop.mp4
```

The delivered files are `public/media/quorum-auth-loop.mp4` (1080×1350, 30 fps,
12 s, silent) and `public/media/quorum-auth-poster.jpg`.
