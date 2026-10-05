# Motion recipes

How each pattern in SKILL.md §6.3 is built. These are the contracts the kit primitives
implement; screens use the primitives, not these snippets.

All of them: Reanimated shared values on the UI thread, `transform`/`opacity` only,
timings and springs from `src/theme`, and a reduced-motion branch with no movement.

## Springs

Defined once in `src/theme` (`spring`), never inline:

| Preset | Feel | Used by |
|---|---|---|
| `spring.soft` | Settles with no visible overshoot, ~400 ms | Sheets, shared elements, card stack |
| `spring.snappy` | Quick, no overshoot, ~250 ms | Tab capsule, press release, chips |
| `spring.sheet` | Like `soft`, tuned for large travel | Full-height sheets |

Pick physics values that produce no overshoot (critically or over-damped), and test them
on device — the same numbers feel different at 60 and 120 Hz.

## PressableScale

- Press in: `scale → motion.pressScale` (0.97–0.98) with `withTiming(motion.fast)`.
- Release: `spring.snappy` back to 1.
- The `onPress` handler fires on release as usual — the animation never delays it.
- Optional haptic prop, mapped to `docs/motion-system.md` §7's table.
- Reduced motion: pressed state is an opacity/colour layer change only.

## FadeUp / Stagger

- From `opacity 0, translateY spacing[4..6]` to rest, `motion.slow`, ease-out.
- Delay `staggerDelay(index)`; only for `index < 8` and only on first mount. Pagination
  appends and refetches render without entry animation.

## FloatingTabBar

- The active capsule is one absolutely positioned view whose `translateX` springs
  (`spring.snappy`) to the measured slot centre; the glyph crossfades Linear → Bold.
- The centre Create button does not move the capsule; it gives a scale press and opens
  the create route.
- Hides (translateY off-screen + fade) on stack routes that do not show it, never
  overlaps content; publishes its footprint via `useTabBarInset()`.

## Stack transition with depth

- Incoming page: `translateX` from screen width to 0.
- Outgoing page: `translateX` to −30% and a dim overlay to ~0.3 opacity.
- Use the native stack's animation options where they give this; a custom interpolator
  only if native cannot. Edge-swipe back must stay interactive.

## SharedTransition

- **Decided in #279: a measured overlay.** Reanimated's own shared element transitions
  (`ENABLE_SHARED_ELEMENT_TRANSITIONS`, Reanimated 4.5.5, React Native 0.86, New
  Architecture) were tried in a release build on an Android 12 phone: the element slid in
  with the page and never flew, and every push logged `synchronouslyUpdateUIProps
  failed`. The flag stays off.
- `useSharedSource(tag, snapshot)` on the card, `SharedTarget tag` on the page, one
  `SharedTransitionHost` above the navigator. The press measures the source in window
  coordinates and navigates at once; the target mounts hidden, measures itself, and the host
  draws a clone at the target frame, transformed onto the source, then springs it to
  identity with `spring.soft` (translate + scale only). The clone appears and the source
  hides only once the clone's picture is drawn (≤ `CLONE_READY_MS`), so there is no empty
  box. When it lands, the real target is shown and the clone removed.
- "Lands" means within `LANDED_POINTS` (0.5 pt) of its end: the spring's `energyThreshold`
  comes from `landingEnergy(travel)`. Reanimated's default finishes about a second after
  the clone has visibly arrived, and for that second a clone left over the card stayed put
  while the list under it scrolled, with the card's own cover hidden.
- A finger on the screen ends a live flight at once (`onTouchStart` on the host), and a flight
  back whose measurement was crossed by a touch does not start. The clone is drawn above the
  navigator and cannot follow a list that has started to scroll.
- The page pushed for a flight uses the stack's `fade` (`transition: 'shared'` param), so
  the cover is what moves and the target is not measured mid-slide.
- Back (header, hardware, `router.back()`) flies the clone from the page to the card. A
  back during the flight in turns the same clone round from where it is. A loading page
  draws the card's picture as its cover (`useSharedSnapshot`) so the flight has a target.
