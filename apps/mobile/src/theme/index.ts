import { colors, duration, easing, radius, spacing, staggerDelay } from '@ideanest/design-tokens';

/**
 * The mobile styling layer — §14.3 and `docs/ui-kit.md` §2. **Same values, same names, no second
 * palette.**
 *
 * <h2>Why this file holds no colour of its own</h2>
 *
 * Everything below is re-exported from `@ideanest/design-tokens`, which is the
 * package whose own header says it exists for React Native. A second palette is
 * not a hypothetical: it is what happens the first time somebody needs a slightly
 * darker card on a phone, writes the hex inline, and nobody notices because the
 * web build never renders that screen. `theme.test.ts` fails on a hex literal
 * anywhere under `src/`, which is the same guard `packages/ui` runs and the
 * reason a designer can still read the token file as the whole truth.
 *
 * <h2>Why NativeWind is not here</h2>
 *
 * §14.3 names NativeWind 4, and NativeWind 4 drives Tailwind 3. This repository
 * is on Tailwind 4 everywhere — `apps/web` and `packages/ui` both — and
 * NativeWind's Tailwind 4 release is `5.0.0-preview`. The two available choices
 * were therefore a second, older Tailwind major with its own config dialect
 * living beside the current one, or a preview dependency underneath every screen
 * in a new application. Neither buys anything that `StyleSheet` over these tokens
 * does not: the values are identical either way, and the class names would be a
 * second spelling of them rather than a second source.
 *
 * The moment `nativewind@5` is stable this becomes worth revisiting, and the
 * revisit is cheap because the tokens — not the class names — are what the
 * screens import. `docs/architecture.md` §14.3 carries the same note.
 */

export { colors, duration, easing, radius, spacing, staggerDelay };

/**
 * The type scale, in points.
 *
 * `docs/ui-kit.md` §5.2 expresses the four largest steps as `clamp()`, which has
 * no React Native equivalent and no meaning on a phone anyway: a viewport-width
 * interpolation exists so a heading can grow on a desktop, and there is no
 * desktop here. Each of those steps therefore takes **the small end of its own
 * clamp**, which is the value the web already renders at phone widths — so the
 * two platforms agree at the only width both of them draw.
 */
export const fontSize = {
  /** 40px — `--text-display` at its floor. */
  display: 40,
  /** 32px — `--text-h1` at its floor. */
  h1: 32,
  /** 24px — `--text-h2` at its floor. */
  h2: 24,
  /** 20px — `--text-h3` at its floor. */
  h3: 20,
  /** 18px — card title. */
  lg: 18,
  /** 16px — body. */
  base: 16,
  /** 14px — subtitle, role. */
  sm: 14,
  /** 12px — tag, meta, count. */
  xs: 12,
  /** 11px — badge. */
  xxs: 11,
} as const;

/**
 * Weight and tracking, from `docs/ui-kit.md` §5.3.
 *
 * Tracking is in points rather than ems because React Native's `letterSpacing`
 * is absolute. Each value is the em figure multiplied by its own size, so
 * `-0.04em` at 40px is -1.6 and the relationship the table describes survives
 * the unit change. Computing it here rather than at each call site is what stops
 * the fifth screen rounding it to -2.
 */
export const tracking = {
  display: fontSize.display * -0.04,
  h1: fontSize.h1 * -0.035,
  h2: fontSize.h2 * -0.03,
  h3: fontSize.h3 * -0.03,
  cardTitle: fontSize.lg * -0.02,
  body: fontSize.base * -0.01,
  tag: 0,
  button: fontSize.base * -0.01,
} as const;

/** Line heights from §5.4, resolved against the sizes above. */
export const lineHeight = {
  display: Math.round(fontSize.display * 1.05),
  h1: Math.round(fontSize.h1 * 1.05),
  h2: Math.round(fontSize.h2 * 1.2),
  h3: Math.round(fontSize.h3 * 1.2),
  cardTitle: Math.round(fontSize.lg * 1.3),
  body: Math.round(fontSize.base * 1.5),
  /** Long-form campaign story. The one place §5.4 asks for 1.75. */
  story: Math.round(fontSize.base * 1.75),
} as const;

/** Weights as React Native spells them. */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
} as const;

/**
 * Measured sizes from `docs/ui-kit.md` §6.2 that a phone still owes.
 *
 * The navigation rail and the top bar are not here: a rail is a desktop shape,
 * and the header height on mobile belongs to the native stack.
 */
export const size = {
  cardPaddingSmall: spacing[5],
  cardPaddingLarge: spacing[6],
  cardGap: spacing[4],
  sectionGap: spacing[8],
  avatarInCard: 40,
  avatarInGroup: 28,
  avatarOnProfile: 56,
  /**
   * The minimum touch target. Not from §6.2 — the web has no equivalent, because
   * a pointer is precise and a thumb is not. 44 is the smaller of the two
   * platform minimums (Apple 44pt, Android 48dp), so meeting it meets both.
   */
  touchTarget: 44,
} as const;

/**
 * Motion durations for this platform.
 *
 * `docs/motion-system.md` §7 measures mobile at about 20% under web because the
 * travel distance is smaller and an identical duration reads as sluggish. Those
 * figures already exist as `duration.mobile*`; naming them again here is what
 * keeps a screen from reaching for `duration.base` because it is the one with
 * the obvious name.
 */
export const motion = {
  fast: duration.mobileFast,
  base: duration.mobileBase,
  slow: duration.mobileSlow,
  countUp: duration.countUp,
  progress: duration.progress,
} as const;
