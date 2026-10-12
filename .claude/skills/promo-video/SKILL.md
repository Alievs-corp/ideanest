---
name: promo-video
description: Use before planning, building, rendering or reviewing any IdeyaNest promo or marketing video — app promo, feature teaser, store preview, social reel, launch film, "promo video", "reklam videosu", "tanıtım videosu". Defines the "Spark to Nest" film system (real UI captures on a moving 3D device, beat-locked cuts, a white spark that carries the story and becomes the lime CTA), the premium motion and transition recipes, the Remotion pipeline in apps/promo, and the quality gates every render must pass.
---

# IdeyaNest promo films — "Spark to Nest"

A premium promo is not a screen recording with music. It is a short film where the
camera moves, every cut lands on the beat, one thing at a time is the hero, and any frame
you pause on is a poster. This skill is the single source of truth for how IdeyaNest
promos are written, built, animated, rendered and checked.

The owner's references (three Pinterest promos, analysed frame by frame) are in
`references/reference-videos.md`. Every animation and transition, with frame counts and
curves, is in `references/motion-and-transitions.md`. Setup, capture, render and QA
commands are in `references/production.md`. Read all three before starting.

## 1. Rules that cannot bend

1. **The UI is real.** Every pixel of app UI comes from a capture of the running app
   (screen recording or screenshot). Never AI-generated UI, never a redrawn mock-up.
   Reference B looks expensive at thumbnail size and fake when paused, because its UI is
   generated gibberish. That is the failure this rule exists for.
2. **Colours come from `@ideanest/design-tokens`.** The promo imports `colors`, `accent`,
   `radius`, `shadow` from the package. A hex literal in `apps/promo` is the same defect
   as one anywhere else in the repo.
3. **Lime means "act now".** In the film lime appears exactly once: the CTA pill on the
   end card (lime surface, `textOnLime`). A funded campaign is `success`. Lime is never
   text on a light surface, never a background swap, never a decoration.
4. **Colour never carries meaning alone** — the funded moment shows a check and words as
   well as the success colour.
5. **Money is formatted by `@ideanest/money`.** Count-ups and odometers format every
   frame from a decimal, never from a float.
6. **Demo data is fictional and seeded.** Invented campaigns, names and amounts on a demo
   account. No real users, real photos without a licence, or third-party brands.
7. **Copy is the owner's.** Draft lines live in `apps/promo/src/copy.ts` (az, en, ru), not
   in `packages/messages`, so no app bundle carries film copy. The owner approves them
   before a render is published. Azerbaijani is the master language.
8. **Publishing is the owner's call.** Rendering is fine; uploading anywhere (Reels,
   TikTok, stores, YouTube, the website) is an outward action — ask first.
9. **Flash-safe.** No more than 3 flashes in any second (WCAG 2.3.1), checked on every
   render.
10. **Nothing in the film claims more than the product does.** No "guaranteed funding",
    no invented totals presented as real platform statistics.

Rendered video is not a runtime surface, so the app's "transform and opacity only" rule
does not bind the renderer (blur and filters are allowed where §6 says). The token,
colour, contrast and money rules bind fully.

## 2. The concept — why this film is ours

**Logline:** an idea is a spark; people gather around it and it becomes a nest.

