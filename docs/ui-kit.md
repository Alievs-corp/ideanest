# UI Kit — Dark Surface, Lime Accent

**Status:** authoritative. This document defines colour, surface, form, and
component behaviour for every IdeaNest surface.

Motion is specified separately in [`motion-system.md`](./motion-system.md).
The two are designed to be read together: this one answers *how it looks*, the
other answers *how it moves*.

---

## Contents

1. [System overview](#1-system-overview)
2. [Colour](#2-colour)
3. [Surface and elevation](#3-surface-and-elevation)
4. [Radius](#4-radius)
5. [Typography](#5-typography)
6. [Spacing and layout](#6-spacing-and-layout)
7. [Component catalogue](#7-component-catalogue)
8. [Applying the system to product screens](#8-applying-the-system-to-product-screens)
9. [Accessibility rules](#9-accessibility-rules)
10. [Implementation](#10-implementation)

---

## 1. System overview

### 1.1 Three structural laws

| # | Law | Consequence |
|---|---|---|
| **1** | **Black is the ground; white is an accent** | White panels and pills float *on* black. This inverts the usual dark theme, where white is the text colour and nothing more. |
| **2** | **Lime marks "now", nothing else** | Exactly one card in a row is lime: the active, urgent, or currently-relevant one. Lime is a state, not decoration. |
| **3** | **Everything is a pill or a rounded card** | Buttons, filters, tags, avatar clusters are fully rounded. Cards use 20–28px. There are no square corners. |

### 1.2 Why the density works

A dense dashboard should read as chaos. It does not, for three reasons:

- **Colour carries hierarchy.** Black is ground, dark grey is an ordinary card,
  white is focus, lime is urgent. A user reads priority from colour before
  reading a single word.
- **Form groups by function.** Pills are one category of thing (filters, tags,
  actions); cards are another. Shape encodes kind.
- **Spacing is tight but invariant.** Cards sit close together, and the gap
  between them never changes.

### 1.3 What this means for a funding platform

The visual language originates in a dense operational dashboard. IdeaNest has
two faces, and they suit it differently:

| Surface | Character | Fit |
|---|---|---|
| Dashboard, creator tools, admin | Dense, operational | **Direct fit.** Apply as specified. |
| Discovery, project pages | Image-led, exploratory | **Good fit.** A black ground makes project photography stronger. |
| Campaign story (long-form) | 2,000+ words of reading | **Needs an adjustment.** See below. |

> **A problem worth naming.** Long-form text set in white on pure black is
> tiring to read — light bleeds into the dark ground, an effect that is markedly
> worse for readers with astigmatism. This is not a flaw in the palette; it is a
> property of long-form text on high-contrast dark grounds.
>
> **The fix, without breaking the system:** set the story block on `--surface-2`
> rather than the page ground, use `--text-reading` instead of pure white, and
> open the line height to 1.75. Still the same dark system; simply not maximum
> contrast where maximum contrast hurts. Specified in §8.4.

---

## 2. Colour

### 2.1 Neutral surfaces

| Token | Value | Use |
|---|---|---|
| `--black` | `#000000` | Outer gutters only |
| `--surface-1` | `#0D0D0D` | Page ground |
| `--surface-2` | `#161616` | Standard card, panel |
| `--surface-3` | `#1F1F1F` | Nested block, input |
| `--surface-4` | `#2A2A2A` | Hover, selected |
| `--border` | `rgb(255 255 255 / 0.08)` | Card border — very faint |
| `--border-strong` | `rgb(255 255 255 / 0.16)` | Focus, active border |
| `--divider` | `rgb(255 255 255 / 0.06)` | Rules and separators |

> **Why the page ground is not pure black.** On OLED panels, pure black next to
> lit pixels smears during scroll, because the pixel transition from fully off
> is slower. `#0D0D0D` removes the artefact and is indistinguishable at rest.

### 2.2 Text

| Token | Value | Use | Contrast on `--surface-1` |
|---|---|---|---|
| `--text-primary` | `#FFFFFF` | Headings, names, figures | **20.4:1** AAA |
| `--text-secondary` | `rgb(255 255 255 / 0.64)` | Subtitles, descriptions | **9.2:1** AAA |
| `--text-tertiary` | `rgb(255 255 255 / 0.40)` | Meta, timestamps, placeholder | **4.9:1** AA at 16px+ |
| `--text-disabled` | `rgb(255 255 255 / 0.24)` | Disabled controls | 2.6:1 — non-text only |
| `--text-reading` | `rgb(255 255 255 / 0.92)` | Long-form body copy | 17.5:1 |
| `--text-on-lime` | `#0A0A0A` | Text on a lime surface | **15.8:1** AAA |
| `--text-on-white` | `#0A0A0A` | Text on a white surface | **19.3:1** AAA |

### 2.3 Lime — the brand accent

| Token | Value | Use |
|---|---|---|
| `--lime-300` | `#DCFB7A` | Highlight on a lime ground |
| `--lime-400` | `#D2F95C` | Hover |
| **`--lime-500`** | **`#C6F432`** | **Primary** — active card, urgent action, progress |
| `--lime-600` | `#B0DE1E` | Pressed |
| `--lime-700` | `#94BC15` | Border, icon |
| `--lime-glow` | `rgb(198 244 50 / 0.24)` | Outer glow, focus halo |

**The governing rule:**

> Lime is **always a surface**, never text on a light ground. Lime fill with
> near-black text. Lime text on white measures **1.3:1** and cannot be read.

Lime text is permitted only on a dark ground, where it measures 15.4:1 — for
example a small status label.

### 2.4 Status

| Token | Value | Use |
|---|---|---|
| `--success` | `#34D058` | Goal reached, payment collected, delivered |
| `--warning` | `#FFB020` | Final 48 hours, survey overdue |
| `--danger` | `#FF4438` | Payment failed, project suspended |
| `--info` | `#4A9EFF` | In review, informational |
| `--hot` | `#FF6B35` | Trending project |

**Lime and success are not interchangeable.** Lime says *hurry*; success says
*achieved*. A backer who sees lime and reads "everything is fine" has been
misled by the interface. The token file keeps them distinct and the test suite
asserts they differ.

**Dot indicator** — five dots expressing funding level:

```
○○○○○   0–25%     --text-disabled
●○○○○   25–50%    --warning
●●○○○   50–75%    --lime-500
●●●○○   75–100%   --lime-500
●●●●●   100%+     --success
```

On a lime card the status hues vanish — `--success` over `--lime-500` measures
roughly 1.2:1. Filled dots switch to `--text-on-lime` there.

### 2.5 White as an accent

| Token | Value | Use |
|---|---|---|
| `--white-surface` | `#FFFFFF` | Floating panel, primary pill, modal |
| `--white-muted` | `#F4F4F4` | Nested surface inside a white panel |

**When white:** the element demands attention, sits above the system (modal,
floating panel), or is the primary action.
**When lime:** the element is *current, active, or urgent*.

The two should not appear on the same card. One says "this matters"; the other
says "this is happening now". Together they say neither.

---

## 3. Surface and elevation

**There are no shadows in this system.** Depth is expressed through surface
colour.

```
Layer 0 — page ground        #0D0D0D
   │
   ├─ Layer 1 — card          #161616  + border rgb(255 255 255 / .08)
   │     │
   │     └─ Layer 2 — inner   #1F1F1F  (input, tag container)
   │
   ├─ Layer 3 — active card   #C6F432  (lime — state, not elevation)
   │
   └─ Layer 4 — floating      #FFFFFF  + shadow
```

The **only** shadows belong to white floating panels, because those are the only
things genuinely above the plane:

```css
--shadow-panel: 0 8px 32px -8px rgb(0 0 0 / 0.5);
--shadow-float: 0 24px 64px -12px rgb(0 0 0 / 0.7);
```

Do not put a shadow on a dark card. A dark shadow under a dark surface renders
as nothing while still costing a compositing pass.

---

## 4. Radius

| Token | Value | Use |
|---|---|---|
| `--radius-full` | `9999px` | Pills, filter chips, avatars, circular icon buttons |
| `--radius-xl` | `28px` | Large cards, panels, modals |
| `--radius-lg` | `20px` | Standard card, project card |
| `--radius-md` | `14px` | Nested blocks, inputs |
| `--radius-sm` | `10px` | Tags, small labels, thumbnails |

**Rule:** larger surface, larger radius. A nested element always takes a smaller
radius than its parent — approximately `parent_radius − padding`, so the curves
stay concentric.

---

## 5. Typography

### 5.1 Typeface

The system calls for a geometric grotesque: open counters, low contrast, a
single-storey feel at display sizes.

| Face | Character | Recommendation |
|---|---|---|
| **General Sans** | Geometric, contemporary, precise | **First choice** |
| **Sora** | More technical, strong numerals | Second |
| **Inter** | Neutral, widest language coverage | Safe default |

> **Latin Extended check.** The product ships in a locale requiring
> `ə ğ ı ö ş ü ç İ Ə Ğ`. Both General Sans and Sora cover these, but inspect the
> `ə` glyph specifically — in several faces it was added later and does not sit
> with the rest of the lowercase. Where there is doubt, choose **Inter**, in
> which it is part of the original design.

**Decision:** General Sans for display and headings, Inter for body and
numerals. Two families, no more.

### 5.2 Scale

```css
--text-display:  clamp(2.5rem, 2rem + 2.2vw, 4rem);        /* 40 → 64px */
--text-h1:       clamp(2rem, 1.6rem + 1.8vw, 3rem);        /* 32 → 48px */
--text-h2:       clamp(1.5rem, 1.3rem + 0.9vw, 2rem);      /* 24 → 32px */
--text-h3:       clamp(1.25rem, 1.15rem + 0.5vw, 1.5rem);  /* 20 → 24px */
--text-lg:       1.125rem;   /* 18px — card title */
--text-base:     1rem;       /* 16px — body */
--text-sm:       0.875rem;   /* 14px — subtitle, role */
--text-xs:       0.75rem;    /* 12px — tag, meta, count */
--text-2xs:      0.6875rem;  /* 11px — badge */
```

### 5.3 Weight and letter-spacing

| Role | Weight | Letter-spacing |
|---|---|---|
| Display figure | 600 | `-0.04em` |
| H1 | 600 | `-0.035em` |
| H2 / H3 | 600 | `-0.03em` |
| Card title (18px) | 500 | `-0.02em` |
| Body | 400 | `-0.01em` |
| Tag / badge | 500 | `0` |
| Button | 500 | `-0.01em` |

**Tracking tightens as size grows.** Letterforms appear to drift apart at
display sizes; negative tracking compensates. Omitting this is the single most
common reason large headings look cheap, and it is why this table exists rather
than a single global value.

### 5.4 Line height

| Context | Value |
|---|---|
| Display / H1 | `1.05` |
| H2 / H3 | `1.2` |
| Card title | `1.3` |
| Body (short) | `1.5` |
| **Long-form campaign story** | **`1.75`** |

---

## 6. Spacing and layout

### 6.1 Scale

A 4px base: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96`

### 6.2 Measured values

| Element | Value |
|---|---|
| Card padding | `20px` (small) / `24px` (large) |
| Gap between cards | `16px` |
| Gap between sections | `32px` |
| Pill padding | `10px 18px` |
| Circular icon button | `40px` (small `32px`) |
| Avatar | `40px` in a card, `28px` in a group, `56px` on a profile |
| Navigation rail width | `72px` |
| Top bar height | `64px` |

### 6.3 Dashboard skeleton

```
┌──┬────────────────────────────────────────────────────┐
│  │  [timeline pill]        [headline figures]         │
│  │────────────────────────────────────────────────────│
│r │  TITLE                        [+ New]              │
│a │                                                    │
│i │  Section  (count)   [search] [sort]  [chips...]    │
│l │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│  │  │  card  │ │  card  │ │ ACTIVE │ │  card  │  →   │
│  │  └────────┘ └────────┘ └─ lime ─┘ └────────┘      │
│  │                                                    │
│  │  Section  (count)   [search] [sort]  [chips...]    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐                 │
│  │  │ ACTIVE │ │  card  │ │  card  │             →   │
│  │  └─ lime ─┘ └────────┘ └────────┘                 │
└──┴────────────────────────────────────────────────────┘
```

The organising idea is **horizontally scrolling card rails**, each with its own
count and filters. It presents a great deal of information without a long
vertical scroll.

---

## 7. Component catalogue

### 7.1 Card

Three variants at one size, encoding **state** rather than elevation:

| Variant | Fill | Text | Border | When |
|---|---|---|---|---|
| `default` | `--surface-2` | `--text-primary` | `--border` | Ordinary item |
| `active` | `--lime-500` | `--text-on-lime` | none | Current, priority, urgent |
| `floating` | `--white-surface` | `--text-on-white` | none + `--shadow-float` | Modal, floating panel |

```css
.card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  transition:
    background-color 0.3s ease-in-out,
    transform 0.3s ease-in-out;
}
.card:hover { background: var(--surface-3); }
```

**Anatomy:**

```
┌─────────────────────────────────┐
│ [avatar]                    [↗] │  ← expand affordance, on hover/focus
│                                 │
│ Title                           │  ← 18px / 500
│ Subtitle                        │  ← 14px / secondary
│                                 │
│ Label                     ●●●●● │  ← label + dot indicator
│ [tag] [tag]                     │  ← 12px
└─────────────────────────────────┘
```

### 7.2 Pill button

```css
.pill {
  display: inline-flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 18px;
  border-radius: var(--radius-full);
  font-size: 14px; font-weight: 500; letter-spacing: -0.01em;
  transition: background-color 0.15s ease-in-out, transform 0.15s ease-in-out;
}
.pill--primary { background: var(--white-surface); color: var(--text-on-white); }
.pill--accent  { background: var(--lime-500);     color: var(--text-on-lime); }
.pill--ghost   { background: var(--surface-3);    color: var(--text-primary); }
.pill--outline { background: transparent; border: 1px solid var(--border-strong); }

.pill:hover  { transform: translateY(-1px); }
.pill:active { transform: translateY(0) scale(0.98); }
```

**At most one `accent` pill per screen.** Beyond that, urgency stops meaning
anything.

### 7.3 Filter chip

```css
.chip {
  height: 34px; padding: 0 16px;
  border-radius: var(--radius-full);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 13px; font-weight: 500;
  white-space: nowrap;
}
.chip[data-active] {
  background: var(--white-surface);
  border-color: transparent;
  color: var(--text-on-white);
}
```

The selected state is **white, not lime** — a filter is never urgent.

Its container scrolls horizontally, with a masked right edge so "there is more"
reads without a scrollbar:

```css
.chip-row {
  display: flex; gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(90deg, black 88%, transparent);
}
```

**The removable chip is a different control from the toggle chip.** A filter
panel needs both: a chip that *applies* a value, and a chip in the applied-set
summary that *takes it back off*. They look almost identical — the removable
one is the active white fill with an `X` after the label — and their contracts
are opposite. `Chip` is a toggle and carries `aria-pressed`; `RemovableChip`
deletes and must not, because a delete control announced as "pressed" is a
switch that is currently on.

Its accessible name says what pressing it **does**, not what it is about:
`"Remove Status filter: Live"`, never `"Live"`. A row of chips whose names are
their own labels announces as three buttons called after the things they
describe, which is unusable by ear. The name must still **contain** the visible
text, or speech input cannot reach the control by the word printed on it
(WCAG 2.5.3). The `X` is `aria-hidden`: the name already carries the meaning,
and colour and icon never carry it alone (§9.2).

### 7.4 Circular icon button

```css
.icon-btn {
  width: 40px; height: 40px;
  display: grid; place-items: center;
  border-radius: var(--radius-full);
  background: var(--surface-3);
  transition: background-color 0.15s, transform 0.15s;
}
.icon-btn:hover { background: var(--surface-4); transform: scale(1.06); }
```

Variants: `light` (white), `accent` (lime), `danger`, `ghost`.
An accessible name is mandatory.

**Expand affordance (↗)** — top-right of a card, revealed on hover **and on
keyboard focus**:

```css
.expand-btn {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px;
  background: var(--surface-4);
  opacity: 0;
  transition: opacity 0.2s, transform 0.2s;
}
.card:hover .expand-btn,
.expand-btn:focus-visible { opacity: 1; }
.expand-btn:hover { transform: translate(2px, -2px); }
```

Hover-only would make it unreachable without a pointer.

### 7.5 Tag

```css
.tag {
  height: 26px; padding: 0 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
  color: var(--text-secondary);
  font-size: 12px; font-weight: 500;
}
.tag--on-lime {
  background: rgb(10 10 10 / 0.10);
  color: rgb(10 10 10 / 0.72);
}
```

> Inside a lime card the default tag is invisible — dark on dark. Use the
> black-tint variant.

### 7.6 Avatar and avatar group

```css
.avatar { border-radius: var(--radius-full); object-fit: cover;
          border: 2px solid var(--surface-1); }

.avatar-group { display: flex; }
.avatar-group > * + * { margin-left: -10px; }
.avatar-group:hover > * + * { margin-left: -4px; }
```

Sizes: `28px` in a group, `40px` in a card, `56px` on a profile. With no image,
initials are derived from the name.

### 7.7 Headline figure

```css
.stat__value { font-size: var(--text-display); font-weight: 600;
               letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
.stat__label { font-size: 14px; color: var(--text-secondary); }
.stat__badge { height: 20px; padding: 0 7px; border-radius: var(--radius-full);
               font-size: 11px; font-weight: 600; }
.stat__badge--up   { background: var(--lime-500); color: var(--text-on-lime); }
.stat__badge--down { background: var(--danger);   color: var(--white-surface); }
```

Figures animate on entry, but over 800ms — not the two seconds a marketing site
would use. See [`motion-system.md`](./motion-system.md) §4.8.

`tabular-nums` matters: without it a counting figure jitters as digit widths
change.

### 7.8 Timeline

```css
.timeline {
  position: relative; height: 44px;
  border-radius: var(--radius-full);
  background: var(--lime-500);
  display: flex; align-items: center;
}
.timeline__now { position: absolute; width: 2px; height: 100%;
                 background: var(--text-on-lime); }
.timeline__item { position: absolute; transform: translateX(-50%); }
```

A lime fill is correct here: a live campaign is time-bound, and the strip exists
to say the clock is running.

**Product use:** launch → goal reached → deadline → payout.

### 7.9 Floating panel

```css
.floating-panel {
  background: var(--white-surface);
  color: var(--text-on-white);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-float);
  overflow: hidden;
}
```

Text inside is near-black, so `--text-secondary` does not apply. Use
`--text-on-white` at reduced opacity.

### 7.10 Navigation rail

```css
.rail { width: 72px; display: flex; flex-direction: column;
        align-items: center; gap: 12px; padding: 24px 0; }
.rail__item { width: 44px; height: 44px; border-radius: var(--radius-full);
              display: grid; place-items: center;
              color: var(--text-tertiary);
              transition: all 0.2s ease-in-out; }
.rail__item:hover        { background: var(--surface-3); color: var(--text-primary); }
.rail__item[data-active] { background: var(--surface-4); color: var(--lime-500); }
```

The active item gets a lime **icon**, not a lime fill. Permanent chrome should
not shout as loudly as a campaign about to close.

### 7.11 Progress bar

```css
.progress { height: 6px; border-radius: var(--radius-full);
            background: var(--surface-3); overflow: hidden; }
.progress__fill { height: 100%; border-radius: var(--radius-full);
                  background: var(--lime-500);
                  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1); }
.progress--complete .progress__fill {
  background: var(--success);
  box-shadow: 0 0 12px var(--lime-glow);
}
```

The track fills to 100% and stops, but the value may exceed it. An overfunded
campaign shows its real figure as text while the track stays full.

### 7.12 Section header

```
Section title  (7 projects)      [search] [sort]   [All][Hot][...]
────────────────────────────────────────────────────────────────
```

The count is `--text-tertiary` at 12px — present, never competing with the
title.

### 7.13 Form primitives

Forms are where the platform takes money and where creators spend hours. Both
argue for the same thing: nothing here is decorative.

**The field wrapper owns the wiring.** `Field` generates the ids and hands the
control its `id`, its `aria-describedby` (hint **and** error, in that order),
its `aria-invalid`, and its `required`. A hint the assistive layer never reaches
is decoration, and remembering to wire it by hand is a thing people forget under
deadline. A field whose control is a *set* — radios, a drop zone — takes
`grouped`, and the label names the group through `aria-labelledby` instead of
pointing `htmlFor` at nothing.

**An error is text plus an icon, never a colour.** `--danger` with `CircleAlert`
and a sentence saying what to do. A red border alone says nothing to a screen
reader and nothing to a user with a colour-vision deficiency (§9.2). Lime never
marks an error: it means *urgent*, and an urgent-looking mistake reads as a call
to action.

**The input skin:**

```css
.input {
  height: 44px; padding: 0 14px;
  background: var(--surface-3);          /* §3: nested block, input */
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition:
    background-color 0.15s ease-in-out,
    border-color 0.15s ease-in-out;
}
.input::placeholder  { color: var(--text-tertiary); }   /* never --text-disabled */
.input:hover         { border-color: var(--border-strong); }
.input[aria-invalid] { border-color: var(--danger); }
.input:disabled      { opacity: 0.4; }
```

No component declares its own focus ring. The global `:focus-visible` rule
(§9.3) already draws it; a second one drifts and eventually contradicts the
first.

| State | Fill | Border | Notes |
|---|---|---|---|
| Rest | `--surface-3` | `--border` | |
| Hover | `--surface-3` | `--border-strong` | |
| Focus | `--surface-3` | `--border-strong` + global lime ring | Ring is never removed |
| Invalid | `--surface-3` | `--danger` | Always with the error text and icon |
| Disabled | `--surface-3` at 40% | — | Not a readable state; not tab-reachable |
| Checked / on | `--lime-500` | none | Mark in `--text-on-lime`, `data-on-lime` set |

**Checked is lime, and that is not a contradiction.** §8.1 already reads
`--lime-500` as "active choice" for a selected reward tier. A ticked box is the
same gesture. It is still not `--success`: nothing has been achieved by ticking
a box.

**The native `<select>` is a decision, not a shortcut.** A hand-built listbox
has to re-implement type-ahead, Home/End, PageUp/PageDown, the announcement
contract, and the platform wheel picker on iOS and Android — and it always gets
one of them wrong. `color-scheme: dark` makes the browser render the option list
to match (§9.4). The rich listbox — multi-select, async search — is overlay
work, not a form primitive.

**A switch is not a checkbox.** A checkbox selects something for later; a switch
takes effect now. `role="switch"` is what makes a screen reader say "on" rather
than "checked", and a live setting that announces itself as "checked" is a small
lie. The thumb moves with `transform`, never `left`.

**The drop zone's button is not optional.** Drag-and-drop is unreachable by
keyboard, by switch control, and on every touch device. Dragging is the
shortcut; the button is the control. Drag-over changes the instruction text as
well as the border, because colour alone carries nothing.

**A password field reveals on request, and forgets on unmount.** `PasswordInput`
is the input skin with a toggle in the trailing slot. Masking exists so that
somebody behind you cannot read the field; it is not a security property of the
form, and paying for it with a password nobody can proofread costs a refusal on
registration and an attempt against the rate limit on sign-in. The toggle is a
real `<button type="button">` — a bare button inside a form submits it, and a
reveal that signs you in is a wrong-password branch nobody asked for. It carries
`aria-pressed` **and** renames itself between "Show password" and "Hide
password", because the icon swap alone is shape-and-colour meaning, which §9.2
forbids as the sole carrier. It stays in the tab order: the people most likely
to need to proofread a password are the least likely to be holding a mouse. And
it never persists — the field returns to masked on every mount, so a revealed
password does not survive a navigation onto a screen its owner has walked away
from.

**A length limit is a sentence, not a fraction.** `CharacterCount` reads "48
characters remaining", and past the limit "3 characters too many" — the wording
changes before the colour does, because a counter that only turns red has said
nothing to a colour-blind creator and nothing at all to a screen reader (§9.2).
The visible number is `aria-hidden` and a separate polite live region carries
it, announcing only once the remainder is close and only after the count has
been still for a moment. Announcing every keystroke talks over the typing echo,
which makes the field unusable long before anybody reaches the limit.

**Motion budget: 150ms colour and opacity, plus the switch thumb.** Nothing
else. Forms live on checkout ("near zero") and the campaign editor ("none") —
see [`motion-system.md`](./motion-system.md) §5. An animating field reads as
hesitation exactly where confidence is worth the most.

### 7.14 Overlay primitives

`Modal`, `Drawer`, `Popover`, `Tooltip`, `Toast`, `Combobox`. All controlled — `open` plus
`onOpenChange`, no uncontrolled mode. Whether a payment dialog is open is
application state, and a component that owns it privately makes the one case
that matters, reopening after a failed charge, impossible.

#### The modal is white. Everything else is dark

```css
.modal   { background: var(--white-surface); color: var(--text-on-white);
           box-shadow: var(--shadow-float); border-radius: var(--radius-xl); }
.drawer  { background: var(--surface-2); border: 1px solid var(--border); }
.popover { background: var(--surface-3); border: 1px solid var(--border); }
.tooltip { background: var(--surface-4); border: 1px solid var(--border); }
```

There are no shadows in this system except under a white floating panel (§3),
and a modal is the only overlay genuinely above the plane — it stops the page.
A drawer, a popover and a tooltip are extensions of the page: filters, a fee
breakdown, a label. They stay on the dark stack, one layer up from whatever
they sit over.

Inside a modal `--text-secondary` does not apply. Use `--text-on-white` at
reduced opacity, exactly as in §7.9. Lime keeps its meaning: an urgent action
in a modal is a lime fill with near-black text, never lime text on white
(1.3:1 — §9.1).

#### The focus contract

| Overlay | Focus moves in | Tab is trapped | Page scroll locked | Focus returns |
|---|---|---|---|---|
| `Modal` | yes | yes | yes | yes |
| `Drawer` | yes | yes | yes | yes |
| `Popover` | yes | **no** | no | yes |
| `Tooltip` | no | no | no | n/a |
| `Toast` | **never** | no | no | n/a |

Focus lands on the first tabbable element, or on the panel itself when there is
none, and returns to the control that opened the overlay on close. Without the
return a keyboard user who dismisses a dialog is dropped at the top of the
document and has to navigate back to the button they just pressed.

The popover is deliberately not trapped. It is non-modal — the page behind it
is live, scrollable, and reachable by Tab — so trapping would be a lie about
what the user can still do.

A toast never takes focus. It is announced through a live region instead:
`role="status"` / `aria-live="polite"` for ordinary messages, `role="alert"` /
`aria-live="assertive"` for errors. Stealing focus for a message the user did
not ask for interrupts typing and loses the caret, which on a payment form
means losing a field.

#### Escape, and stacking

Escape closes the **topmost** overlay only. Open overlays register in a stack
and the last entry handles the key; everything below it is untouched. One
keystroke tearing down a popover, the drawer it sits in, and the modal behind
that is data loss with a keyboard shortcut.

Backdrop click closes too, and can be opted out of when the user must make a
choice. A press that *starts* inside the panel and *ends* on the backdrop —
selecting text and releasing outside — is not a dismissal.

Scroll lock restores the body's original `overflow` value verbatim, not `''`.
Blanking it would quietly delete an application's own scroll handling the first
time anybody opened a dialog.

#### Tooltip

Opens on hover **and** on focus. Hover alone is not a shortcut, it is a defect:
a keyboard user never produces a hover, so the content exists for mouse users
and for nobody else. It is wired with `aria-describedby`, never `aria-label` —
`aria-label` replaces the trigger's name, `describedby` is announced after it.

Never put a control inside one. It closes on pointer-leave and on blur, so
nothing inside is reachable, and assistive technology flattens the description
to a string and drops the control entirely. If it needs a button, it is a
`Popover`.

#### Toast

Variants pair a token with an icon, because colour alone never carries meaning
(§9.2): `--info`, `--success`, `--warning`, `--danger`. Success is `--success`,
not lime — lime says "act now", never "done" (§8.1).

**A toast does not auto-dismiss what carries an action.** "Undo" that vanishes
after five seconds is a promise the interface does not keep. The timer is also
disabled under `prefers-reduced-motion`, and pauses on hover and on
focus-within: somebody reading the message, or tabbing towards its action, is
not somebody who is finished with it.

#### Combobox — the rich listbox §7.13 deferred

§7.13 sends "the rich listbox — multi-select, async search" to overlay work, and
this is it. It is **not** a replacement for `Select`: five fixed options are
still a native `<select>`, for every reason given there. `Combobox` is for the
case that argument does not cover — options that arrive from a request, while
the reader is typing.

```css
.combobox__popup { background: var(--surface-3); border: 1px solid var(--border);
                   border-radius: var(--radius-md); }
.combobox__option[data-active] { background: var(--surface-4); color: var(--text-primary); }
```

A popup, so it is dark and takes a border rather than a shadow (§3) — it is an
extension of the page, not a thing above it. The active row is `--surface-4`,
the same "hover, selected" fill every other list uses. **Not lime:** a row the
cursor is resting on is where the reader is, not something urgent, exactly as
the filter chip is white rather than lime (§7.3).

**DOM focus never leaves the input.** The active option is named by
`aria-activedescendant` and nothing else. Moving real focus into the list makes
the control impossible to type in: every keystroke after the first arrow press
goes to an `<li>`, and correcting a typo means finding the way back.

**There is no inline completion** — `aria-autocomplete="list"`, never `"both"`.
The typed text is what a plain Enter submits, so a control that quietly replaces
it makes "search for what I actually typed" unreachable the moment the reader
looks at the list. It is also wrong for a list whose rows are not all
completions of the fragment: a suggestion list mixing a campaign title with a
category name would write a category name into the box and then submit it as
free text.

**Escape closes the list and keeps what was typed.** It is not an undo. A search
box that empties itself on Escape throws away work nobody asked it to.
**Tab leaves without selecting** — Tab means "I am done here", and a control
that commits the highlighted row on the way past changes the page for somebody
who was only trying to reach the next control.

**The active option wraps** at both ends. The list is bounded and short, so a
wrap costs one keypress and a hard stop costs the reader the fact that the list
ended. **Home and End move the caret until an option is active**, and only then
jump to the ends of the list: somebody fixing the first letter of what they
typed must not be thrown into a dropdown to do it.

**A row says its kind as text.** A list whose rows lead to four different places
— a campaign, a category, a subcategory, a tag — is carrying meaning, and §9.2
forbids meaning carried by colour or by an icon alone. The word sits beside the
label and is therefore part of the option's accessible name.

**The count is announced, and so is its absence.** A polite live region carries
"3 suggestions available" and, just as loudly, "No suggestions" — silence from a
control that was just typed into reads as a control that has broken. It uses
`aria-live` **without** `role="status"`: `status` is a page-level role and a
page has one, so a widget claiming it too would mean "the status" no longer
identifies anything. The caller debounces, which is what stops the region
talking over the typing echo — the same reasoning as `CharacterCount` in §7.13.

### 7.15 Data display

Table, pagination, empty state, skeleton, inline alert. These are the surfaces
a creator spends hours on, so they are quiet by construction.

**No zebra striping.** In this system surface colour encodes *state*, not
rhythm (§3, §8.1): `--surface-2` is "ordinary", `--surface-3` is "hover or
nested", lime is "urgent". Alternating row fills would spend the only signal
the system has on decoration, and a row that genuinely is highlighted would
then be indistinguishable from every other odd row. Separate rows with
`--divider`, hover with `--surface-3`, and nothing else.

```css
.table-row        { border-bottom: 1px solid var(--divider); }
.table-row:hover  { background: var(--surface-3); }
```

**Money is a pre-formatted string.** A cell renders `"£12,480.00"`, never a
number. Floating point is forbidden for money (CLAUDE.md §3), so formatting
happens where the `decimal.js` value lives; a table that formats is a table
that rounds. Numeric columns take `align="right"` and `tabular-nums` so digits
line up by place value; text stays left.

**The table scrolls inside a named, focusable region.** `overflow-x: auto`
alone is a pointer-only affordance — the right-hand columns become unreachable
by keyboard. The container carries `tabindex="0"` and an accessible name, and
the name is what stops the extra tab stop from being unexplained.

**The active page is white, not lime.** Same rule as the filter chip (§7.3):
lime means *urgent*. Page 3 of 12 is where you are, not something to hurry
about. Previous and next are **disabled at the boundaries, never hidden** — a
control that vanishes moves the next target under the pointer already aimed at
it. The ellipsis is `aria-hidden`: it is decoration, not a page.

**Skeletons are `aria-hidden` inside an `aria-busy` container.** A grey
rectangle has no accessible name worth announcing; the caller supplies the real
message ("Loading projects") and the placeholders stay out of the accessibility
tree entirely. The shimmer animates a **translating overlay** — `transform`
only, never `background-position`, which repaints every frame — and it is the
one animation Discovery's motion budget sanctions
([`motion-system.md`](./motion-system.md) §5). Under
`prefers-reduced-motion: reduce` the overlay is removed, not merely slowed.

**Status colour always arrives with an icon.** `info` · `success` · `warning` ·
`danger` each pair their hue with a `lucide-react` glyph, because colour alone
must never carry meaning (§9.2). **Success is `--success`, never lime** — a
backer who reads lime as "done" has been told the opposite of the truth. The
alert is `--surface-2` with a left rule in the status colour, the same form
§8.1 gives "payment failed". Only `warning` and `danger` take `role="alert"`;
interrupting a screen reader to say "saved" is a cost with no payoff.

### 7.16 Media

`MediaFrame` and `Media`. Every picture in the product goes through one of them,
because every picture in the product is a layout shift waiting to happen.

**The box is reserved before the bytes arrive.** `MediaFrame` sets
`aspect-ratio` on a block that is already the width of its column, so the height
of the picture is known at first paint and nothing below it moves when the image
decodes. [`motion-system.md`](./motion-system.md) §8 puts cumulative layout
shift under 0.05; a single unreserved cover in a card grid spends that budget on
its own.

```css
.media-frame {
  position: relative;         /* a filled image positions against this */
  width: 100%;
  overflow: hidden;           /* clips the image and the scaled placeholder */
  aspect-ratio: 16 / 9;       /* or the image's own width / height */
  background: var(--surface-3);
}
```

**The ratio is either a crop or the truth.** A surface that cuts the picture
passes a crop token; a surface that shows it whole passes the image's own
`{ width, height }`.

| Ratio | Use |
|---|---|
| `16/9` | Project cover wherever it is cropped — discovery card, share image |
| `3/2` | Editorial and reward imagery |
| `4/3` | Denser cards, where a 16:9 strip reads as a letterbox |
| `1/1` | Avatars, tiles |
| `{ width, height }` | The picture shown whole — a prelaunch cover, a story image |

The set is closed for the same reason the radius scale is. Reserving 16:9 for a
portrait photograph is a layout shift with extra steps: the box is right and the
picture is not in it.

**The empty frame is a real state.** A campaign with no cover renders the
reserved `--surface-3` box and nothing in it — not a broken image, and not a
stock graphic that says nothing. A card with a cover and a card without one are
then the same height, which is the point.

**The placeholder is a paint, not an animation.** A low-quality image
placeholder arrives as an inline `data:image/…` URI of a few hundred bytes and
is painted, blurred, inside the reserved box; the real image paints over it.
Nothing transitions. Discovery's budget is "skeleton to content crossfade only"
([`motion-system.md`](./motion-system.md) §5.1) and a card grid that cross-fades
twenty-four covers is exactly the long-list animation §8 forbids — so there is
no reduced-motion branch here, because there is no motion to reduce. Anything
that is not an inline image is ignored rather than rendered: the value is
interpolated into a CSS `url()`.

**`alt` or `decorative`, never neither and never both.** `Media` takes one or
the other and the type enforces it. A content image gets a sentence about what
it shows; a decorative one gets `alt=""`, which removes it from the
accessibility tree. Omitting the attribute is the third option and it is the
worst: a screen reader then reads the file name.

**The primitive is framework-independent, deliberately.** `next/image` lives in
the application and cannot be imported into `@ideanest/ui`, which Storybook and
Vitest render. So `MediaFrame` owns the reservation, the placeholder, the radius
and the clip, and takes the image as a child — the application supplies whichever
element knows how to fetch AVIF. `Media` is the same frame with a plain `<img>`
already in it, for surfaces with no optimiser behind them. Which surfaces those
are, and why, is in `docs/architecture.md` §13.1.

---

## 8. Applying the system to product screens

### 8.1 State-to-colour map

The most important table in this document:

| State | Surface | Example |
|---|---|---|
| Ordinary project card | `--surface-2` | Discovery grid |
| **Closing within 48 hours** | `--lime-500` | Urgent — demands attention |
| **Goal reached** | `--surface-2` + `--success` progress | Achieved, but not urgent |
| Editorially featured | `--surface-2` + lime border | `1px solid var(--lime-700)` |
| Trending | `--surface-2` + `--hot` icon | |
| **Payment failed** | `--surface-2` + `--danger` left rule | Banner and card |
| Suspended | `--surface-2` at 50% opacity | Inert |
| Selected reward tier | `--lime-500` | Active choice |
| Modal, checkout | `--white-surface` | Focus, above the system |

> **The distinction to hold on to:** lime means *urgent*, not *successful*. If
> the two blur, a user sees lime, concludes "all is well", and misses that the
> message was "hurry".

### 8.2 Discovery

```
┌──┬─────────────────────────────────────────────────┐
│  │  [search pill]            [currency] [profile]  │
│  │─────────────────────────────────────────────────│
│r │  Discover                                       │
│a │  [All][Technology][Games][Design][...]          │
│i │                                                 │
│l │  Closing soon      (24)      [search][sort]     │
│  │  ┌──────┐┌──────┐┌ LIME ┐┌──────┐          →   │
│  │  │image ││image ││image ││image │               │
│  │  │title ││title ││title ││title │               │
│  │  │▓▓▓░░ ││▓▓▓▓░ ││▓▓▓▓▓ ││▓▓░░░ │               │
│  │  └──────┘└──────┘└──────┘└──────┘               │
└──┴─────────────────────────────────────────────────┘
```

Project imagery runs full-bleed at the top of the card, with radius on the upper
corners only. The black ground is the system's largest advantage here: it makes
project photography stronger than a light theme can.

#### In a filtered feed, urgency is a lime badge — not a lime card

§8.1 maps "closing within 48 hours" to a `--lime-500` card, and §1.1 says
exactly one card in a row is lime because lime is a **state**, not decoration.
On a rail of four cards those two agree. In `/discover` they do not: the feed is
filtered and sorted by the reader, and `sort=ending_soon&status=live` is a
screen on which every card qualifies. Forty lime cards is precisely the
decoration §1.1 forbids — a signal that everything carries is a signal that
means nothing, and the reader loses the ability to see *which* campaign is about
to close.

**So the card surface stays `--surface-2` and the urgency is a lime pill on
it**, with `Clock` and the words "2 days left". That is still lime as a
*surface* with `--text-on-lime` on it (§2.3), it still carries `data-on-lime` so
the focus ring flips (§9.3), and it is still scarce inside the one card it
belongs to. Every other rule is unchanged:

| On a discovery card | Token | Why |
|---|---|---|
| Progress, below goal | `--lime-500` fill | In progress |
| Progress, at or above goal | `--success` fill | Achieved, never lime (§2.4) |
| Closing within 48 hours | `--lime-500` **badge** | Urgent — the one lime element on the card |
| Status word | `--success` / `--warning` / neutral + icon | Colour never alone (§9.2) |

The lime **card** remains correct where §8.1 put it — a dashboard rail, a
selected reward tier, one current item among a handful. It is the feed, where
the count of urgent items is the reader's to choose, that takes the badge.

**The completion figure is text as well as a bar.** "126% funded" beside the
track, from the `decimal.js` value rather than the pixel width. A bar that only
changes colour at 100% has said nothing to a reader with a colour-vision
deficiency and nothing at all to a screen reader.

### 8.3 Creator dashboard

The closest fit for the system. Direct mapping:

| Pattern | Product use |
|---|---|
| Lime timeline strip | Campaign timeline: launch → goal → deadline |
| Headline figure row | Backers, funded percentage, days remaining |
| Card rail | Recent pledges, arriving live |
| Second card rail | Outstanding tasks: send survey, publish update |
| Filter chips | Filter by reward tier |
| Lime active card | An urgent task, such as failed payments to chase |
| Floating panel | Financial summary |

### 8.4 Campaign story (the long-form exception)

```css
.story {
  background: var(--surface-2);
  border-radius: var(--radius-xl);
  padding: 40px;
  max-width: 68ch;
}
.story p {
  color: var(--text-reading);
  font-size: 1.0625rem;
  line-height: 1.75;
  margin-bottom: 1.5em;
}
.story h2 { color: var(--text-primary); }
```

Four changes: a lighter ground, softer body text, generous leading, and a
measure limit. The system is unchanged; 2,000 words simply become readable.

### 8.5 Checkout

**The one screen where a white surface dominates.**

Someone about to part with money wants maximum clarity and a familiar context.
A white panel with near-black text serves both legibility and trust here.

```
┌─────────────────────────────────────┐
│  ● ● ○   Step 2 of 3                │  ← on the dark ground
│                                     │
│  ┌───────────────────────────────┐  │
│  │  WHITE PANEL                  │  │
│  │  Reward: Early Bird           │  │
│  │  ─────────────────────────    │  │
│  │  Reward            599.00     │  │
│  │  Shipping           25.00     │  │
│  │  ─────────────────────────    │  │
│  │  Total             624.00     │  │
│  │                               │  │
│  │  [ Confirm pledge ]  ← lime   │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

The confirm button is the only lime element on the screen, so attention lands
exactly where it should.

### 8.6 Site shell

**The chrome every other screen in this section sits inside.** §8.2 to §8.5
describe pages; this describes the frame around them, which until #258 did not
exist — twenty routes shipped with no shared header and no footer.

```
┌─────────────────────────────────────────────────┐
│  ideanest  ( Discover  Categories  About )   ⬤  │  ← header transparent,
├─────────────────────────────────────────────────┤     nav is the pill
│                                                 │
│              page content, --surface-1          │
│                                                 │
├─────────────────────────────────────────────────┤
│  Explore     Creators     Company     Legal     │  ← footer, --surface-1
│  ───────────────────────────────────  --divider │
│  © IdeaNest        Language ▾   Currency ▾      │
└─────────────────────────────────────────────────┘
```

**The header never takes a surface; the nav pill does.** `TopBar` is
`bg-transparent` and stays that way at every scroll position — what changes is
the pill in the middle of it, which narrows to `445px` and picks up
`--white-surface` with `--text-on-white`. That is §2.5's rule applied to
navigation: white is what floats above the system, and a collapsed bar is
floating over content that is scrolling underneath it. A header that took
`--surface-2` instead would read as a second page ground stacked on the first.

**Chrome does not compete with content.** §7.10 already states the rule for the
navigation rail — a lime icon, not a lime fill — and it holds here for the same
reason. The header's only lime element is the primary action a signed-out
visitor is being asked to take, and there is at most one of them. §2.5's last
line forbids the rest: the pill is already white, so a second lime link beside
it says "this matters" and "this is happening now" in the same 40 pixels.

**The footer is the page ground, not a card.** `--surface-1` with a
`--divider` rule above it. A `--surface-2` footer reads as a panel with content
in it and pulls the eye down at the end of every page; the footer is a place to
stop, not a destination.

| Element | Surface | Text |
|---|---|---|
| Header wrapper, any state | transparent | inherited |
| Nav pill, at rest | transparent, transparent border | `--text-primary` |
| Nav pill, collapsed | `--white-surface`, `--radius-full`, `--border` | `--text-on-white` |
| Header primary action | `--lime-500` | `--text-on-lime` |
| Footer | `--surface-1` | `--text-tertiary`, headings `--text-secondary` |
| Footer rule | `--divider` | — |

**The skip link is not optional and it is part of this component.** It is the
first focusable element in the document, it is visually hidden until focused,
and when focused it obeys §9.3 like every other control. A shell without one
makes every page on the platform start with the same twelve links for anybody
navigating by keyboard. Visually hidden means moved off-screen, never
`display: none` — a hidden element is not focusable, so a skip link built that
way cannot be reached by the one input device it exists for.

#### The minimal frame

**Two screens must not have the header above, and they are not the same two.**

| Screen | Why |
|---|---|
| Sign in, register, verify email (§4.1) | A screen with one job, and the header's job is to offer eleven others — including a Register button beside the form somebody is already using. §8.5 makes the same argument about the checkout |
| Not found and error, at the root of the route tree | A cost, not a preference. Those files answer a request that matched no route, so they sit above every route group and their code is loaded by every page in the application. The full header there put 83 KiB onto the checkout and the admin console, which never render it |

What they get instead is a wordmark that goes home, the skip link, the page, and
one line at the bottom. It is still a way out, which is the one thing chrome has
to be — and the failure state inside it carries its own links to the feed, the
categories and search, so no page is a dead end.

| Element | Surface | Text |
|---|---|---|
| Wordmark | transparent | `--text-primary` |
| Footer line | transparent | `--text-tertiary` |

The failure states inside the site shell — a 404 from a category page, an error
on the home page — keep the full header, because those routes already carry it.
Same words, two frames.

**A failure state takes no lime and no `--danger`.** §2.4: lime means urgent and
`--danger` means something failed destructively, and neither is true of a
mistyped URL. A 404 that shouts makes an ordinary mistake read as a broken
platform; the heading carries the meaning, which §9.2 requires of it in any case.

**Motion: the collapse and nothing else.** `docs/motion-system.md` §4.7 owns the
header's transition — `max-width`, `background-color`, `border-color` and
`padding`, on one 300ms curve. Those are not `transform` and `opacity`, and this
is the one place in the system that animates anything else: the pill's width is
the effect, and a `scaleX` would stretch the words inside it. It is bounded to a
single element that changes once per scroll direction, which is why it does not
cost what §8 of `docs/motion-system.md` warns about. The footer does not animate,
and neither does the navigation on hover beyond a colour change. Chrome that
moves is chrome being noticed.

---

## 9. Accessibility rules

### 9.1 Measured contrast

Computed, not estimated. `packages/ui/src/contrast.test.ts` derives every figure
below from the token file with WCAG 2.x relative luminance, compositing a
translucent foreground over the named surface first — so a pair that stops
holding fails the build rather than quietly ageing in this table.

| Pair | Ratio | Verdict |
|---|---|---|
| `#FFFFFF` on `#0D0D0D` | 19.4:1 | AAA |
| `rgb(255 255 255 / .92)` on `#161616` | 15.4:1 | AAA |
| `rgb(255 255 255 / .64)` on `#0D0D0D` | 8.2:1 | AAA |
| **`rgb(255 255 255 / .40)` on `#0D0D0D`** | **3.8:1** | **Large text and non-text only** |
| `#0A0A0A` on `#C6F432` | 15.5:1 | AAA |
| `#C6F432` on `#0D0D0D` | 15.2:1 | AAA |
| **`#C6F432` on `#FFFFFF`** | **1.3:1** | **Prohibited** |
| `#FF4438` on `#0D0D0D` | 5.7:1 | AA |
| `#34D058` on `#0D0D0D` | 9.5:1 | AAA |
| `#34D058` on `#C6F432` | 1.6:1 | **Prohibited** |
| **`rgb(255 255 255 / .92)` on `#C6F432`** | **1.2:1** | **Prohibited** |

> **`--text-tertiary` is not a body-text colour.** This table used to record it
> at 4.9:1 and call it "AA at 16px+", and both halves were wrong: it measures
> 3.8:1, which clears WCAG 1.4.3's large-text threshold and not its normal-text
> one. Large means 18.66px bold or 24px regular. Below that it is for text that
> repeats something already stated on the same card — a timestamp beside a date,
> a count beside a bar — and never for a sentence somebody has to read.
> `--text-secondary` is the minimum for anything else.

### 9.2 Prohibitions

| Do not | Instead |
|---|---|
| Lime text on a light surface | Lime fill, near-black text |
| White text on a lime surface | `--text-on-lime` |
| Convey meaning by colour alone | Colour + icon + label |
| Use `--text-disabled` for readable text | `--text-tertiary` at minimum |
| Shadow a dark card | A `--border` hairline |
| Set long-form white on pure black | `--surface-2` + `--text-reading` |
| Status hues on a lime surface | `--text-on-lime` |

### 9.3 Focus

```css
:focus-visible {
  outline: 2px solid var(--lime-500);
  outline-offset: 2px;
  border-radius: inherit;
}

/* A lime ring on a lime surface is invisible. */
[data-on-lime] :focus-visible,
[data-on-lime]:focus-visible {
  outline-color: var(--text-on-lime);
}
```

### 9.4 Additional requirements

- The dot indicator must never be the sole carrier of information — a numeric
  figure belongs beside it
- Status colours pair with an icon, for colour-vision deficiency
- Icon-only controls carry an accessible name
- Reduced motion is honoured — see [`motion-system.md`](./motion-system.md) §9.2
- `color-scheme: dark` is declared so browser chrome, scrollbars, and form
  controls follow

---

## 10. Implementation

### 10.1 Token file

The complete set lives in `packages/design-tokens/src/theme.css` and is
mirrored, value for value, in `src/index.ts` for React Native and canvas code.

**No component may contain a colour literal.** A test scans source and fails the
build on any hex that is not explicitly allowed. That guard is the reason the
token file can be trusted as the whole palette rather than most of it.

### 10.2 Tailwind

`packages/ui/src/styles.css` binds the custom properties to utility classes with
`@theme inline`, so `bg-surface-2` and `text-lime-500` resolve back to the token
file. The bridge introduces no values of its own.

```tsx
<article
  className="rounded-lg border border-white/8 bg-surface-2 p-5
             transition-colors duration-300 hover:bg-surface-3"
>
  <h3 className="text-lg font-medium tracking-tight text-white">{project.title}</h3>
  <p className="mt-1 text-sm text-white/64">{project.creator.name}</p>
  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3">
    <div
      className="h-full rounded-full bg-lime-500 transition-[width] duration-800"
      style={{ width: `${Math.min(percent, 100)}%` }}
    />
  </div>
</article>
```

### 10.3 Mobile

The same tokens are consumed from `packages/design-tokens/src/index.ts`. In
addition: light status bar content, `#0D0D0D` splash background, and a dark
user-interface style declared in the app configuration.

### 10.4 Build order

| Step | Work | Depends on |
|---|---|---|
| 1 | Token package | — |
| 2 | Typeface selection and Latin Extended inspection | — |
| 3 | Primitives: card, pill, chip, icon button, tag, avatar | 1, 2 |
| 4 | Composites: headline figure, progress bar, section header | 3 |
| 5 | Layout: rail, top bar, card rail | 3 |
| 6 | Floating panel and modal system | 3 |
| 7 | Motion layer | 3–6 |
| 8 | Discovery and dashboard screens | 1–7 |
| 9 | Contrast audit and reduced-motion verification | 8 |

Storybook is not optional. Nineteen components with several variants each will
drift without a place to see them side by side.

### 10.5 Visual regression

Every story is rendered under Vitest and its markup is snapshotted, so a variant
that quietly loses `bg-lime-500` fails the build the same way a colour literal
does. Because every visual property here is carried by a class name, the markup
is the reliable signal; a change confined to `styles.css` or the token file
still needs a human in Storybook. See `packages/ui/README.md`.

---

## Appendix — one sentence

> Black stage, white light, lime signal. Little motion, soft form, hierarchy
> carried by colour.