- Plain navigation instead: Reduce Motion, no target within `ARRIVAL_WINDOW_MS`, a source
  unmounted or recycled for another item (list virtualisation), a failed measurement, a
  removal another listener prevents, and a screen closed natively (an interactive swipe, the
  iOS header back button, Android predictive back), detected by its closing
  `transitionStart` arriving before `beforeRemove`.
- The clone hands over only once the page's own picture is drawn (`waitForDisplay` +
  `useSharedTargetDisplay`, at most `HANDOVER_MS`), and a flight replaced by another gives
  back everything it hid.

## CardStack

- Stacked: each layer scaled down by `LAYER_SCALE` and offset `translateX` so it shows
  `PEEK` beyond the layer in front; past the third it waits invisibly behind it. Stacked, the
  group is one "show all" button, and pressing it moves focus to the first card.
- Spread: layers spring to their list positions with `staggerDelay(i, 60)`; glows fade in
  after the layer settles.
- Reverse on collapse. Positions are transforms on fixed-size cards — no animated height.
  The group takes the column's height at once when it spreads and gives it back only after
  the front card has folded in, so a card never covers what follows.

## Sheet

- Rises with `spring.sheet` from `translateY = sheet height`; backdrop fades to the dim
  token; the page behind may scale to ~0.96 (transform only).
- Drag-to-dismiss follows the finger, then springs; velocity decides open/close.
- Keyboard-aware; bottom controls above `insets.bottom`.

## AnimatedAmount

- Input is a **string** produced by `@ideanest/money` formatting of a `Decimal`.
- Each character is its own cell. A new character enters with opacity 0 → 1, scale
  0.85 → 1, translateY 6 → 0 (the "soft blur-in" — no real blur).
- `roll` mode: changing digits slide vertically (old out up, new in from below), columns
  staggered by 30 ms left → right.
- `count` mode: count-up over `motion.countUp` (800 ms), ease-out; the final value is set
  exactly at the end (never a float rounding artefact). After the count it behaves as `roll`,
  so a live figure counts once on first view and rolls on each later update.
- Width changes are handled by the cells' layout snapping, not by animating width.
- Reduced motion: the new string, at once.

## AmountKeypad

- 4×3 pill keys plus an operator row (`+ − × ÷`). Key press = PressableScale with
  `selectionAsync()`.
- The value is held as a `Decimal`; arithmetic via `@ideanest/money`/`decimal.js`; rounding
  to the currency's minor units, half-even, at commit.
- An operator shows `amount op operand` with the operation in a muted tone and a result
  chip `= value`; tapping the chip commits via `AnimatedAmount` roll.
- Over-limit (above available/goal rules) shows an instant inline message, no shake.

## SwipeToConfirm

- A thumb on a track; `translateX` follows the finger (gesture-handler `Pan`), clamped.
- Past ~85% of the track: commit — `notificationAsync(Success)` is fired by the success
  screen, not here; here a `impactAsync(Medium)`. Below: spring back.
- While dragging, the amount above crossfades to its success-tone layer in proportion to
  progress.
- Accessibility: `accessibilityRole="button"`, `accessibilityActions=[{name:'activate'}]`;
  with a screen reader or switch control on, it renders as a normal confirm button. Android
  reports Switch Access as an accessibility service and is detected; iOS exposes no Switch
  Control signal to React Native, so there the `activate` action (which Switch Control's tap
  performs) is what makes the track operable.
- Disabled while the request is in flight; a retry reuses the idempotency key.

## SuccessReveal

- A circle positioned at the origin point (e.g. the recipient avatar) scales from 0 to
  the diagonal of the screen (`scale` transform on a fixed-size circle), `spring.soft` or
  ~500 ms ease-out, in the `success` token.
- Then the check path draws (stroke dashoffset via `react-native-svg` animated props on
  the UI thread) and the text fades up with `staggerDelay`.
- `notificationAsync(Success)` when the circle completes. Tap anywhere to close.
- Shown only after server confirmation. Reduced motion: final screen at once.

## Performance verification

1. Release build (not dev), Perf Monitor on.
2. Low-end Android device and an iPhone; run the animation 10 times.
3. UI thread stays at refresh rate; JS thread shows no frames dropped *caused by* the
   animation.
4. Note the device and result in the PR description.
