/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { colors, radius, shadow, spacing } from '@ideanest/design-tokens';
import { toneColor, type Tone } from '../components/text';
import { DANGER_PRESSED_ALPHA } from '../components/ui/pill';
import { focusRingColor, TONES, type Surface } from '../components/ui/surface';
import * as theme from './index';
import { accent, fontSize, lineHeight, motion, tint, tracking } from './index';

/**
 * §14.3's actual requirement (and `docs/ui-kit.md` §2's), as a test: same values, same names, **no
 * second palette**.
 *
 * `packages/ui` runs the equivalent scan over its own source, and the reason
 * this one exists rather than the mobile directory being added to that one is
 * that they are different test runners in different packages — `packages/ui` is
 * on vitest and cannot see a React Native module graph. Two scans, one rule.
 */

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('colour discipline: use a token from @ideanest/design-tokens, never a literal (docs/ui-kit.md §2)', () => {
  /*
   * THE ONE EXCEPTION, NAMED (issue #152): Google's sign-in button, whose colours are Google's
   * brand rules rather than ours. It is listed by path so that a second file can never inherit
   * the exemption, and the test below holds it to carrying nothing but those colours.
   */
  const BRAND_EXCEPTION = join('features', 'auth', 'google-brand.ts');
  const files = walk(SRC).filter(
    (file) => !file.endsWith('theme.test.ts') && relative(SRC, file) !== BRAND_EXCEPTION,
  );

  it('confines the brand exception to Google’s published colours', () => {
    const source = readFileSync(join(SRC, BRAND_EXCEPTION), 'utf8');
    // The main scan's pattern and its issue-number exception (`#152` is not a colour).
    const found = new Set(
      (source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((hex) => !/^#\d{1,4}$/.test(hex)),
    );
    expect([...found].sort()).toEqual(
      ['#131314', '#34A853', '#4285F4', '#8E918F', '#E3E3E3', '#EA4335', '#FBBC05'].sort(),
    );
  });

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [relative(SRC, file), file]))(
    'has no hex literal: %s',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');

      /*
       * `#` before three or more hex digits, and a word boundary after, which is
       * what an issue reference does NOT match: "#119" is three digits and would
       * read as a shorthand colour. `packages/ui` was bitten by exactly that, so
       * the number is required to be followed by a non-hex character before this
       * calls it a colour.
       */
      const found = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      const offenders = found.filter((hex: string) => !/^#\d{1,4}$/.test(hex));

      /*
       * Jest's `expect` takes no message argument -- unlike vitest's, which the
       * rest of this repository uses and which `packages/ui` passes one to. The
       * guidance therefore lives in the suite name, where a failure prints it.
       */
      expect(offenders).toEqual([]);
    },
  );

  it('re-exports the token objects themselves rather than a copy', () => {
    // Identity, not equality. A copy would compare equal on the day it was made
    // and diverge silently on the day a token changed.
    expect(theme.colors).toBe(colors);
    expect(theme.radius).toBe(radius);
    expect(theme.spacing).toBe(spacing);
    expect(theme.shadow).toBe(shadow);
  });

  it('takes the glow and the shadows from the package, which is where #151 put them', () => {
    // They lived only in theme.css, so a native funded bar or floating panel needed a literal.
    expect(theme.colors.limeGlow).toBe(colors.limeGlow);
    expect(theme.shadow.float).toBe(shadow.float);
    expect(theme.shadow.panel).toBe(shadow.panel);
  });
});

/**
 * Lime is a surface or a border, never text — CLAUDE.md §2, and `docs/ui-kit.md` §9.1's 1.3:1.
 * `text.tsx` has no lime tone; this is what stops a screen setting one by hand.
 *
 * <p>What it matches: a style's `color:`, and the props that colour typed text or its caret —
 * `placeholderTextColor`, `selectionColor`, `cursorColor` — set to a lime token directly, through
 * `theme.colors`, or through `tint()`. What it deliberately does not: a `color={…}` prop on a
 * spinner or an icon, and `tabBarActiveTintColor` on an icon-only tab bar, which are not text.
 */
