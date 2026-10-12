import { accent, colors, radius, shadow, spacing } from '@ideanest/design-tokens';

export { accent, colors, radius, shadow, spacing };

export const FRAME = { width: 1080, height: 1920 } as const;

export const SAFE = { top: 250, bottom: 400, side: 64 } as const;

export const CAPTURE = { width: 1080, height: 2160 } as const;

const SCREEN_WIDTH = 620;
const scale = SCREEN_WIDTH / CAPTURE.width;
const STATUS_BAR = Math.round(110 * scale);
const BEZEL = 16;

export const DEVICE = {
  scale,
  bezel: BEZEL,
  statusBar: STATUS_BAR,
  screen: { width: SCREEN_WIDTH, height: Math.round(CAPTURE.height * scale) + STATUS_BAR },
  body: {
    width: SCREEN_WIDTH + BEZEL * 2,
    height: Math.round(CAPTURE.height * scale) + STATUS_BAR + BEZEL * 2,
  },
  screenRadius: radius.xl * 2,
  bodyRadius: radius.xl * 2 + BEZEL,
} as const;

export const TYPE = {
  headline: 112,
  headlineLarge: 124,
  support: 44,
  tracking: '-0.02em',
  leading: 0.98,
} as const;
