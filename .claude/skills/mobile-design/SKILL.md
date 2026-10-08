---
name: mobile-design
description: Use before building, changing or reviewing any UI in apps/mobile — screens, components, navigation, icons, colour, motion or haptics. Defines IdeyaNest's mobile design language (dark canvas, white sheets, Iconsax icons, five-slot floating tab bar with a centre create button, expressive spring motion) and the performance and accessibility rules every mobile animation must meet. Web (apps/web, packages/ui) is out of scope.
---

# IdeyaNest mobile design language

The mobile app should feel premium: calm dark surfaces, bright white sheets, rounded
"filled" icons, and motion that explains where things come from and go to. This skill
is the single source of truth for **how `apps/mobile` looks and moves**. It applies to
`apps/mobile` only. The web keeps `docs/ui-kit.md` and `docs/motion-system.md` unchanged.

Reference: the owner chose the fintech app in
<https://www.pinterest.com/pin/816066395023427987/> as the target feel. What it does,
screen by screen and with measured timings, is in `references/reference-app.md`. Copy
its **structure and motion**, never its colours or copy — those come from our tokens and
message catalogue.

## 1. Precedence

| Rule source | Status in `apps/mobile` |
|---|---|
| `@ideanest/design-tokens` — every colour, radius, spacing, duration | **Still binding.** No hex literals in mobile source |
| CLAUDE.md §2 Colour (lime = act now, no lime text on light, context decides token) | **Still binding** |
| CLAUDE.md §2 Accessibility, `prefers-reduced-motion`, transform/opacity only | **Still binding** |
| CLAUDE.md §2 "One scroll-entry animation, `FadeUp`" | **Replaced** by this skill's motion vocabulary (§6) |
| CLAUDE.md §2 / `docs/motion-system.md` §5 "Motion decreases as money gets closer" and the per-surface budget | **Replaced** by §6.4: money surfaces animate too, under stricter input rules |
| Money rules (decimal.js, strings on the wire, idempotency) | **Still binding** |

When this skill and older mobile code disagree, the skill wins and the code is migrated
under the epic that introduced the skill. Do not copy an old pattern because it exists.

## 2. Visual language

- **Canvas:** `colors.surface1`. Raised blocks on it use `surface2`/`surface3`, never a
  border-only box.
- **White sheets:** the primary content container sits on the dark canvas as a
  `colors.whiteSurface` sheet with `radius.xl` top corners and a grabber. Text on it is
  `textOnWhite`; nested blocks inside it use `whiteMuted`. Lists, transactions, forms and
  keypads live in sheets. Dark text tokens are never used on white.
- **Hero figure:** one large number per screen (balance, amount raised, pledge amount).
  Major units large and `textPrimary`/`textOnWhite`; minor units (`.43`) about half size
  in the tertiary tone, baseline-aligned. Money is formatted by `@ideanest/money`, never
  by string surgery on a float.