const LIME_TEXT = [
  /\bcolor:\s*(?:tint\(\s*)?(?:theme\.)?colors\.lime\w*/g,
  /\b(?:placeholderTextColor|selectionColor|cursorColor)\s*[:=]\s*\{?\s*(?:tint\(\s*)?(?:theme\.)?colors\.lime\w*/g,
];

describe('lime is never text', () => {
  const files = walk(SRC).filter((file) => !/\.test\.tsx?$/.test(file));

  it.each(files.map((file) => [relative(SRC, file), file]))(
    'sets no text colour to lime: %s',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      expect(LIME_TEXT.flatMap((pattern) => source.match(pattern) ?? [])).toEqual([]);
    },
  );

  it('catches the forms it claims to', () => {
    const offenders = [
      'color: colors.lime500',
      'color: theme.colors.lime400',
      'color: tint(colors.lime500, 0.8)',
      'placeholderTextColor={colors.lime500}',
      'selectionColor: colors.lime600',
    ];
    for (const line of offenders) {
      expect(LIME_TEXT.some((pattern) => new RegExp(pattern.source).test(line))).toBe(true);
    }
    expect(
      LIME_TEXT.some((pattern) => new RegExp(pattern.source).test('borderColor: colors.lime500')),
    ).toBe(false);
  });
});

describe('tint()', () => {
  it('derives a translucent colour from a token, so no literal enters the source', () => {
    expect(tint(colors.danger, 0.12)).toBe('rgba(255,68,56,0.12)');
    expect(tint(colors.black, 0.64)).toBe('rgba(0,0,0,0.64)');
  });

  it('multiplies an already translucent token rather than replacing its opacity', () => {
    expect(tint(colors.textSecondary, 0.5)).toBe('rgba(255,255,255,0.32)');
  });

  it('refuses a colour it cannot read instead of passing it through', () => {
    expect(() => tint('lime', 0.5)).toThrow();
  });
});

describe('the type scale', () => {
  it('takes the floor of each clamp in docs/ui-kit.md §5.2', () => {
    expect(fontSize.display).toBe(40);
    expect(fontSize.h1).toBe(32);
    expect(fontSize.h2).toBe(24);
    expect(fontSize.h3).toBe(20);
  });

  it('tightens tracking as size grows, which is the rule §5.3 exists for', () => {
    expect(tracking.display).toBeLessThan(tracking.h1);
    expect(tracking.h1).toBeLessThan(tracking.h2);
    expect(tracking.cardTitle).toBeLessThan(tracking.body);
    expect(tracking.tag).toBe(0);
  });

  it('gives the campaign story the looser line height §5.4 asks for', () => {
    expect(lineHeight.story).toBeGreaterThan(lineHeight.body);
  });

  /**
   * The whole scale issue #151 lists, as numbers: size, tracking in em (converted back from the
   * points React Native takes), and line height as a ratio.
   */
  it.each([
    ['display', fontSize.display, 40, tracking.display, -0.04, lineHeight.display, 1.05],
    ['h1', fontSize.h1, 32, tracking.h1, -0.035, lineHeight.h1, 1.05],
    ['h2', fontSize.h2, 24, tracking.h2, -0.03, lineHeight.h2, 1.2],
    ['h3', fontSize.h3, 20, tracking.h3, -0.03, lineHeight.h3, 1.2],
    ['card title', fontSize.lg, 18, tracking.cardTitle, -0.02, lineHeight.cardTitle, 1.3],
    ['body', fontSize.base, 16, tracking.body, -0.01, lineHeight.body, 1.5],
    ['story', fontSize.reading, 17, tracking.reading, -0.01, lineHeight.story, 1.75],
  ] as const)(
    'sets %s at its size, tracking and leading',
    (_role, size, points, track, em, leading, ratio) => {
      expect(size).toBe(points);
      expect(track / size).toBeCloseTo(em, 5);
      expect(Math.abs(leading - size * ratio)).toBeLessThanOrEqual(0.5);
    },
  );

  it('carries the editor sizes and the small steps', () => {
    expect([
      fontSize.reading,
      fontSize.row,
      fontSize.sm,
      fontSize.caption,
      fontSize.xs,
      fontSize.xxs,
    ]).toEqual([17, 15, 14, 13, 12, 11]);
  });

  it('opens eyebrows up rather than tightening them', () => {
    expect(tracking.eyebrow / fontSize.xs).toBeCloseTo(0.06, 5);
  });

  it('names one Inter face per weight the scale uses', () => {
    expect(Object.values(theme.font).map((face) => face.fontWeight)).toEqual(['400', '500', '600']);
  });
});

/* -------------------------------------------------------------------------
 * Contrast — packages/ui/src/contrast.test.ts's pairings, for the tones this app draws
 * ---------------------------------------------------------------------- */

/**
 * `packages/ui` measures the token pairs the web draws. This measures the ones the phone draws,
 * which is not the same list: `SurfaceContext` resolves a tone to a different colour on lime and
 * on white (`ui/surface.tsx`), and those derived colours exist nowhere in the token file for the
 * web's test to see. CLAUDE.md §2: contrast failures are build errors, not warnings.
 *
 * <p>WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text and for anything that is not text.
 */
const BODY = 4.5;
const LARGE_OR_NON_TEXT = 3;

const SURFACES: Record<Surface, readonly (readonly [string, string])[]> = {
  dark: [
    ['surface-1', colors.surface1],
    ['surface-2', colors.surface2],
    ['surface-3', colors.surface3],
    ['surface-4', colors.surface4],
  ],
  lime: [
    ['lime-300', colors.lime300],
    ['lime-400', colors.lime400],
    ['lime-500', colors.lime500],
    ['lime-600', colors.lime600],
    ['lime-700', colors.lime700],
  ],
  white: [
    ['white', colors.whiteSurface],
    ['white-muted', colors.whiteMuted],
  ],
  accent: Object.entries(accent).map(([name, tone]) => [`accent-${name}`, tone.surface] as const),
};

const PAIRS = (Object.keys(SURFACES) as Surface[]).flatMap((surface) =>
  SURFACES[surface].map(([name, background]) => [surface, name, background] as const),
);

describe('contrast of every tone on every surface it can land on', () => {
  it.each(PAIRS)(
    'reads primary, secondary and reading text on %s (%s)',
    (surface, _name, background) => {
      for (const tone of ['primary', 'secondary', 'reading'] as Tone[]) {
        expect(ratio(toneColor(tone, surface), background)).toBeGreaterThanOrEqual(BODY);
      }
    },
  );

  /**
   * Tertiary is below the body threshold on purpose — it is for text that is large or that
   * repeats something stated nearby — and pinned at the large-text floor so it cannot get dimmer.
   */
  it.each(PAIRS)(
    'keeps tertiary text above the large-text floor on %s (%s)',
    (surface, _name, background) => {
      expect(ratio(TONES[surface].tertiary, background)).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
    },
  );

  it.each(PAIRS)('draws a focus ring that shows on %s (%s)', (surface, _name, background) => {
    expect(ratio(focusRingColor(surface), background)).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
  });

  it('reads near-black on every lime in the ramp', () => {
    for (const [, lime] of SURFACES.lime) {
      expect(ratio(colors.textOnLime, lime)).toBeGreaterThanOrEqual(BODY);
    }
  });

  /** THE MISTAKE THE onLime VARIANTS EXIST FOR, measured: white/64 on a lime card. */
  it('refuses translucent white on lime', () => {
    expect(ratio(colors.textSecondary, colors.lime500)).toBeLessThan(LARGE_OR_NON_TEXT);
  });

  /**
   * `danger` pills, icon buttons and the down badge (#229). The pressed fill is `--danger` at
   * `DANGER_PRESSED_ALPHA` over whatever is behind, so it is measured over the darkest surface
   * and over white, the two ends of what a control can sit on.
   */
  it('reads near-black on danger, at rest and pressed', () => {
    expect(ratio(colors.textOnDanger, colors.danger)).toBeGreaterThanOrEqual(BODY);
    for (const behind of [colors.surface1, colors.whiteSurface]) {
      const pressed = flatten(colors.danger, DANGER_PRESSED_ALPHA, behind);
      expect(ratio(colors.textOnDanger, pressed)).toBeGreaterThanOrEqual(BODY);
    }
  });

  /** Why `textOnDanger` exists: white on danger, measured. */
  it('refuses white on danger as a label colour', () => {
    expect(ratio(colors.textPrimary, colors.danger)).toBeLessThan(BODY);
  });

  /** `primary` and `light` on a white surface (#232): the fill has an edge, the label reads. */
  it('gives the inverted primary an edge on white and a legible label', () => {
    for (const [, white] of SURFACES.white) {
      expect(ratio(colors.surface1, white)).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
      expect(ratio(colors.surface3, white)).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
    }
    expect(ratio(colors.textPrimary, colors.surface3)).toBeGreaterThanOrEqual(BODY);
  });

  /** And the rule's own number: lime as text on white. */
  it('refuses lime as a text colour on white', () => {
    expect(ratio(colors.lime500, colors.whiteSurface)).toBeLessThan(LARGE_OR_NON_TEXT);
  });

  /** Mobile accent cards (#275): each one's own text token reads on it as body text. */
  it.each(Object.entries(accent))('reads its text token on the %s accent', (_name, tone) => {
    expect(ratio(tone.text, tone.surface)).toBeGreaterThanOrEqual(BODY);
  });

  /** An accent card stands off the dark canvas it sits on, as a non-text shape must. */
  it.each(Object.entries(accent))('separates the %s accent from the canvas', (_name, tone) => {
    for (const [, surface] of SURFACES.dark) {
      expect(ratio(tone.surface, surface)).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
    }
  });

  /** The `accent` surface row (`ui/surface.tsx`) is one row because the accents share a text token. */
  it('gives every accent the same text token', () => {
    expect(new Set(Object.values(accent).map((tone) => tone.text)).size).toBe(1);
  });

  /** Why each accent names near-black: white on them, measured. */
  it.each(Object.entries(accent))('refuses white text on the %s accent', (_name, tone) => {
    expect(ratio(colors.textPrimary, tone.surface)).toBeLessThan(BODY);
  });
});

/** The contrast ratio of a (possibly translucent) foreground composited over an opaque background. */
function ratio(foreground: string, background: string): number {
  const back = parse(background);
  if (back.alpha !== 1) throw new Error(`${background} is translucent`);
  const top = parse(foreground);
  const front =
    top.alpha === 1
      ? top
      : {
          red: top.red * top.alpha + back.red * (1 - top.alpha),
          green: top.green * top.alpha + back.green * (1 - top.alpha),
          blue: top.blue * top.alpha + back.blue * (1 - top.alpha),
          alpha: 1,
        };
  const [lighter, darker] = [luminance(front), luminance(back)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** `colour` at `alpha` composited over an opaque `background`, as an opaque colour. */
function flatten(colour: string, alpha: number, background: string): string {
  const top = parse(colour);
  const back = parse(background);
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return `rgba(${mix(top.red, back.red)},${mix(top.green, back.green)},${mix(top.blue, back.blue)},1)`;
}

interface Rgba {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** Reads a colour the way `tint()` writes one, which covers every shape the token file uses. */
function parse(colour: string): Rgba {
  const channels = /^rgba\(([^)]+)\)$/.exec(tint(colour, 1))?.[1]?.split(',').map(Number);
  const [red, green, blue, alpha] = channels ?? [];
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
    throw new Error(`Cannot read ${colour}`);
  }
  return { red, green, blue, alpha };
}

/** WCAG 2.x relative luminance. */
function luminance({ red, green, blue }: Rgba): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('springs', () => {
  it.each(Object.entries(theme.spring))('never overshoots: %s is at least critically damped', (_name, preset) => {
    expect(preset.damping).toBeGreaterThanOrEqual(2 * Math.sqrt(preset.stiffness * preset.mass));
  });
});

describe('motion', () => {
  it('runs shorter than the web, per docs/motion-system.md §7', () => {
    // Not "some number under 300". The web values are the comparison, because
    // the rule is a relationship between the platforms and not a constant.
    expect(motion.base).toBeLessThan(300);
    expect(motion.fast).toBeLessThan(150);
    expect(motion.slow).toBeLessThan(500);
  });
});
