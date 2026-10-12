# @ideanest/promo

The IdeyaNest promo film, "Spark to Nest", built with [Remotion](https://www.remotion.dev):
React compositions rendered to video. How the film is written, animated and checked is
the `promo-video` skill (`.claude/skills/promo-video/`); read it before changing a scene.

## Compositions

| Id | Size | Length |
|---|---|---|
| `SparkToNest-9x16-az` | 1080×1920, 60 fps | 30 s (1800 frames) |
| `SparkToNest-9x16-en` | 1080×1920, 60 fps | 30 s |
| `SparkToNest-9x16-ru` | 1080×1920, 60 fps | 30 s |

Azerbaijani is the master. The English and Russian lines in `src/copy.ts` are drafts and
have not been approved.

## Making a render

Media is not committed. `public/media/` is built from the screen recordings listed in
`captures.json` and from the generated soundtrack:

```bash
pip install numpy imageio-ffmpeg        # once
PROMO_CAPTURES="<folder with the recordings>" pnpm prepare-media
pnpm render            # out/spark-to-nest-9x16-az.{master.mp4,mp4,png}
pnpm render az en ru   # every language
python scripts/qa.py out/spark-to-nest-9x16-az.mp4
pnpm studio            # preview and scrub
node scripts/stills.mjs az 140 790   # half-size review stills, one bundle
```

`render` writes three files per language: the CRF 16 master (about 175 MB, because the
film grain defeats compression), the delivery file (16 Mbps H.264 High, TV-range bt709,
AAC 320k, faststart; about 55 MB) and the poster frame. Upload the delivery file.

`qa.py` prints the stream specs, the loudness and true peak, and the worst flashes per
second, and writes a contact sheet and twelve pause frames to `out/qa/`. Read them: the
script cannot tell whether a frame looks right.

The main checkout's path contains a `;`, which breaks `pnpm` scripts. Work from a
worktree whose path has none (`git worktree add C:/dev/promo <branch>`).

## Layout

| Path | What |
|---|---|
| `src/timeline.json` | Scene spans, cues and sound cues in frames. Read by the film and by `soundtrack.py`, so picture and sound cannot drift |
| `src/motion.ts` | Beat grid, curves, springs and durations. No scene has its own numbers |
| `src/camera.ts`, `src/poses.ts` | The 3D device camera and every shot's pose. `project()` mirrors the CSS transform, so the spark lands exactly on a button inside a tilted phone |
| `src/scenes/` | The film, bar by bar |
| `src/device/`, `src/fx/`, `src/text/`, `src/ui/` | Device frame, light and effects, type motion, signature pieces |
| `scripts/` | Media preparation, soundtrack synthesis, render and QA |
| `LICENSES.md` | Every asset and its terms. Publish nothing while a row is open |

Tests (`pnpm test`) hold the rules a render cannot be trusted to show: every cue on the
beat grid, money counted in decimal and printed as the app prints it, two-line five-word
headlines, no colour outside the tokens, lime only on the call to action, AA contrast for
every text and surface pair, and a camera that frames a point exactly where a shot asks.
