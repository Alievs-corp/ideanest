/**
 * IdeyaNest design tokens in JS/TS form.
 *
 * The web build consumes the CSS custom properties in `theme.css`. This module
 * exists for React Native (NativeWind cannot read CSS variables) and for
 * canvas/chart code, both of which need literal values.
 *
 * Keep the two in sync: `theme.css` <-> `index.ts`.
 */

export const colors = {
  black: '#000000',

  surface1: '#0D0D0D',
  surface2: '#161616',
  surface3: '#1F1F1F',
  surface4: '#2A2A2A',

  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  divider: 'rgba(255,255,255,0.06)',

  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.64)',
  textTertiary: 'rgba(255,255,255,0.40)',
  textDisabled: 'rgba(255,255,255,0.24)',
  textReading: 'rgba(255,255,255,0.92)',

  /** The foreground scale behind `text-fg`, `text-fg-64` and `border-fg/8` (docs/ui-kit.md §11). */
  fg: '#FFFFFF',
  fg80: 'rgba(255,255,255,0.80)',
  fg72: 'rgba(255,255,255,0.72)',
  fg64: 'rgba(255,255,255,0.64)',
  fg56: 'rgba(255,255,255,0.56)',
  fg48: 'rgba(255,255,255,0.48)',
  fg40: 'rgba(255,255,255,0.40)',
  fg32: 'rgba(255,255,255,0.32)',
  fg24: 'rgba(255,255,255,0.24)',

  /** The primary pill: white on the dark theme, near-black on the light one. */
  inverse: '#FFFFFF',
  inverseMuted: '#F4F4F4',
  onInverse: '#0A0A0A',

  /** Lime as ink — an active marker, the brand mark. Lime itself on dark. */
  limeInk: '#C6F432',
  focusRing: '#C6F432',
  textOnLime: '#0A0A0A',
  textOnWhite: '#0A0A0A',
  textOnAccent: '#0A0A0A',
  /** Near-black on `--danger`: white there measures 3.4:1, under AA for a button label. */
  textOnDanger: '#0A0A0A',

  lime300: '#DCFB7A',
  lime400: '#D2F95C',
  lime500: '#C6F432',
  lime600: '#B0DE1E',
  lime700: '#94BC15',
  /** The halo a funded progress bar gains past 100% (docs/motion-system.md §6). */
  limeGlow: 'rgba(198,244,50,0.24)',

  success: '#34D058',
  warning: '#FFB020',
  danger: '#FF4438',
  info: '#4A9EFF',
  hot: '#FF6B35',

  whiteSurface: '#FFFFFF',
  whiteMuted: '#F4F4F4',
} as const;

/**
 * Accent surfaces (issue #275, `.claude/skills/mobile-design` §4; on the web since #335).
 *
 * Card and illustration surfaces: campaign cards and category tiles on both clients. They carry
 * no meaning — lime keeps "act now", `success` keeps "funded" — and they are never text. Each
 * names the text that sits on it, measured in `apps/mobile/src/theme/theme.test.ts` and
 * `packages/ui/src/contrast.test.ts`; `glow` is the halo under the card.
 *
 * Mirrored in `theme.css` as `--accent-sun`, `--accent-mint`, `--accent-sky`, their glows and
 * `--text-on-accent`. A change here is a change there.
 */
export const accent = {
  sun: { surface: '#FFE03D', text: '#0A0A0A', glow: 'rgba(255,224,61,0.32)' },
  mint: { surface: '#2EF2C4', text: '#0A0A0A', glow: 'rgba(46,242,196,0.32)' },
  sky: { surface: '#26A6F7', text: '#0A0A0A', glow: 'rgba(38,166,247,0.32)' },
} as const;

export type AccentName = keyof typeof accent;

/**
 * The light theme (docs/ui-kit.md §11) — `[data-theme='light']` in `theme.css`, value for value.
 *
 * Only what differs from `colors`. The web alone reads it: the phone app is dark. Every ink is
 * solid rather than black at an opacity, and `packages/ui/src/contrast.test.ts` measures each
 * one against all four light surfaces.
 */
export const lightColors = {
  surface1: '#F4F4F1',
  surface2: '#FFFFFF',
  surface3: '#ECECE7',
  surface4: '#E2E2DC',

  border: 'rgba(10,10,10,0.10)',
  borderStrong: 'rgba(10,10,10,0.20)',
  divider: 'rgba(10,10,10,0.07)',

  fg: '#0A0A0A',
  fg80: '#262624',
  fg72: '#323230',
  fg64: '#454542',
  fg56: '#51514E',
  fg48: '#5C5C58',
  fg40: '#686863',
  fg32: '#8A8A85',
  fg24: '#A9A9A4',

  textPrimary: '#0A0A0A',
  textSecondary: '#454542',
  textTertiary: '#686863',
  textDisabled: '#A9A9A4',
  textReading: '#1A1A18',
  /** White on the light theme's deeper `danger`; near-black there measures under 4.5:1. */
  textOnDanger: '#FFFFFF',

  inverse: '#0A0A0A',
  inverseMuted: '#2A2A2A',
  onInverse: '#FFFFFF',

  limeInk: '#4E6B00',
  focusRing: '#0A0A0A',

  success: '#12712F',
  warning: '#9A5800',
  danger: '#C9281E',
  info: '#1E66C8',
  hot: '#BF3F0C',
} as const;

/** The light theme's shadows: the same shapes, lighter, because the ground is light. */
export const lightShadow = {
  panel: '0 8px 32px -8px rgba(10,10,10,0.14)',
  float: '0 24px 64px -12px rgba(10,10,10,0.22)',
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
} as const;

/** 4px base scale - docs/ui-kit.md §6.1 */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

/**
 * Shadows, as CSS `box-shadow` strings. Floating white panels only - a dark
 * shadow under a dark card is invisible cost (theme.css).
 *
 * Strings rather than offset/blur objects because React Native reads the same
 * `boxShadow` syntax the web does, so one value serves both platforms and there
 * is no second spelling of it to drift.
 */
export const shadow = {
  panel: '0 8px 32px -8px rgba(0,0,0,0.5)',
  float: '0 24px 64px -12px rgba(0,0,0,0.7)',
} as const;

/**
 * Motion durations in milliseconds.
 *
 * Mobile values run ~20% shorter: travel distance is smaller on a phone, so an
 * identical duration reads as sluggish (docs/motion-system.md §8.1).
 */
export const duration = {
  fast: 150,
  base: 300,
  slow: 500,
  mobileFast: 120,
  mobileBase: 240,
  mobileSlow: 400,
  /** Count-up. 800ms, not 2s - real figures must not look like they are loading. */
  countUp: 800,
  /** Progress bar fill. */
  progress: 800,
} as const;

export const easing = {
  standard: [0.4, 0, 0.2, 1],
  out: [0, 0, 0.2, 1],
  in: [0.4, 0, 1, 1],
} as const;

/** Delay step between sequential items, in milliseconds. */
export const STAGGER_STEP = 50;

/**
 * Stagger delay with an upper bound.
 * Without the cap the 50th item waits two and a half seconds.
 */
export function staggerDelay(index: number, step = STAGGER_STEP, max = 300): number {
  return Math.min(index * step, max);
}

export type Colors = typeof colors;
export type Radius = typeof radius;
export type Shadow = typeof shadow;
