import { accent, colors } from '@ideanest/design-tokens';
import { describe, expect, it } from 'vitest';

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba?.[1]) {
    const [r = 0, g = 0, b = 0, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  throw new Error(`Unparsed colour ${value}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function contrast(text: string, surface: string): number {
  const bg = parse(surface);
  const fg = over(parse(text), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const PAIRS: [string, string, string][] = [
  ['headline on the night canvas', colors.textPrimary, colors.surface1],
  ['supporting line on the night canvas', colors.textSecondary, colors.surface1],
  ['headline on the sun swap', accent.sun.text, accent.sun.surface],
  ['backer initial on mint', accent.mint.text, accent.mint.surface],
  ['backer initial on sky', accent.sky.text, accent.sky.surface],
  ['backer initial on white', colors.textOnWhite, colors.whiteSurface],
  ['funded text on success', colors.textOnAccent, colors.success],
  ['call to action on lime', colors.textOnLime, colors.lime500],
];

describe('every text and surface pair the film uses', () => {
  it.each(PAIRS)('%s meets WCAG AA', (_, text, surface) => {
    expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
  });
});
