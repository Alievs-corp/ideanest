# Production — setup, capture, render, QA

## 1. Where the film lives

`apps/promo` — a private pnpm workspace package built with [Remotion](https://www.remotion.dev)
(React compositions rendered to video). It is a workspace member so it can depend on
`@ideanest/design-tokens` and `@ideanest/money` with `workspace:*` and share the repo's
strict TypeScript settings.

```
apps/promo/
  package.json          private, "name": "@ideanest/promo"
  remotion.config.ts
  captures.json         every shot to record: id, route/deep link, actions, length
  LICENSES.md           music, SFX, fonts, avatar images: source + licence
  src/
    index.ts            registerRoot
    Root.tsx            one <Composition> per film × aspect × language
    motion.ts           FPS, BPM, BEAT, ease, springs, dur  (motion reference §2)
    copy.ts             reads headlines from @ideanest/messages
    device/             Device frame, StatusBar, Screen, Glass sweep
    fx/                 Spark, Trail, TapRing, Grain, StudioBackground, Shadow
    text/               LineRise, WordDrop, KeywordPill, HandUnderline, Wordmark
    ui/                 PopOut, ExplodedList, NestRing, Odometer, CountUp
    transitions/        SparkCarry, SheetWipe, Whip, Dive, RadialReveal, BackgroundSwap
    scenes/             Hook, Create, Gather, Montage, Pledge, Funded, Resolve, EndCard
  public/
    captures/           git-ignored: converted screen recordings
    audio/              git-ignored if licence forbids redistribution
  out/                  git-ignored: renders
```

Dependencies: `remotion`, `@remotion/cli`, `@remotion/motion-blur`,
`@remotion/google-fonts`, `react` and `react-dom` at the web app's versions. **Every
`remotion` and `@remotion/*` package pinned to the same exact version** — Remotion
refuses mismatched versions.

Notes for this repository:

- Adding the package changes `pnpm-lock.yaml`, which runs the web and mobile CI jobs once.
  Later changes inside `apps/promo/**` alone match no CI filter, so `CI complete` passes
  without them; add a promo typecheck job to `ci.yml` (and to `ci-complete`'s `needs`
  *and* its checked list, per CLAUDE.md §1) when the package lands.
- The web Docker image copies only the package manifests it names, so `apps/promo` never
  enters it.
- `pnpm` scripts break on this checkout's path (it contains `;`). Work and render from a
  semicolon-free worktree (`git worktree add C:/w/promo <branch>`) and call the CLI
  through node: `node node_modules/@remotion/cli/remotion-cli.js …` (confirm the bin path
  in `@remotion/cli/package.json`).
- Remotion is free for individuals and companies of up to three people; larger teams need
  a company licence. Check <https://www.remotion.dev/license> before commercial use.

## 2. Fonts

```ts
import { loadFont } from '@remotion/google-fonts/Inter';
export const { fontFamily } = loadFont('normal', {
  weights: ['600', '800'],
  subsets: ['latin', 'latin-ext', 'cyrillic'],
});
```

Render one frame with "Əə Ğğ Şş İı Жж" before building anything else and look at it.

## 3. Capturing the app

Use the release APK on the USB phone (`ideanest-device-test` skill: semicolon-free
worktree, install, deep links). Log in to the demo account with the seeded fictional
campaigns.

Clean status bar (Android SystemUI demo mode; some vendor ROMs ignore it — then crop the
status bar and let `device/StatusBar` draw it):

```bash
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
adb shell settings put system show_touches 0
adb shell settings put system pointer_location 0
```

Record each shot from `captures.json` (screenrecord stops at 3 minutes; keep shots short):

```bash
adb shell screenrecord --bit-rate 20000000 /sdcard/shot-create.mp4   # Ctrl+C to stop
adb pull /sdcard/shot-create.mp4 apps/promo/public/captures/raw/
adb shell am broadcast -a com.android.systemui.demo -e command exit
```

Capture rules: native resolution, the system's animations at 1×, slow deliberate taps
(the film adds tap rings; real touches are hidden), 1 s of stillness before and after
every action so there is room to cut on the beat, light and dark device appearance as
the shot list says.

`screenrecord` writes variable frame rate. Convert every shot to constant 60 fps before
Remotion reads it:

```bash
FF=ffmpeg   # or: python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"
$FF -i raw/shot-create.mp4 -vf fps=60 -c:v libx264 -crf 12 -preset slow -pix_fmt yuv420p -an shot-create.mp4
```

Play captures with `<OffthreadVideo>`; speed up at most 1.5× and remove dead time by
cutting, not by ramping.

## 4. Music and sound

- Original track: generate at 120 BPM (for example with Higgsfield `seed_audio`) and keep
  the prompt and output id in `LICENSES.md`; or license a library track and store the
  licence reference there.
- Mark the beat grid first: the track's first downbeat must sit on frame 0 of bar 1.
  Check it by rendering bar 1–2 with a visible beat flash and listening.
- SFX are short, dry and quiet; the music carries the energy.

## 5. Rendering

```bash
R="node node_modules/@remotion/cli/remotion-cli.js"
$R studio src/index.ts
$R render src/index.ts SparkToNest-9x16-az out/spark-to-nest-9x16-az.mp4 \
  --codec=h264 --crf=16 --pixel-format=yuv420p --audio-codec=aac --audio-bitrate=320k
$R still src/index.ts SparkToNest-9x16-az out/spark-to-nest-9x16-az.png --frame=1799
$FF -i out/spark-to-nest-9x16-az.mp4 -c copy -movflags +faststart out/spark-to-nest-9x16-az.final.mp4
```

Composition ids: `<Film>-<aspect>-<lang>`, e.g. `SparkToNest-1x1-en`, `Bumper6-9x16-ru`.
Preview with motion blur off; final renders with it on.

## 6. QA gates — run all, read all

```bash
F=out/spark-to-nest-9x16-az.final.mp4

# Specs: 1080x1920, 60 fps, h264 High, yuv420p, aac 48 kHz
$FF -i $F 2>&1 | grep -E "Duration|Stream"

# Contact sheet: 2 fps, then open the PNG and read every frame
$FF -v error -y -i $F -vf "fps=2,scale=216:-1,tile=10x6" -frames:v 1 out/sheet.png

# Pause test: 12 evenly spaced full-resolution frames, each must stand as a poster
$FF -v error -y -i $F -vf "fps=12/30" out/pause-%02d.png

# Loudness: I ≈ −14 LUFS, true peak ≤ −1 dBTP
$FF -i $F -vn -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|Peak:" | tail -2

# Flash check input: per-frame mean luma
$FF -v error -i $F -vf "scale=96:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=out/luma.txt" -f null -
```

Flash count, `apps/promo/scripts/flash.py out/luma.txt 60` (whole-frame proxy for WCAG
2.3.1: a monotonic luma swing of ≥ 10% of range is one transition, a pair of opposing
transitions is one flash, more than 3 flashes in any one-second window fails):

```python
import re, sys
fps = int(sys.argv[2]) if len(sys.argv) > 2 else 60
y = [float(m) for m in re.findall(r"YAVG=([\d.]+)", open(sys.argv[1]).read())]
swings, start, sign = [], 0, 0
for i in range(1, len(y)):
    s = (y[i] > y[i - 1]) - (y[i] < y[i - 1])
    if s != sign:
        if sign and abs(y[i - 1] - y[start]) >= 25.5:
            swings.append(i - 1)
        start, sign = i - 1, s
if sign and abs(y[-1] - y[start]) >= 25.5:
    swings.append(len(y) - 1)
worst = max((sum(1 for t in swings if s <= t < s + fps) // 2 for s in range(len(y))), default=0)
print(f"{len(swings)} luminance swings; worst flashes per second: {worst}")
sys.exit(1 if worst > 3 else 0)
```

Calibration (2026-10-12): reference A, the beat-strobe promo, measures 27 swings and 2
flashes per second at worst — passing, but with one flash of headroom; a synthetic 5 Hz
black/white strobe measures 5 and fails. Our T7 cap keeps the film at or below A.

This proxy misses flashes confined to part of the frame. Before a paid campaign, run the
render through a dedicated photosensitivity analyser as well.

Then, by eye:

- Watch the whole film muted: does the story land from the headlines alone?
- Watch it on a phone at arm's length: is every headline readable for its whole hold?
- Every headline/surface pair is one the token contrast table accepts.
- Lime appears once (the CTA); success appears once (Funded).
- No frame shows real people's data, third-party brands, or a status bar with
  notifications.

Report the results in the pull request or the reply: which gates passed with their
numbers, which failed, which were not run and why.