The film has one recurring object, **the spark**: a small white point of light. It is
born in the dark, falls into the Create button, rides along every transition (T2 "spark
carry"), becomes the head of the progress bar as backers arrive, and at the end gathers
into the IdeyaNest mark — and then, on the last downbeat, turns into the lime "act now"
pill. Lime appearing only there makes the CTA the brightest, most urgent thing the
viewer has seen in 30 seconds, and it keeps the token's meaning honest.

Signature moves no reference has, and which make the film recognisably IdeyaNest:

| Move | What it is | Recipe |
|---|---|---|
| **Spark carry** | The spark crosses the cut and lands on the next subject | motion §6 T2 |
| **Nest ring** | Backer avatars fly in on curves and settle in a ring around the campaign card | motion §5 |
| **Sheet wipe** | A white sheet rises over the frame exactly like the app's sheets | motion §6 T3 |
| **Odometer headline** | The amount raised rolls digit by digit as part of a headline | motion §5 |
| **Spark → mark → lime** | The ending: the spark becomes the logo, then the CTA | §3 bars 13–15 |

Borrowed and made ours: beat-cut montage, tilted cropped device and pop-out card
(reference A); moving camera, dark studio, push-in and tap rings (B); headline sentences
that tell the story with the sound off, and the message collapsing into the logo (C).

## 3. The master: 30 s beat sheet

60 fps, 120 BPM: 1 beat = 30 frames, 1 bar = 120 frames, 30 s = 15 bars = 1800 frames.
Draft copy is in English for the review; the az/en/ru lines go into the catalogue.

| Bar | Time | Picture | Headline (draft) | Motion |
|---|---|---|---|---|
| 1 | 0:00–0:02 | Black (`surface1`). The spark ignites in the centre on beat 1 and breathes on every beat | "Got an idea?" — one word per beat | Word drop; spark idle |
| 2 | 0:02–0:04 | The device rises from below the frame, tilted. The spark falls into the centre Create button; tap ring | — | Spark carry → tap ring on beat 3; device `springs.heavy` |
| 3–4 | 0:04–0:08 | Real capture of the create flow on the tilted device, drift on. On bar 4 the campaign cover card **pops out** of the glass | "Show it to the world." | Pop-out card; specular sweep |
| 5 | 0:08–0:10 | Studio. The campaign card alone; **nest ring** of 6–9 backer avatars flies in and settles | "People gather around it." | Nest ring |
| 6–7 | 0:10–0:14 | Montage: discovery grid, campaign page, backers list, macro on the progress bar. Cut every 2 beats; two background swaps behind a still headline | "Every pledge brings it closer." | T1 cuts, one T4 whip, T7 ×2 |
| 8–9 | 0:14–0:18 | **Money moment.** T5 dive into the pledge screen: amount entry, odometer, swipe to confirm — real capture, calm, no background swaps | "Back it in one swipe." | Dive; odometer; tap ring on confirm |
| 10–11 | 0:18–0:22 | Progress macro: count-up to 100%; the spark is the bar's head. At 100% a **radial reveal** in `success` with a check and "Funded" | "And the idea finds its nest." | Count-up; T6 radial reveal |
| 12 | 0:22–0:24 | The success surface contracts back into the spark; the nest ring returns around it | — | Spark carry (reverse) |
| 13 | 0:24–0:26 | The ring and the spark collapse into the IdeyaNest mark; wordmark reveals letter by letter | — | Logo resolve |
| 14–15 | 0:26–0:30 | End card, still: mark, wordmark, "ideyanest.com". A second spark drops from the mark's dot and on bar 14 beat 3 becomes the **lime CTA pill**: "Start yours" | — | CTA pill grows from the spark (centre), then the frame holds still ≥ 2 s (a test enforces it) |

Store badges appear on the end card only once the listing is live. The last 2 seconds are
completely still — the poster frame.

### Cut-downs (recomposed, never trimmed)

| Version | Bars used | Notes |
|---|---|---|
| **15 s** | 1, 2, 5, 8 (one bar of the money moment), 10, 13, 14–15 compressed to 1.5 bars | One headline per bar max |
| **6 s bumper** | 1 (shortened to 1 beat per word, 2 words), 5, 13, 15 | Hook, nest ring, logo, CTA |
| **Store preview** | App footage only | See §8; no people, no studio, follow the store's current rules |

## 4. Colour and type in the film

| Use | Token |
|---|---|
| Night canvas, studio | `surface1` → `surface3` gradient |
| Light scenes, sheet wipe | `whiteSurface`, text `textOnWhite` |
| Campaign and card surfaces, background swaps | `accent.sun` / `accent.mint` / `accent.sky` `surface`, text from the same accent's `text`, glow from its `glow` |
| Funded moment | `success` + check + "Funded" |
| CTA (once) | `lime500` surface, `textOnLime`, `limeGlow` under it |
| Spark | `textPrimary` core and glow |
| Shadows | `shadow.panel`, `shadow.float` |
| Radii | `radius.*`, scaled by the same factor as the device |

Type is Inter (the brand face), loaded with the `latin-ext` and `cyrillic` subsets so ə,
ğ, ş, İ and Russian render in Inter. Headlines Inter 800, tracking −0.02em, line height
0.98, 96–124 px on the 1080-wide master, two lines and five words per line at most.
Every text/surface pair must be one the contrast table in the tokens accepts.

## 5. The device

- Our own device frame (`apps/promo/src/device/`): a rounded body with a slim bezel and a
  generic camera pill, drawn from tokens. No real phone model, no manufacturer marks.
- The screen shows captures recorded at the device's native resolution, so macros at 2×
  stay sharp.
- Status bar: clean — 9:41, full signal, full battery, no notifications (see
  `production.md` §3 for Android demo mode). If demo mode is not available on the
  capture phone, crop the status bar and render a clean one from the frame component.
- The device is always tilted, always drifting, and usually cropped by the frame edge.
  A centred, straight, still device appears once: the frame before the logo resolve.

## 6. Motion and transitions — summary

The full recipes are in `references/motion-and-transitions.md`. In one screen:

- **Grid:** every start and impact lands on a beat or half-beat.
- **Curves:** `ease.enter` (expo-out) for arrivals, `ease.exit` for departures at 60–70%
  of the arrival's length, `springs.*` (critically damped, no overshoot) for objects
  with mass, linear only for camera drift.
- **Overlap** the next move with the previous by 30–50%; stagger siblings by 3 frames.
- **Camera always moves:** drift, orbit, push-in, pull-back, three-plane parallax.
- **Light:** contact and lift shadows that respond to height, one specular sweep per
  device shot, spark glow, 3.5% film grain.
- **Blur:** motion blur on everything fast (whips, the spark's flight, pop-outs);
  depth-of-field blur only on the background plate during push-ins.
- **Transitions:** hard beat cut by default, plus at most one of T2–T7 per bar.
  Cross-dissolves, template presets, glitch, shake, flares and bouncing text are banned.
- **Holds:** a readable state stays still ≥ 0.6 s; headline time = words × 0.3 s + 0.6 s;
  the end card holds ≥ 2 s.

## 7. Sound

- **Music:** an original or properly licensed track at 120 BPM with a clear downbeat on
  bar 1 and a lift into bar 10. Record source and licence in `apps/promo/LICENSES.md`
  before any render is published.
- **Sound design** sits on the same grid: soft tick on every tap ring, a breath of air on
  each spark carry, low whoosh under whips and the sheet wipe, a short riser into the
  radial reveal, a warm chime on "Funded", silence for 2 frames before the CTA lands.
- **Mix:** −14 LUFS integrated, true peak ≤ −1 dBTP, music ducked 4 dB under SFX hits.
- **Sound-off first:** most feed views are muted, so the headlines alone must tell the
  whole story. Test by watching the render muted.

## 8. Formats and deliverables

| Deliverable | Spec |
|---|---|
| Master | 1080×1920, 60 fps, H.264 High, yuv420p, CRF 16, AAC 48 kHz 320 kb/s, `+faststart` |
| 1:1 and 16:9 | Separate Remotion compositions with their own layout (1080×1080, 1920×1080), never crops of the 9:16 |
| Poster | PNG of the final end-card frame, every aspect |
| Captions | Burned-in headlines are the captions; an `.srt` for platforms that read it |
| Languages | az master, en and ru renders from the same compositions with catalogue copy |

**Social safe zone (9:16):** headlines and CTA stay inside the central 1080×1270 area —
about 250 px clear at the top and 400 px at the bottom, 64 px at the sides — where feed UI
does not cover them.

**Store previews** are a different product: app footage only, and the stores' current
rules on length, resolution and content decide. Read Apple's and Google's current
guidelines before making one; do not assume this skill's limits match them.

Renders and raw captures are **not committed**: `apps/promo/out/` and
`apps/promo/public/captures/` are git-ignored, and `apps/promo/captures.json` lists what
must be recorded to reproduce a film.

## 9. Workflow

1. **Brief** — confirm with the owner: goal (install, launch, feature), platforms,
   length set, languages, which features appear, release date. One feature per bar.
2. **Copy** — draft headlines in `apps/promo/src/copy.ts`; owner approves before publishing.
3. **Seed and capture** — demo account with fictional campaigns; record each shot listed
   in `captures.json` on the phone (`ideanest-device-test` for the release APK and deep
   links, `production.md` §3 for recording).
4. **Music** — pick or generate the track at 120 BPM; lay its beat grid first.
5. **Build** — scenes in `apps/promo/src/scenes/`, one per bar group, all timing from
   `motion.ts`. Preview in Remotion Studio with motion blur off.
6. **Polish pass** — the premium checklist in §10, scene by scene.
7. **Render** — master, cut-downs, aspects, posters (`production.md` §5).
8. **QA** — the gates in `production.md` §6: contact sheet read, pause test, flash check,
   loudness, specs, muted watch, contrast of every headline.
9. **Owner review** — share the render; publishing only after a yes.

## 10. Premium checklist — every shot

- [ ] The UI is a real capture, sharp at the scale shown, status bar clean
- [ ] The camera moves; the incoming shot is already moving at the cut
- [ ] The cut, the tap and the arrival all land on beats
- [ ] One hero per shot (a card, a component, a number), everything else secondary
- [ ] Arrivals decelerate, exits accelerate and are shorter, moves overlap
- [ ] Nothing bounces; springs settle
- [ ] Fast moves carry motion blur; nothing strobes
- [ ] Lifted elements have height-aware shadows; one specular sweep on the glass
- [ ] Text is two lines max, Inter, readable for its whole hold, inside the safe zone
- [ ] Colours from tokens; lime only on the CTA; success only on "Funded"
- [ ] Paused on any frame, it would make a good poster
- [ ] Muted, the story still makes sense

## 11. Verification

Never call a film done without running `production.md` §6 and reading its output: the
contact sheet viewed, the flash count, LUFS and true peak, and `ffprobe` specs. Report
what failed as plainly as what passed, and say which checks were not run.
