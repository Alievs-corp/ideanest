import {
  colors,
  duration,
  easing,
  radius,
  shadow,
  spacing,
  staggerDelay,
} from '@ideanest/design-tokens';

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

export { colors, duration, easing, radius, shadow, spacing, staggerDelay };

/**
 * A token colour at a given opacity — the 12% tag tints, the black/64 dialog scrim, `white/24`.
 *
 * <p>The web writes these as `bg-danger/12` and Tailwind derives the rgba from the variable.
 * React Native has no such syntax, and the alternative is somebody typing
 * `'rgba(255,68,56,0.12)'`, which the hex scan cannot see and which stops following `danger` the
 * day `danger` changes. This derives the channels **from the token value**, so the only colour in
 * the result is the one the token file holds.
 *
 * <p>A translucent token keeps its own opacity in the product: `tint(colors.textSecondary, 0.5)`
 * is white at 32%, which is what painting a half-transparent layer of it would give.
 */
export function tint(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex?.[1] !== undefined) {
    const value = Number.parseInt(hex[1], 16);
    return `rgba(${(value >> 16) & 0xff},${(value >> 8) & 0xff},${value & 0xff},${alpha})`;
  }

  const rgba = /^rgba?\(([^)]+)\)$/i.exec(color);
  const parts = rgba?.[1]?.split(',').map((part) => Number.parseFloat(part));
  if (parts !== undefined && parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
    const [red, green, blue, own = 1] = parts;
    return `rgba(${red},${green},${blue},${Math.round(own * alpha * 1000) / 1000})`;
  }

  // A throw rather than the colour unchanged: a scrim that silently renders opaque is a dialog
  // that hides the screen it is asking about.
  throw new Error(`tint() reads #RRGGBB and rgba() tokens; ${color} is neither`);
}

/**
 * Inter, the web's typeface, embedded at build time by the `expo-font` config plugin in
 * `app.config.ts` — never loaded at runtime, so there is no flash of the system font and no
 * cold-start cost.
 *
 * <h2>Why each weight is its own family</h2>
 *
 * React Native asks the platform for "this family at this weight", and the answer is not the same
 * everywhere. Below Android 9 (API 28, and this app's floor is 24) React Native rounds every
 * weight under 700 to NORMAL before asking, so a single `Inter` family with three weights would
 * draw medium and semibold as regular. So each face is registered as a family of its own, under
 * its PostScript name — `Inter-Medium` and so on — which is also the name iOS finds a registered
 * font by. One name per face on both platforms, and the weight rides along so iOS and Android 9+
 * never synthesise a bolder or lighter variant of it.
 *
 * <p>The files are Google Fonts' Inter, which carries Latin Extended and Cyrillic — the web's
 * `next/font` subsets — so ə, ğ, ş, İ, Ə and Russian draw in Inter rather than in a fallback.
 */
export const font = {
  regular: { fontFamily: 'Inter-Regular', fontWeight: '400' },
  medium: { fontFamily: 'Inter-Medium', fontWeight: '500' },
  semibold: { fontFamily: 'Inter-SemiBold', fontWeight: '600' },
} as const;

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
  /**
   * 17px — long-form reading (`--text-reading`: the story, a static page) and the reward title.
   * One point over body is the whole difference between a paragraph and an essay.
   */
  reading: 17,
  /** 16px — body. */
  base: 16,
  /** 15px — a row's title in the editor and in settings lists (`docs/ui-kit.md`). */
  row: 15,
  /** 14px — subtitle, role. */
  sm: 14,
  /** 13px — a field's hint, meta beside a row, an eyebrow. */
  caption: 13,
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
  reading: fontSize.reading * -0.01,
  tag: 0,
  button: fontSize.base * -0.01,
  /** Eyebrows are the one step that opens up: uppercase at 12–13px needs air, +0.06em. */
  eyebrow: fontSize.xs * 0.06,
} as const;

/** Line heights from §5.4, resolved against the sizes above. */
export const lineHeight = {
  display: Math.round(fontSize.display * 1.05),
  h1: Math.round(fontSize.h1 * 1.05),
  h2: Math.round(fontSize.h2 * 1.2),
  h3: Math.round(fontSize.h3 * 1.2),
  cardTitle: Math.round(fontSize.lg * 1.3),
  body: Math.round(fontSize.base * 1.5),
  /** Supporting text at 13–14px, which keeps body's 1.5. */
  small: Math.round(fontSize.sm * 1.5),
  /**
   * Long-form campaign story at the reading size. The one place §5.4 asks for 1.75, and the web's
   * `--text-reading` paragraph (17px) — so the story is not a point smaller on the phone.
   */
  story: Math.round(fontSize.reading * 1.75),
} as const;

/**
 * The widest a reading column gets, in points: about 68 characters of Inter at 17px. A phone is
 * narrower than this and never reaches it; a tablet in landscape is not, and a 120-character
 * line is one the eye loses its place on.
 */
export const readingMeasure = 640;

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
  /**
   * A dialog's entry, and the skeleton-to-content crossfade. 200ms on both platforms and NOT
   * shortened: `packages/ui`'s `OVERLAY_ENTRY_MS` and `docs/motion-system.md` §6 both name it as
   * the floor at which an arrival still reads as one, and 160 would be a flicker.
   */
  overlay: 200,
  /** One pass of the skeleton shimmer — `.skeleton-shimmer` in `packages/ui/src/styles.css`. */
  shimmer: 1400,
  /** How far a pressed pill gives, where the motion budget allows it (`docs/motion-system.md` §7). */
  pressScale: 0.98,
} as const;
