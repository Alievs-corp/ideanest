# Motion System

**Status:** authoritative. This document defines how the interface moves.

Colour, surface, and form are specified in [`ui-kit.md`](./ui-kit.md). Read the
two together: that one answers *how it looks*, this one answers *how it moves*.

---

## Contents

1. [Findings](#1-findings)
2. [Libraries](#2-libraries)
3. [Motion tokens](#3-motion-tokens)
4. [Pattern catalogue](#4-pattern-catalogue)
5. [Motion budget per surface](#5-motion-budget-per-surface)
6. [Product-specific motion](#6-product-specific-motion)
7. [Mobile equivalents](#7-mobile-equivalents)
8. [Performance](#8-performance)
9. [Accessibility](#9-accessibility)
10. [Implementation](#10-implementation)

---

## 1. Findings

### 1.1 The governing insight

This system was derived by instrumenting a high-end reference site — reading its
computed stylesheets, keyframes, transition tokens, and bundled libraries
directly rather than describing it by eye.

The most useful number from that exercise: the page carried **45 scroll
animations, and every one of them was the same animation**. A single fade-and-
rise. Only the delay varied: 50, 100, 150, 200, 300, 400 milliseconds. No
fade-from-left, no zoom, no flip.

That is a decision, not an oversight, and it is why the page reads as calm and
expensive rather than animated. Motion presents the content instead of competing
with it.

### 1.2 The numbers

| Measure | Value |
|---|---|
| Distinct scroll animations | **1** |
| Times applied | 45 |
| Stagger step | 50ms |
| Base transition | **300ms** |
| Distinct easing curves | 5, predominantly `ease-in-out` |
| Colour custom properties | **7** |
| Type families | **1** |

Seven colours and one typeface is less variety than most portfolio sites carry.
The restraint is where the quality comes from.

### 1.3 Three principles

| Principle | In practice |
|---|---|
| **One motion, repeated** | A new section does not get a new animation. |
| **Motion expresses hierarchy** | Stagger delay encodes reading order: heading, then description, then action, then cards. |
| **Short and quick** | 300ms base. Nothing interactive exceeds 700ms. A slow animation reads as a slow product. |

---

## 2. Libraries

Reading the bundles revealed a deliberate split rather than one library doing
everything:

| Purpose | Approach |
|---|---|
| The 45 simple entries | A lightweight declarative scroll library |
| Line-by-line text reveal, counters, pinned sequences | A full timeline library |
| Marquee, modal, page transition | Plain CSS keyframes |
| Carousels | A dedicated carousel library |

**Why the split is right.** Driving 45 identical fades through a timeline library
is wasted weight and wasted code. Driving a line-split scroll sequence through a
declarative attribute API is impossible. Each tool is used where it is cheapest.

### IdeyaNest stack

| Need | Library |
|---|---|
| Primary animation | **`motion`** (Framer Motion) — React-native API, `useInView`, `useReducedMotion` built in |
| Complex scroll timelines | **`gsap`** + `@gsap/react`, lazily imported on the pages that need it |
| Text splitting | **`gsap/SplitText`** — wait for font load before splitting |
| Smooth scroll | **`lenis`** — marketing routes only |
| Carousel | **`embla-carousel-react`** |
| Mobile | **`react-native-reanimated`** |

`motion` replaces the declarative scroll library because `useInView` does the
same job inside the component, with no attribute contract to keep in sync.

---

## 3. Motion tokens

```css
:root {
  --transition-fast: 0.15s ease-in-out;  /* colour, opacity */
  --transition-base: 0.3s  ease-in-out;  /* the default for everything */
  --transition-slow: 0.5s  ease-in-out;  /* layout, disclosure */

  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --stagger-step: 50ms;
}
```

### 3.1 The stagger ladder

Measured values: **50 → 100 → 150 → 200 → 300 → 400ms**.

The first four steps rise by 50ms, then the increment doubles. The distinction
matters:

- **Tight groups** (card grid, figure row) — 50ms steps, so they feel like one
  gesture
- **Distinct blocks** (heading → body → action) — 100ms steps, so they feel
  sequential

**Always cap the ladder.** Without a ceiling the fiftieth list item waits two and
a half seconds and the page looks broken.

### 3.2 Duration rules

| Element | Duration | Reason |
|---|---|---|
| Colour, opacity on hover | 150ms | Must feel immediate |
| Transform, standard hover | 300ms | The default |
| Card disclosure, accordion | 400–600ms | Layout change needs time to read |
| Page transition | 300ms transform, 500ms opacity | Mismatched on purpose — see §4.4 |
| Marquee | 30s linear | Background texture, must not attract the eye |

**Hard limit:** nothing interactive above 700ms. Slow animation reads as a
broken interface, not a refined one.

---

## 4. Pattern catalogue

### 4.1 Fade-up — the only scroll animation

```tsx
const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] },
  },
};

<motion.div
  variants={fadeUp}
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, margin: '-10% 0px' }}
/>
```

**`once: true` is essential.** The animation plays a single time. Scrolling back
up does not replay it. Anything else punishes the user for reviewing the page.

### 4.2 Stagger container

```tsx
const container = {
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
};
```

`staggerChildren: 0.05` is the measured 50ms step.

### 4.3 Rotating-label button

The signature micro-interaction. On hover the label rotates away on a horizontal
axis while a duplicate rotates in from below.

```css
.button__wrapper {
  perspective: 1000px;      /* what makes it read as depth, not a squash */
  overflow: hidden;
  position: relative;
  display: inline-flex;
}

.button__text,
.button__duplicate {
  transform-style: preserve-3d;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.button__duplicate {
  position: absolute;
  inset: 0;
  transform: translateY(-100%) rotateX(90deg);
}

.button:hover .button__text      { transform: translateY(52%) rotateX(-90deg); }
.button:hover .button__duplicate { transform: translateY(0)    rotateX(0deg);  }
```

```tsx
<button className={s.button}>
  <span className={s.wrapper}>
    <span className={s.text}>Back this project</span>
    <span className={s.duplicate} aria-hidden="true">Back this project</span>
  </span>
</button>
```

> `aria-hidden="true"` on the duplicate is **mandatory**. Without it every
> screen reader announces the label twice.

### 4.4 Page transition

A full-screen overlay rises from below, the next page loads, the overlay exits
upward.

```css
.overlay {
  position: fixed; inset: 0;
  height: 100dvh;
  z-index: 1000;
  background-color: var(--surface-1);
  pointer-events: none;
  transition: transform 0.3s linear, opacity 0.5s linear;
}

.overlay.idle     { transform: translateY(100dvh); transition: none; }
.overlay.exiting  { transform: translateY(0); pointer-events: auto; }
.overlay.entering { transform: translateY(-100dvh); }
```

**The mismatch is deliberate.** Transform runs 300ms, opacity 500ms. Movement
finishes while the fade continues, and the transition reads as soft rather than
mechanical. Matching them would feel abrupt.

`100dvh` rather than `vh` — mobile browsers change viewport height as the
address bar collapses, and `vh` leaves a visible seam.

### 4.5 Line-by-line text reveal

```tsx
useGSAP(() => {
  const split = new SplitText(ref.current, { type: 'lines', linesClass: 'line' });
  gsap.from(split.lines, {
    yPercent: 100,
    opacity: 0,
    duration: 0.8,
    stagger: 0.08,
    ease: 'power3.out',
    scrollTrigger: { trigger: ref.current, start: 'top 80%', once: true },
  });
  return () => split.revert();   // cleanup is mandatory
}, { scope: ref });
```

Each line needs an `overflow: hidden` parent for the rise to clip correctly.

> **Two failure modes.** `SplitText` rewrites the DOM: without `revert()` a React
> re-render corrupts it. And splitting before webfonts load produces wrong line
> breaks — wait on `document.fonts.ready`.

### 4.6 Marquee

```css
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}

.track {
  display: flex;
  width: max-content;
  gap: 2.625rem;
  animation: marquee 30s linear infinite;
}
.track:hover { animation-play-state: paused; }
```

The content must appear **twice** in the DOM so `-50%` closes the loop
seamlessly. Pausing on hover is small but considerate: it lets someone actually
read what is passing.

### 4.7 Collapsing navigation

Three properties change together on scroll:

```css
.header { position: fixed; inset: 0 0 auto;
          background-color: transparent;
          transition: all 0.3s ease-in-out; }

.nav { height: 2.5rem; padding: 0 2rem;
       border-radius: 1.875rem;
       transition: max-width 0.3s ease-in-out, width 0.3s ease-in-out; }

.header.scrolled .content { padding: 1.25rem 1.625rem; }
.header.scrolled .nav {
  background-color: var(--white-surface);
  border: 1px solid var(--border);
  margin-inline: auto;
  max-width: 445px;
}
```

Width narrows, fill turns white, padding tightens — all on one 300ms curve. The
effect is that navigation is absent at the top of the page and materialises as
you move.

> **The CSS above describes the two end states, not how to animate between
> them.** Transitioning `max-width` and `padding` lays the page out again on
> every frame, on every page, on scroll (issue 166). `TopBar` applies the layout
> change in one step and draws the motion with `transform` and `opacity` only:
> the white fill is its own layer that fades in with `opacity`, and the row's
> children are moved by FLIP — measured before the change, then started from
> where they were with a `transform` that runs out over the same 300ms. The FLIP
> transform exists only while it runs, because a transform left on the row
> would become the containing block of the drawer's `position: fixed` panel.
> Under reduced motion the fade's transition is removed and the FLIP is not
> started.

### 4.8 Counting figure

```tsx
function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20%' });

  useEffect(() => {
    if (!inView || !ref.current) return;
    const controls = animate(0, to, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = Math.round(v).toLocaleString() + suffix;
      },
    });
    return () => controls.stop();
  }, [inView, to, suffix]);

  return <span ref={ref} aria-label={`${to}${suffix}`}>0{suffix}</span>;
}
```

**800ms, not the two seconds a marketing site would use.** These are real
figures; a pledge total that visibly crawls reads as "still loading", which is
precisely the wrong signal on a funding page.

`aria-label` carries the final value so assistive technology never reads a
ticking number.

### 4.9 Accordion

```css
.accordion__button { transform: rotate(0deg); transition: transform 0.4s ease-in; }
.accordion__item.isOpen .accordion__button { transform: rotate(180deg); }
.accordion__content { transition: grid-template-rows 0.6s ease-in-out; }
```

The icon rotates 180° rather than swapping glyphs. Use
`grid-template-rows: 0fr → 1fr` rather than animating height — height animation
causes layout shift, which is measured against you.

### 4.10 Two-pixel icon shift

```css
.cta__icon { transition: transform 0.25s; }
.cta:hover .cta__icon { transform: translate(0.12rem, -0.12rem); }
```

Two pixels. Invisible, but felt. It reinforces the "leaving the page" metaphor
of an outbound arrow, and it costs nothing.

### 4.11 Modal and banner entry

```css
@keyframes slideUp {
  from { opacity: 0; transform: translateY(1.5rem); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
```

Backdrop fades only; content fades and rises. The same timing, different
distance, produces depth without shadow.

#### 4.11.1 Overlay durations

Overlays are the surface of checkout — the reward sheet, the pledge
confirmation, the address drawer — and the budget there is near zero (§5).

| Overlay | Entry | From |
|---|---|---|
| Modal | 200ms | `opacity 0`, `translateY 24px` |
| Drawer | 200ms | `translateX/Y 100%` — the panel's own size |
| Popover, tooltip | 200ms | `opacity 0`, `translateY 4px` |
| Toast | 200ms | `opacity 0`, `translateY 12px` |

A drawer slides with `translate`. Animating `right` or `width` relayouts a
fixed full-height panel on every frame, and the list inside it reflows with it.

**There is no exit animation.** A dialog that lingers after it was dismissed
reads as an unresponsive interface, and holding a backdrop on screen for
another 200ms puts a dead zone over the page the user has just returned to.
Under `prefers-reduced-motion` the entry collapses too: the overlay mounts in
its final state, which is an instant state change rather than a fast one.

### 4.12 Self-dismissing tooltip

```css
@keyframes tooltipFadeUp {
  0%   { opacity: 0; transform: translateY(4px); }
  20%  { opacity: 1; transform: translateY(0); }
  80%  { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-4px); }
}
```

It arrives from below and departs upward rather than retreating the way it came.
The asymmetry reads as "message delivered, message gone".

---

## 5. Motion budget per surface

The reference material is a marketing site: sixteen screens of scroll, designed
to impress. IdeyaNest is a transaction platform. That difference changes several
decisions.

| Reference behaviour | IdeyaNest | Reason |
|---|---|---|
| Smooth scroll everywhere | **Marketing routes only** | It hijacks native scroll; in long lists it lags and it breaks keyboard navigation |
| Page transition on every route | **Marketing to app only** | A 300ms overlay in the pledge flow is pure friction |
| Fade-up on every element | **First screen and section headings** | Fifty animated cards in a feed cost scroll performance |
| Two-second counters | **800ms** | Real figures must not look like they are loading |
| Full-screen hero video | **Small hero, content immediately** | A backer came to find a project, not to watch a film |

### The budget

| Surface | Level | Reason |
|---|---|---|
| Marketing home | **Full** — hero, fade-up, counters, marquee, page transition | Make an impression |
| Discovery, search | **Minimal** — skeleton to content crossfade only | Speed outranks everything |
| Project page | **Moderate** — section headings, counters, sticky call to action | Story and transaction in balance |
| **Pledge and checkout** | **Near zero** — 150ms step change and a loading indicator | Every animation here reads as hesitation |
| Creator dashboard | **Minimal** — chart draw-in | A working tool, not a showcase |
| Campaign editor | **None** — autosave indicator only | Creators spend hours in it |
| Site shell — header, footer | **One** — §4.7's collapse, and nothing else | It is on every route in the table below it, so its budget is paid on all of them at once |
| Authentication, account settings | **None** — 150ms colour on controls | Signing in is work with a wrong-password branch at the end of it. §9.4 of `docs/ui-kit.md` also puts an error message here, and an animated error is one that arrives after it was needed |
| Admin console | **None** — the campaign editor's rule, for the campaign editor's reason | Staff spend hours in it, and a moderator waiting out an entry animation is a queue moving more slowly |

> **The rule:** when the user is **spending money** or **doing work**, motion
> decreases. When the user is **exploring**, motion increases.

> **"Marketing home" is `/`, which #264 built.** The row was aspirational when
> this table was written — the application answered its own root with a 404 — and
> it keeps **Full**: it is the one screen whose entire job is to make an
> impression, and it is the furthest any visitor is from spending money.
>
> **Full, spent with restraint, is what the page actually does.** `FadeUp` on the
> hero and on each section heading, which is this table's own line ("first screen
> and section headings"), and nothing on the campaign cards, which §5.1 forbids
> outright. No counters: the platform publishes no aggregate figure the page could
> honestly count up to, and a counter animating to a number nobody promised is
> decoration wearing a data label. No marquee and no page transition, for the same
> reason — motion added because the budget allows it rather than because it says
> anything.

> **The site shell's one animation is §4.7's, and the mobile drawer is not a
> second one.** WS-03's off-canvas panel is an overlay and takes §4.11.1's
> drawer entry: 200ms, `translateX(100%)`, a fade on the backdrop, no exit. It is
> written as a CSS keyframe rather than through `motion` because the shell is on
> every route in the site and `@ideanest/ui/motion` is 116 kB — §8's own argument,
> applied to the one component that would have paid it everywhere. `transform`
> and `opacity` only, so nothing is given up by writing it by hand.

### 5.1 What "minimal" buys Discovery, exactly

`/discover` is the surface that tests the budget, because it is both the most
exploratory screen in the product and the one with the most elements on it. The
line is drawn per element rather than per page:

| Element | Motion | Why |
|---|---|---|
| Page heading and its standfirst | **One `FadeUp`, once** | §5's own row: fade-up survives on the first screen and on section headings. It is one element, above the fold, animated a single time |
| Project cards | **None** | §8: no animation in long lists. A filtered feed is an unbounded list, and the reader appends more of it by scrolling |
| Skeleton → content | **Crossfade, 200ms** | The one animation this budget was written to keep |
| Skeleton shimmer | **Translating overlay** | `transform` only, removed outright under `prefers-reduced-motion` |
| Progress bar fill | **800ms `ease-out`** | §6. It is the card's one moving part and it is the number the reader came for |
| Filter rail, chips, sort | **150ms colour only** | Ticking a box is work, not exploration. A panel that animates while somebody is using it is a panel that is slower to use |
| Search box and its suggestion list | **None. The popup appears and disappears** | The row above, with less time to spare. This panel is read *between two keystrokes* — a 150ms entry is 150ms in which the list cannot be aimed at, and a list that fades while the reader is still typing is one they arrow into before it has settled. The active row takes the rail's 150ms colour change and nothing else moves |
| Infinite-scroll sentinel | **None** | It is a measuring point, not a thing |

The card entry animation is the one people reach for here and it is the one to
refuse: a stagger ladder across a grid that grows by twenty-four cards on every
scroll is a page that never settles, and it costs exactly where §5 says speed
outranks everything.

---

## 6. Product-specific motion

Patterns the reference material had no need for:

| Animation | Behaviour | Duration |
|---|---|---|
| **Progress bar fill** | Zero to actual percentage; changes colour and gains a glow past 100% | 800ms `ease-out` |
| **Live pledge counter** | Digit roll on a new pledge, with a brief lime flash | 400ms |
| **Countdown** | **No animation.** The number simply changes | 0ms |
| **Goal reached** | Confetti and a progress colour change, once | 1.5s |
| **Pledge confirmed** | Checkmark path draw, plus haptics on mobile | 600ms |
| **Stock decrement** | Brief red pulse as the remaining count changes | 300ms |
| **Skeleton to content** | Crossfade | 200ms |

> **The countdown must not animate.** A per-second animation means the page never
> settles and the battery never rests. Change the number and stop.

---

## 7. Mobile equivalents

| Web | React Native |
|---|---|
| `FadeUp` | `FadeInDown.duration(600).delay(i * 50)` |
| Stagger | `entering={FadeInDown.delay(index * 50)}` on list items |
| Rotating-label button | **Simplify** — `scale: 0.97` on press plus haptics |
| Page transition | Native stack transitions |
| Counter | `useSharedValue` + `withTiming` |
| Marquee | `withRepeat(withTiming(-width, { duration: 30000, easing: Easing.linear }))` |
| Accordion | Reanimated `Layout` |
| Smooth scroll | **None** — native scroll is already smooth; do not touch it |
| Hover | **None** — use `Pressable` pressed state |

```tsx
<Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 50, 300))}>
  <ProjectCard {...item} />
</Animated.View>
```

`Math.min(index * 50, 300)` is the delay ceiling. The fiftieth item must not wait
two and a half seconds.

### Haptics

| Event | Feedback |
|---|---|
| Save a project | `impactAsync(Light)` |
| Select a reward | `selectionAsync()` |
| **Pledge confirmed** | `notificationAsync(Success)` |
| Payment failed | `notificationAsync(Error)` |
| Pull to refresh | `impactAsync(Medium)` |

**Mobile durations run about 20% shorter.** Travel distance is smaller on a
phone, so an identical duration reads as sluggish. Web 600ms becomes mobile
400ms.

---

## 8. Performance

| Rule | Reason |
|---|---|
| **Animate only `transform` and `opacity`** | Both are GPU-composited. `width`, `height`, `top`, `margin` force layout every frame |
| `will-change` **only while animating** | Left on permanently it holds GPU memory for nothing |
| `viewport={{ once: true }}` | A replayed animation is a repeated cost |
| **No animation in long lists** | Fifty animated cards in a feed produce visible jank |
| Hero video: `poster` + `preload="none"` | Video must not block the largest contentful paint |
| Lazy-import the timeline library | Only on pages that use it |
| Load smooth scroll conditionally | Marketing routes only |
| `content-visibility: auto` on long pages | Offscreen sections skip rendering |

### Targets

| Metric | Target |
|---|---|
| Largest contentful paint | < 2.0s |
| Cumulative layout shift | < 0.05 |
| Interaction to next paint | < 200ms |
| Animation frame rate | 60fps |

> **Layout shift note.** A `fade-up` from `translateY(24px)` is safe — transform
> does not affect layout. Animating `height: 0 → auto` is not. Use
> `grid-template-rows: 0fr → 1fr` for disclosure.

---

## 9. Accessibility

### 9.1 Reduced motion is mandatory

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

```tsx
const shouldReduceMotion = useReducedMotion();

<motion.div
  variants={shouldReduceMotion ? undefined : fadeUp}
  initial={shouldReduceMotion ? false : 'hidden'}
  whileInView="visible"
/>
```

Note that the reduced-motion path must still paint the **final** value. A
counter that stays at zero is worse than one that animates.

### 9.2 Requirements

| Requirement | Detail |
|---|---|
| Rotating-label duplicate | `aria-hidden="true"`, or the label is announced twice |
| Counter | `aria-label` with the final value; never `aria-live` |
| Marquee | `aria-hidden` if decorative; otherwise provide a static equivalent |
| Page transition | Overlay is `aria-hidden`; focus moves to the new page heading |
| Accordion | `aria-expanded`, `aria-controls`, and a real `<button>` |
| Focus indicator | Must remain visible on animated elements |
| Autoplaying video | Muted, with reachable controls |

### 9.3 Verification checklist

- [ ] Browse with `prefers-reduced-motion: reduce` — nothing should move
- [ ] Complete every flow by keyboard alone
- [ ] Check counters and buttons with a screen reader
- [ ] Scroll under 4× CPU throttling — look for jank
- [ ] Paint flashing on: animation should not trigger repaint
- [ ] Cumulative layout shift under 0.05
- [ ] Hero video does not block largest contentful paint on a slow connection

---

## 10. Implementation

### 10.1 Dependencies

```jsonc
{
  "motion": "^13.1.0",
  "gsap": "^3.12.5",
  "@gsap/react": "^2.1.1",
  "lenis": "^1.1.18",
  "embla-carousel-react": "^8.5.1"
}
```

### 10.2 Layout

```
packages/design-tokens/
└── src/index.ts             duration, easing, stagger values

packages/ui/src/motion/
├── FadeUp.tsx               the single scroll animation
├── StaggerGroup.tsx         orchestration
├── FlipButton.tsx           rotating-label call to action
└── CountUp.tsx              animated figure

apps/web/src/components/motion/
├── PageTransition.tsx
├── RevealLines.tsx
└── Marquee.tsx
```

### 10.3 Order of work

| Step | Work |
|---|---|
| 1 | Motion tokens in the token package |
| 2 | `FadeUp` and `StaggerGroup` — these cover most of the interface |
| 3 | `FlipButton` for primary calls to action |
| 4 | `CountUp` and the progress bar |
| 5 | Collapsing navigation |
| 6 | Page transition, marketing routes only |
| 7 | Marquee and line reveal |
| 8 | Mobile equivalents |
| 9 | Reduced-motion audit and a performance pass |

---

## Appendix — how this was derived

Nothing here is guesswork. The following were read directly from a live page in
an instrumented browser:

| Finding | Method |
|---|---|
| Animation types and delays | Enumerated every animated element's attributes — 45 elements, one animation type |
| Custom properties | `getComputedStyle` on the document element |
| Transitions and easing curves | Recursive walk of every stylesheet in the CSS object model |
| Keyframes | Filtered for keyframe rules |
| Hover transforms | Hover selectors paired with their transform values |
| Libraries | Fetched fourteen script chunks and searched for library signatures |
| Typography | Every `font-size` rule containing `clamp()` |
| Structure | Element dimensions, background colours, radii, plus screenshots |
