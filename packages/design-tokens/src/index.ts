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
  textOnLime: '#0A0A0A',
  textOnWhite: '#0A0A0A',

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