- **Pills everywhere:** buttons, segmented controls ("All / My accounts", "Send /
  Request") and chips are `radius.full`. Primary pill = white surface + `textOnWhite` on
  dark; on a white sheet it inverts to `surface1` + `textPrimary`.
- **Accent cards:** campaign/collection cards may take a mobile accent colour
  (`colors.accent*`, see §4) as a full surface with a soft same-hue glow below it
  (`shadow` token + accent at low alpha). Never accent text on white.
- **Avatar stacks and source dots:** overlapping avatars (max 3 + `+N` pill) for backers
  or creators; a small coloured dot on an avatar's corner ties a row to its card/category
  — always paired with text, colour never alone.
- **Edge fade:** scrolling lists inside a sheet fade out under the floating tab bar
  instead of being cut by a hard edge.
- **Density:** generous. One idea per block, `spacing[4]` minimum gutter, `spacing[6]`
  between blocks.

## 3. Navigation and safe areas

### 3.1 Tab bar

- **Floating pill** bar over content: `surface2` (or `black`) capsule, `radius.full`,
  inset from the screen edges by `spacing[4]`, lifted above the bottom safe area.
- **Exactly five slots, never more:** `Home · Search · [ + ] · Pledges · Me`.
  The centre slot is the **Create** button — a larger circular `whiteSurface` button with
  a `textOnWhite` Iconsax `add` glyph, which opens `campaigns/new` (signed-out → sign-in,
  then back to the create flow). It is a button, not a tab: it has its own accessible
  name ("Start a campaign"), no selected state, and a `impactAsync(Medium)` haptic.
- **Overflow rule:** a destination that does not fit the five slots goes into the **Me**
  hub as a row (Saved lives there). Never add a sixth slot, never put a "More" tab.
- **Active tab:** white capsule behind a dark Bold glyph (shape + fill change, not colour
  alone). Inactive: Linear glyph in `textTertiary`. The capsule slides between tabs on a
  spring (§6.2). Icon-only, every tab carries `tabBarAccessibilityLabel`.

### 3.2 Safe areas — the bottom edge is a design surface

- Read insets with `useSafeAreaInsets()`; never hard-code a bottom padding.
- The bar sits at `insets.bottom + spacing[2]` (minimum `spacing[3]` when the inset is
  zero — Android three-button nav, older iPhones).
- Every scrollable tab screen pads its content by the bar's footprint through one shared
  hook (`useTabBarInset()` from the tab bar module) so the last row scrolls fully clear of
  the bar and the home indicator. A screen that computes its own number is a bug.
- Sheets and keypads: their bottom-most control sits above `insets.bottom`; on screens
  without the tab bar (stack routes, checkout) the bar is hidden, not overlapped.
- Test every screen on: iPhone with home indicator, Android gesture nav, Android
  three-button nav, and largest accessibility font size.

## 4. Colour additions

Accent tokens live in `@ideanest/design-tokens` as `accent` (the web draws them too since
#335) and reach the app as `accent` from `src/theme`: `accent.sun`, `accent.mint`, `accent.sky`, each with
`surface`, `text` and `glow`. Contrast is asserted in `src/theme/theme.test.ts`. Rules:

- Accents are **surfaces** for cards and illustrations. They carry no meaning (not
  status, not urgency): lime keeps "act now", `success` keeps "funded/sent".
- Text on an accent uses the token the contrast table names for that accent.
- Glow under an accent card = the accent at the alpha the token defines, never a new
  colour.

## 5. Icons — Iconsax

- Every mobile icon comes from **Iconsax**, through the kit's `Icon` component
  (`apps/mobile/src/components/ui/icon.tsx`): `<Icon icon={Glyphs.TickCircle} />`, with
  `Glyphs` from `src/icons`. Screens never import an icon package or an SVG directly.
- The glyphs are generated data (`src/icons/glyphs.ts`) from the MIT-licensed Iconsax
  source by `apps/mobile/scripts/generate-icons.mjs`. To add one, add its Iconsax name to
  the script's list and run `node scripts/generate-icons.mjs` from `apps/mobile`. Never
  edit `glyphs.ts` by hand.
- **Styles have jobs** (`variant` prop):

  | Style | Use |
  |---|---|
  | `linear` (the `Icon` default) | Inline icons beside text, dense meta rows, inactive tabs |
  | `bulk` | Feature and action icons: circular buttons (`IconButton` uses it), empty states, quick actions |
  | `bold` | Selected state (active tab, toggled save) |
  | `twotone` / `broken` / `outline` | Not generated |

- Bulk's secondary layer is the same token colour at reduced opacity — never a second
  colour.
- Sizes: 24 tab/header, 20 in buttons, 18 inline. Circular icon buttons are 40 (small 32),
  touch target ≥ 44.
- Decorative unless named; an icon-only control takes a required label.

## 6. Motion

### 6.1 Principles

1. **Motion explains space.** Things come from where they were (the card stack grows
   into the cards screen, the recipient's avatar flies to the amount). If an animation
   does not say where something came from or went, cut it.
2. **Soft springs, no bounce.** Movement settles; it does not wobble. Overshoot is
   reserved for nothing.
3. **Never in the way.** Input is accepted at the first frame. An animation never delays
   a tap, a keystroke or a navigation; gestures interrupt animations, not the reverse.
4. **UI thread only.** Every animation runs on Reanimated shared values/worklets. JS-thread
   `Animated`, `setState`-driven frames and `LayoutAnimation` are not used.
5. **Transform and opacity only.** Colour changes are a crossfade between two layers.
   No animated `width/height/top/margin`, no animated blur (simulate "blur in" with
   opacity + scale + small translate).

### 6.2 Tokens

Use `motion.*` from `src/theme` for timings and the spring presets defined there by the
motion-foundation sub-issue (`spring.soft`, `spring.snappy`, `spring.sheet`). No inline
`damping`/`stiffness`/`duration` numbers in screens or components.

### 6.3 Vocabulary — the only animations the app uses

Each has one kit primitive; build the primitive, never a one-off. Recipes and timings:
`references/motion-recipes.md`.

| Pattern | Primitive | Where |
|---|---|---|
| Press feedback (scale 0.97 + haptic where meaningful) | `PressableScale` | Every tappable surface |
| Entry rise (opacity + 16–24pt translate), staggered | `FadeUp` / `Stagger` | First screenful of a screen only |
| Tab capsule slide + glyph swap | `FloatingTabBar` | Tab bar |
| Horizontal push with depth (incoming slides, outgoing shifts 30% + dims) | native stack config | Stack routes |
| Shared element (stack → list, avatar → amount, card → detail) | `SharedTransition` | Card stacks, campaign card → campaign page |
| Card stack fan-out (stacked → spread, staggered) | `CardStack` | Card/collection groups |
| White sheet rise with backdrop dim | `Sheet` | All sheets/modals |
| Digit entry and odometer roll | `AnimatedAmount` | Hero figures, amount input, live counters |
| Count-up (800ms) | `AnimatedAmount mode="count"` | Funding figures on first view |
| Inline result chip (`= 286`) appear/commit | `AmountKeypad` | Amount entry |
| Swipe to confirm | `SwipeToConfirm` | Final money confirmation |
| Radial success reveal + check draw | `SuccessReveal` | After a confirmed pledge / created campaign |
| Skeleton → content crossfade | `Skeleton` | Loading |

A new pattern is a change to this skill, made in its own PR, not a screen's local idea.

### 6.4 Money surfaces (checkout, pledge, payout)

Motion is allowed here — this replaces the old "near zero" budget — under these rules:

- The keypad digit appears in the amount **on the same frame** as the press; the roll /
  soft-blur is decoration layered on an already-correct value.
- Amount arithmetic (`143 × 2`) uses `decimal.js` via `@ideanest/money`; the displayed
  string is formatted from the decimal, never from JS number maths.
- `SwipeToConfirm` must also be operable without the gesture: it exposes an
  `accessibilityActions` "activate" and, with a screen reader or switch control on,
  renders as a regular button. The confirm request is idempotent as before; a retried
  swipe reuses the key.
- Errors (declined payment, validation) appear **instantly**, never animated in.
- `SuccessReveal` fires only after the server confirmed; it is never optimistic.

### 6.5 Lists and performance

- Per-item entry animation only for the **first screenful** (index < 8) on first mount;
  items appended by pagination or refetch never animate. No layout animations inside
  `FlatList` cells.
- Target: 60fps (120 on ProMotion) on a low-end Android (Galaxy A-class) with zero dropped
  JS-thread frames during any animation. Verify with the Perf Monitor on a release build
  before claiming an animation is done.
- Max duration 500ms except count-up (800ms) and success reveal (≤ 700ms). Stagger step
  50ms, capped at 300ms (`staggerDelay`).
- Heavy screens mount first, animate second: no animation starts before the screen's
  first paint, and none blocks a navigation transition.

### 6.6 Reduced motion and accessibility

- Every primitive reads `useReducedMotion()`; when on, there is **no movement** — values
  change instantly or with an opacity crossfade ≤ `motion.fast`. Shared elements become a
  plain navigation; the success reveal becomes the final screen, shown at once.
- Haptics follow `docs/motion-system.md` §7's table and stay on with reduced motion.
- Focus is visible on every control, including on accent and lime surfaces.

## 7. Building a mobile UI change — checklist

1. Read this file and, for motion, `references/motion-recipes.md`.
2. Look in `apps/mobile/src/components/ui/` for the primitive. Missing → add it to the kit
   (with tests and a `src/app/dev/kit.tsx` gallery entry), then use it.
3. Colours, radii, spacing, durations, springs from tokens/theme only.
4. Icons through `Icon` (Iconsax), correct style for the job.
5. Tab screens pad with `useTabBarInset()`; nothing under the home indicator.
6. Tests cover behaviour in both full and reduced motion; money arithmetic tested.
7. Typecheck and jest were run and seen passing, and the change is checked on a device
   or simulator; device checks you could not run go to #213 as a comment.
