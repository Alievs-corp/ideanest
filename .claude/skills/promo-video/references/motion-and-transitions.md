# Motion and transitions — the premium recipes

Every number here is a starting value tuned for the 60 fps master on the 120 BPM grid
(1 beat = 30 frames, 1 bar = 120 frames). They live **once**, in `apps/promo/src/motion.ts`,
and scenes import them. A scene with an inline `damping`, bezier or frame count is a bug,
exactly as in the app.

## 1. What makes motion read as premium

1. **Nothing moves linearly** except the constant camera drift. Entrances decelerate,
   exits accelerate, objects with mass settle on a critically damped spring.
2. **Exits are faster than entrances** — an exit takes 60–70% of the matching entrance.
   The eye cares where things arrive, not where they leave.
3. **Overlap, never queue.** The next movement starts while the previous one is still
   settling (30–50% overlap). Queued moves read as a slideshow.
4. **Stagger by 3 frames (50 ms, `STAGGER_STEP`)** between siblings; never more than 6
   siblings in one stagger — group the rest.
5. **The camera is never locked off.** A shot without drift looks like a screenshot.
6. **Depth is lit, not drawn.** Lifted things get a bigger, softer, fainter shadow; glass
   gets one specular sweep per shot.
7. **Fast movement carries motion blur.** Anything crossing more than a third of the frame
   width within 6 frames is rendered through motion blur, or it strobes.
8. **Every animation lands on the grid.** Starts and impacts fall on a beat or a
   half-beat. Off-grid motion is the single most common reason a promo feels cheap.
9. **No overshoot, no wobble.** Same character as the app (`mobile-design` §6.1): soft
   springs that settle. Energy comes from cuts and camera, not from bouncing.
10. **Hold what must be read.** A readable state stays still for at least 36 frames
    (0.6 s); a headline stays for `words × 18 + 36` frames.

## 2. `motion.ts` — the constants

```ts
import { Easing } from 'remotion';
import { STAGGER_STEP } from '@ideanest/design-tokens';

export const FPS = 60;
export const BPM = 120;
export const BEAT = (60 / BPM) * FPS;
export const HALF = BEAT / 2;
export const BAR = BEAT * 4;
export const STAGGER = Math.round((STAGGER_STEP / 1000) * FPS);

export const ease = {
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  exit: Easing.bezier(0.7, 0, 0.84, 0),
  move: Easing.bezier(0.65, 0, 0.35, 1),
  drift: Easing.linear,
};

export const springs = {
  settle: { damping: 200, mass: 1, stiffness: 120 },
  lift: { damping: 200, mass: 0.8, stiffness: 180 },
  heavy: { damping: 200, mass: 1.6, stiffness: 90 },
};

export const dur = {
  textLine: 27,
  textExit: 18,
  pop: 30,
  settle: 36,
  tapRing: 27,
  tapDip: 6,
  whipOut: 12,
  whipIn: 21,
  sheetWipe: 42,
  dive: 54,
  radialReveal: 48,
  odometerColumn: 33,
  countUp: 48,
  logoResolve: 90,
  endHold: 150,
};
```

`damping: 200` makes a Remotion `spring()` critically damped — it settles without
overshoot. Do not lower it to "add life".

## 3. Typography motion

