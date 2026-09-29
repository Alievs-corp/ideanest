# @ideanest/ui

Primitive, layout, and motion components for the IdeyaNest design system.

Design decisions live in [`docs/ui-kit.md`](../../docs/ui-kit.md).
Motion decisions live in [`docs/motion-system.md`](../../docs/motion-system.md).

## Three entry points

```ts
import { Card, Pill, TextInput } from '@ideanest/ui';        // costs no motion
import { Card, Pill, ProgressBar } from '@ideanest/ui/server'; // safe in an RSC
import { FadeUp, Modal, Drawer } from '@ideanest/ui/motion'; // pulls in motion
```

Everything that drives `motion` — `FadeUp`, `StaggerGroup`, `CountUp`, `Modal`,
`Drawer`, `Popover`, `Tooltip`, `ToastProvider` — is behind `/motion`, and the
tables below mark them. The rest of the library is on the root.

The reason is weight, and it was measured: `motion` is 116 kB uncompressed,
38 kB gzipped, and while these members were re-exported from the root barrel
every route that imported *anything* from this package paid for it. A bundler
follows a static re-export whether or not the binding is used, so the checkout —
which animates nothing, and whose budget is "near zero" in
[`docs/motion-system.md`](../../docs/motion-system.md) §5 — shipped the whole
animation runtime before it could paint. Splitting the barrel took 120.8 kB off
the first load of four routes.

Two members that look like they belong behind `/motion` are deliberately not.
`FlipButton` is a motion-system component (§4.3) that animates in CSS, and
`Combobox` is an overlay whose popup §5.1 requires not to animate. Neither
imports `motion`, so neither costs anything. **The split is by dependency, not
by theme** — a component added here that imports `motion/react` belongs in
`src/motion.ts`, and one that does not belongs on the root.

### `/server`

The subset a React Server Component may import: components with no hook, no
context and no event handler, so each is a function of its props that renders
identically on a server and in a browser. The root barrel is not that — several
of the members behind it consume `createContext`, and reaching for it from a
Server Component fails `next build` with a message naming a component the page
never used.

Everything in it is re-exported from the same module the barrel exports it from,
so a component never exists in two versions; what differs is only which
consumers may reach it. **`src/server.test.ts` is what keeps the promise true**,
transitively, and it fails in this package rather than in an application — with
the name of the component that broke it. A component that acquires state is
removed from the entry point, never marked `'use client'` in place: the directive
would make it a client boundary for every Server Component that imports it,
silently, and the first symptom would be a page whose First Load JS grew for no
visible reason.

It is the entry to use **even from a client component**, when a component is in
both graphs. `ProjectCard` in `apps/web` is the example: it renders in the
client-side discovery feed and in three server-rendered browse pages, and it
imports from here.

## Getting started

```bash
pnpm install
pnpm storybook          # http://localhost:6006
```

```bash
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest: behaviour, accessibility, colour discipline
pnpm test:update        # accept intended visual changes (rewrites snapshots)
pnpm build-storybook    # static build; CI uses it to prove every story renders
```

## Components

### Primitives

| Component | Variants |
|---|---|
| `Card` + `CardTitle` / `CardSubtitle` / `CardFooter` | default · active · floating |
| `Pill` | primary · accent · ghost · outline · danger |
| `Chip` + `ChipRow` | selected / unselected, optional count |
| `RemovableChip` | an applied filter, removed when pressed. Not a toggle — see docs/ui-kit.md §7.3 |
| `IconButton` | default · light · accent · danger · ghost |
| `ExpandButton` | corner affordance revealed on hover and focus |
| `Tag` | default · onLime · onWhite · success · warning · danger · hot |
| `Avatar` + `AvatarGroup` | xs · sm · md · lg, initials fallback |
| `ProgressBar` | lime below 100%, success at or above |
| `StatBlock` + `StatRow` | md · lg, delta badge |
| `DotIndicator` | five-dot funding scale |
| `FloatingPanel` | white elevated surface |
| `RailHeader` + `CardRail` | horizontally scrolling section |

### Form

| Component | Purpose |
|---|---|
| `Field` | Label, hint, error, required marker — and the ids that wire them to the control |
| `TextInput` | sm · md · lg, leading and trailing adornments |
| `Textarea` | Same skin, optional `autoGrow` |
| `Select` | Native `<select>`, styled — accessible and mobile-correct by default |
| `Checkbox` | Real `<input type="checkbox">`, supports `indeterminate` |
| `Radio` + `RadioGroup` | `role="radiogroup"`, arrow keys from native radios |
| `Switch` | `role="switch"`, thumb moves with `transform` |
| `FileDropZone` | Drag-and-drop plus a keyboard-reachable picker button |
| `CharacterCount` | Remaining length as a sentence, announced only once it is close |

Two rules specific to forms: an error is **text plus an icon**, never a colour,
and checked/on is `--lime-500` with a `--text-on-lime` mark — "active choice"
per `docs/ui-kit.md` §8.1, still not `--success`.

### Overlays

