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

- Decide implementation in the spike sub-issue: Reanimated's shared element transitions
  (verify they work on the New Architecture with our Reanimated version, behind its flag)
  or a measured overlay: measure the source (`measure()` in a worklet), render a clone in
  a portal at that frame, spring it to the destination frame (translate + scale only),
  then reveal the real destination and remove the clone.
- Must survive: back navigation (reverse), interrupted gesture, list virtualisation (the
  source cell may be unmounted — fall back to a plain push).

## CardStack

- Stacked: each layer offset `translateX` a few points and scaled down slightly.
- Spread: layers spring to their list positions with `staggerDelay(i, 60)`; glows fade in
  after the layer settles.
- Reverse on collapse. Positions are transforms on fixed-size cards — no animated height.

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
  with a screen reader or switch control on, it renders as a normal confirm button.
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