| Move | Recipe |
|---|---|
| **Line mask rise** (default for every headline) | Each line sits in an `overflow: hidden` box. The line translates from `110%` to `0` of its own height over `dur.textLine` with `ease.enter`, lines staggered by `STAGGER × 2`. Add `opacity` 0 → 1 over the first third only, so the rise reads as a reveal, not a fade. |
| **Word drop** (hook only) | One word per beat. Each word: `translateY 40px → 0`, `scale 1.04 → 1`, opacity 0 → 1 over 18 frames, `ease.enter`. |
| **Keyword pill** | The emphasised word gets a pill behind it (`radius.full`, an accent `surface` token, text in that accent's `text` token). The pill scales on X from `0` to `1` from its left edge over 21 frames, `ease.enter`, starting 6 frames *after* the word lands. Never colour the word itself on a light surface. |
| **Hand underline** | An SVG stroke under a word, drawn with `stroke-dashoffset` from full length to 0 over 18 frames, `ease.move`, slightly tilted (−2°) and slightly longer than the word. `textPrimary` on dark, `textOnWhite` on white. Used at most twice in a film. |
| **Line exit** | Lines translate to `−110%` over `dur.textExit` with `ease.exit`, last line first. A headline never fades out in place. |
| **Headline swap** | Old headline exits while the new one enters, overlapping by 9 frames; the shared words do not move (sentence continues, as in reference C). |
| **Logo wordmark** | Letter-level reveal, left to right: each glyph `opacity 0 → 1`, `translateX 12px → 0`, 3 frames apart, plus a 6 px → 0 blur on the static text layer. The only place a dissolve is allowed. |

Type set: Inter 800 for headlines, 600 for supporting lines, tracking −0.02em, line
height 0.98. Two lines maximum per card, five words maximum per line.

## 4. Device and camera

| Move | Recipe |
|---|---|
| **Studio** | Background is a radial gradient from `surface3` (centre-low) to `surface1` (edges) plus a faint floor glow: an ellipse of the scene's accent `glow` token under the device, blurred, opacity 0.6. All colours from tokens. |
| **Device** | Our own frame (see SKILL.md §5): rounded body, `shadow.float` under it, screen inset with the capture. Built in CSS 3D: a `perspective: 2200px` stage, the device rotated with `rotateX`/`rotateY`/`rotateZ`. Keep `rotateY` within ±28° and `rotateX` within 0–22° so the screen stays readable. |
| **Drift** (always on) | Over the whole shot: `rotateY` changes by 4–6°, `scale` by 3%, `translateY` by 1.5% of frame height, `ease.drift`. Direction alternates shot to shot so cuts feel like a moving camera. |
| **Orbit** | `rotateY` from −24° to +8° across a bar on `ease.move`, device translating opposite to the rotation by ~4% so it pivots around its centre of mass. |
| **Push-in** | `scale` 1 → 1.9 over 1–2 beats, `ease.move`, transform-origin on the UI element being shown; background plate blurs 0 → 12 px as it happens (depth of field). |
| **Pull-back** | Exact inverse of the push-in, 70% of its duration. |
| **Parallax** | Three planes: background plate moves at 0.3× the camera, device at 1×, popped-out elements at 1.3×. |
| **Specular sweep** | A diagonal white gradient band (opacity 0.10 at its peak) translates across the glass from top-left to bottom-right over 40 frames, once per device shot, starting on a beat. Masked to the screen. |
| **Contact shadow** | A second, tight, darker shadow just under the device; as the device rises, it shrinks and fades (`scale 1 → 0.85`, `opacity 1 → 0.5`). |

## 5. UI staging

| Move | Recipe |
|---|---|
| **Pop-out card** | A copy of the card is cut from the capture (same pixels, exact crop) and placed on its own plane above the screen. It lifts with `springs.lift`: `translateZ` 0 → 120px (or `scale 1 → 1.14` with `translateY −4%`), its shadow growing from `shadow.panel` to `shadow.float`. Holds one beat, settles back with `springs.settle` exactly onto the underlying pixels — misregistration of even 2 px is visible, so verify the crop by toggling it. |
| **Exploded list** | List rows cut out as separate planes, fanned along a diagonal with `translateZ` steps of 40px and `rotateX 18°`, staggered by `STAGGER`, `springs.lift`; collapse back with `springs.settle` in reverse order. |
| **Tap ring** | On the tapped point: a ring (2 px `textPrimary` stroke on dark UI, `textOnWhite` on white UI) scaling `0.6 → 1.6` with opacity `0.5 → 0` over `dur.tapRing`, `ease.enter`. The tapped element dips `scale 1 → 0.97 → 1` over `dur.tapDip × 2`. Taps land on a beat. No cursor, no hand. |
| **Macro** | A component (tab bar, progress bar, pledge button) filling 80% of the frame width, slight `rotateX 12°`, drift on. Use the real capture scaled up — captures must be recorded at the device's native resolution so a 2× macro stays sharp. |
| **Nest ring** (signature) | Backer avatars enter from outside the frame along curved paths (quadratic bezier, `ease.enter`), staggered by `STAGGER`, and settle into a circle around the campaign card at radius ≈ 0.62 × card width. Each lands with a 3-frame `scale 1.06 → 1` *settle* (not a bounce). After the last one lands, the whole ring rotates 8° over a bar, `ease.drift`. 6–9 avatars; more reads as noise. |
| **Odometer** | Each digit column is a vertical strip of 0–9 translating to the target digit over `dur.odometerColumn`, `ease.move`, columns staggered right-to-left by `STAGGER`. Thousand separators and the currency sign never move. Values from `@ideanest/money`. |
| **Count-up** | Amount raised counts from 0 to target over `dur.countUp`, `ease.enter`, formatted every frame with `@ideanest/money` (decimal, never a float). The progress bar's fill scales on X with the same curve and timing. |

## 6. Transitions — the only seven

Default is the hard cut. The others are seasoning: no more than one non-cut transition per
bar, and never the same one twice in a row.

| # | Transition | Recipe | Use |
|---|---|---|---|
| T1 | **Beat cut** | Hard cut exactly on a beat frame. The incoming shot is already in motion (drift started 12 frames before, pre-rolled), and its camera direction opposes the outgoing one. | Most cuts |
| T2 | **Spark carry** (signature) | The spark leaves the outgoing shot toward a target point, the cut happens while it travels, and in the incoming shot it continues from the same screen position and lands on the next subject (a button, a progress head, the logo). Path: `ease.move`, 24–36 frames, with a short trail (see §7). | Between story beats |
| T3 | **Sheet wipe** | A `whiteSurface` sheet with `radius.xl` top corners (scaled up proportionally) rises from the bottom edge over `dur.sheetWipe` with `springs.heavy`, covers the frame, and the next scene begins *on* the white. A soft shadow (`shadow.float`) on its leading edge. | Into a light-surface scene; mirrors the app's sheets |
| T4 | **Whip** | Outgoing device translates `0 → −140%` on X over `dur.whipOut` with `ease.exit`; cut at the fastest frame; incoming translates `+140% → 0` over `dur.whipIn` with `ease.enter`. Both halves through motion blur. | Inside the montage, max twice |
| T5 | **Dive** | Push-in into the screen until the UI fills the frame (`scale` to the screen's fit), then hard-cut to the flat full-frame capture at the identical framing, so the device "dissolves" into the product. Inverse (UI → device pull-back) opens a section. | Entering the money moment |
| T6 | **Radial reveal** | A circle of the next scene's surface grows from a point (the tapped button, the progress head) to cover the frame, `dur.radialReveal`, `ease.move`; content of the new scene rises 9 frames after the circle passes it. | Funded → success, only |
| T7 | **Background swap** | The headline and device hold still while the background alternates between two token surfaces on beats. Max 4 swaps in a row, then at least one bar without; never more than 2 swaps per second; never black ↔ white across the full frame more than twice in a film. | Montage headline cards |

Banned: cross-dissolves between shots, cube/page-turn/zoom-blur presets, glitch, light
leaks, lens flares, film burn, shake, "TikTok" bounce text, typewriter text. Each one
makes the film look like a template.

## 7. Light, trail and blur

- **Spark:** a 14 px `textPrimary` core with two glow layers (36 px and 90 px, opacity
  0.5 and 0.18). Idle, it breathes: scale 1 → 1.08 → 1 every beat. On the CTA it becomes
  the lime pill — the only lime in the film (SKILL.md §4).
- **Trail:** when the spark travels, render 6 ghost copies at the previous 6 frames'
  positions with opacity falling from 0.35 to 0.03 (`@remotion/motion-blur` `<Trail>`, or
  by hand).
- **Motion blur:** wrap whips, fast pop-outs and the spark's flight in
  `@remotion/motion-blur`'s `<CameraMotionBlur>` (samples 10, shutter 180°). Render time
  grows with samples; preview with blur off.
- **Depth of field:** blur only the background plate and only during push-ins. UI text
  is never blurred while it is meant to be read.
- **Grain:** a static, full-frame noise texture at opacity 0.035, shifted by a random
  offset every 2 frames, over everything except the end card. It removes the "vector
  flatness" that makes code-driven video look cheap.

## 8. Beats inside a shot

A typical 2-beat device shot, frame by frame at 60 fps:

| Frame | Event |
|---|---|
| −12 | Pre-roll: drift already running (so the cut lands on motion) |
| 0 | Cut (beat). Specular sweep starts |
| 0–27 | Headline line 1 rises |
| 6–33 | Headline line 2 rises |
| 30 | Beat: tap ring on the target, element dips |
| 36–66 | Pop-out lifts on `springs.lift` |
| 66–96 | Hold (readable) |
| 90–126 | Pop-out settles; next shot pre-rolls from 108 |
| 120 | Cut |

## 9. Reduced motion and flashes

A rendered film cannot honour `prefers-reduced-motion`, so the film itself stays inside the
limits instead:

- No more than 3 flashes in any 1-second window (WCAG 2.3.1). T7 is capped at 2 per
  second for that reason. Run the flash check in `production.md` §6 on every render.
- No full-frame rotation above 30°, no continuous spinning.
- Every film has a still poster frame (the end card) for autoplay-off placements and for
  the website, where the video must not autoplay for users who ask for reduced motion.