| Component | Import | Purpose |
|---|---|---|
| `Modal` | `/motion` | centre-stage dialog — the one white overlay |
| `Drawer` | `/motion` | edge-anchored dialog, right · left · bottom |
| `Popover` | `/motion` | anchored and non-modal, with placement flipping |
| `Tooltip` | `/motion` | describes its trigger, on hover **and** on focus |
| `ToastProvider` + `useToast` | `/motion` | live-region messages that never take focus |
| `Combobox` | root | text input with a filtered listbox; the popup does not animate |

All controlled (`open` + `onOpenChange`). Focus moves in on open and returns to
the trigger on close; `Escape` closes the topmost overlay only. See
[`docs/ui-kit.md`](../../docs/ui-kit.md) §7.14.

### Data display

| Component | Purpose |
|---|---|
| `Table` + `TableHead` / `TableBody` / `TableRow` / `TableHeaderCell` / `TableCell` | semantic table, controlled sort, no zebra striping |
| `Pagination` | named landmark, white active page, disabled boundaries |
| `EmptyState` | empty · filtered — the recovery differs |
| `Skeleton` + `SkeletonGroup` / `SkeletonText` / `SkeletonCard` | `aria-hidden` placeholders in an `aria-busy` container |
| `InlineAlert` | info · success · warning · danger, each with an icon |

### Layout

| Component | Purpose |
|---|---|
| `Rail` + `RailItem` | left icon navigation |
| `TopBar` + `TopBarLink` | collapsing top navigation |
| `Timeline` | campaign time track with projected markers |

### Motion

| Component | Import | Purpose |
|---|---|---|
| `FadeUp` | `/motion` | the single scroll-entry animation |
| `StaggerGroup` | `/motion` | orchestrates `FadeUp child` descendants |
| `CountUp` | `/motion` | animated figure, 800ms |
| `FlipButton` | root | rotating-label call to action, animated in CSS |

## Three rules

**1. Lime means urgent, not successful.**
`--lime-500` says "act now". A campaign that reached its goal uses `--success`.
Conflating them tells a backer the opposite of the truth.

**2. Context decides the colour.**
Inside a lime card, `text-white/64` and `Tag variant="default"` are invisible —
use the `onLime` variants. The same applies to the white `FloatingPanel`, where
`text-on-white/64` is correct.

**3. No literal colours.**
Every colour comes from `@ideanest/design-tokens`. `pnpm test` fails the build
if a hex literal appears in source, so the token file is the whole palette and
can be trusted as such.

## How this is tested

- **Storybook** — appearance, variants, and context. `Patterns/Discovery Rail`
  composes every primitive and is the reference for visual regression.
- **Vitest** — behaviour and accessibility: ARIA wiring, keyboard reachability,
  boundary values, and the colour-discipline guard.
- **Snapshots** — the rendered markup of every story, so an unintended visual
  change fails the build.

Storybook runs the accessibility addon with `test: 'error'`. Contrast problems
fail rather than warn, because the lime-on-white pairing measures 1.3:1 and is
easy to miss by eye.

## Visual regression

`src/visual-regression.test.tsx` discovers every `*.stories.tsx` file, composes
each story with Storybook's portable-story API — the same project annotations
you see in Storybook — and snapshots the rendered markup. A component is covered
the moment somebody writes its story; there is no list to keep up to date.

It snapshots markup rather than pixels on purpose. This library is developed on
Windows and built on Linux; font rasterisation and subpixel rounding differ, so
pixel baselines taken on one never match the other. Every visual property here
is carried by a Tailwind class name, and class names are identical on both.

Each story is snapshotted twice: once with `prefers-reduced-motion:
no-preference` and once with `reduce`, because the reduced fallback is
production markup and is mandatory in this system.

### What it catches

- A variant losing or changing a class — `bg-lime-500` becoming something else
- A padding, radius, or type scale changing
- An element appearing, disappearing, or moving in the tree
- ARIA wiring coming undone — `aria-describedby` no longer pointing at the hint
- A component no longer honouring reduced motion

### What it does not catch

- A change confined to `styles.css` or `theme.css` with no markup change —
  retuning `--lime-500`, or redefining what `bg-surface-2` resolves to. Nothing
  in the DOM moves, so nothing fails. Review those in Storybook
- Anything that needs layout: overflow, wrapping, stacking, real focus rings.
  jsdom has no layout engine, so `getBoundingClientRect` is all zeros
- Overlay content. Every overlay story starts closed, so what is captured is the
  trigger, not the modal, drawer, popover, tooltip, or toast. Portalled content
  *is* captured when a story renders it, so an open-by-default story would be
  covered — none exists today. Overlay behaviour is covered instead by
  `src/components/overlay.test.tsx`
- Post-entry animation state. `IntersectionObserver` never reports an
  intersection under jsdom, so `FadeUp` and `CountUp` are pinned to their
  pre-entry markup. They animate `transform` and `opacity` only, which are
  inline styles rather than classes, so nothing class-carried is lost

Pixel diffing remains available as a later, separate addition. It would need a
containerised runner to be stable across the two platforms, which is why it is
not here.

### Accepting an intended change

```bash
pnpm test:update        # or: pnpm test:update from the repo root
```

Then **read the diff**. A snapshot accepted without looking at what changed is a
deleted test with extra steps. Commit the updated `.snap` file alongside the
change that caused it.
