import { describe, expect, it } from 'vitest';
import { colors } from '@ideanest/design-tokens';

/**
 * Contrast, as arithmetic rather than as a promise — issue 129.
 *
 * <p>The issue number is written without its hash on purpose: `design-tokens.test.ts` scans
 * every file in this package for hex literals, and a three-digit one is a valid colour.
 * `src/server.ts` writes "issue 119" for the same reason.
 *
 * `CLAUDE.md` §2 says "contrast failures are build errors, not warnings", and until this
 * existed nothing computed one. `design-tokens.test.ts` enforces that every colour comes from
 * the token file; this enforces that the pairs the system actually draws are legible once they
 * get there.
 *
 * <h2>Why here and not in a browser</h2>
 *
 * A rendered check needs a layout engine, and the automated pass in `apps/web` runs under
 * jsdom, which computes no styles — axe's `color-contrast` rule is inert there and is disabled
 * with a note saying so. The token file is where the decision is made, so it is where the
 * arithmetic belongs: a pairing that fails here fails on every surface that uses it, before a
 * component exists to be reviewed.
 *
 * <h2>The translucent tokens are composited first</h2>
 *
 * `textSecondary` is `rgba(255,255,255,0.64)`, which has no contrast ratio of its own — what a
 * reader sees is that white composited over whichever surface is behind it. So every ratio
 * below is computed against a named background, and the same token is checked more than once
 * because the answer genuinely differs: `text-white/64` is comfortable on `--surface-1` and
 * illegible on lime, which is the mistake `docs/ui-kit.md` warns about in as many words.
 *
 * <h2>What the thresholds are</h2>
 *
 * WCAG 2.2 AA: <strong>4.5:1</strong> for body text, <strong>3:1</strong> for large text
 * (18.66px bold or 24px regular) and for non-text essentials — a focus ring, a control's
 * border, the filled part of a progress bar. The system's tertiary text is deliberately below
 * 4.5 and is only ever used at a size that qualifies as large or for text that repeats
 * information stated elsewhere; the cases are named individually rather than waved through by
 * a lower blanket threshold.
 */

/** WCAG 2.2 1.4.3, normal text. */
const BODY = 4.5;

/** WCAG 2.2 1.4.3 for large text, and 1.4.11 for anything that is not text. */
const LARGE_OR_NON_TEXT = 3;

describe('contrast', () => {
  /* -----------------------------------------------------------------------
   * The dark surfaces, which is nearly the whole product
   * -------------------------------------------------------------------- */

  const DARK_SURFACES = [
    ['surface-1', colors.surface1],
    ['surface-2', colors.surface2],
    ['surface-3', colors.surface3],
    ['surface-4', colors.surface4],
  ] as const;

  it.each(DARK_SURFACES)('reads primary text on %s', (_name, surface) => {
    expect(ratio(colors.textPrimary, surface)).toBeGreaterThanOrEqual(BODY);
  });

  it.each(DARK_SURFACES)('reads reading text on %s', (_name, surface) => {
    expect(ratio(colors.textReading, surface)).toBeGreaterThanOrEqual(BODY);
  });

  /**
   * The one that is easiest to get wrong, because it is the colour every caption, hint and
   * supporting sentence in the product uses.
   */
  it.each(DARK_SURFACES)('reads secondary text on %s', (_name, surface) => {
    expect(ratio(colors.textSecondary, surface)).toBeGreaterThanOrEqual(BODY);
  });

  /**
   * Tertiary text is below the body threshold on purpose, and it is only used for text that is
   * large or that repeats something stated elsewhere on the same card. This pins it at the
   * non-text floor so it cannot quietly get dimmer, and it documents that the token is not a
   * body colour — a component using it for a sentence somebody has to read is misusing it.
   */
  it.each(DARK_SURFACES)('keeps tertiary text above the large-text floor on %s', (_name, surface) => {
    const measured = ratio(colors.textTertiary, surface);

    expect(measured).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
    expect(measured, 'tertiary is not a body-text colour — see docs/ui-kit.md §3').toBeLessThan(BODY);
  });

  /* -----------------------------------------------------------------------
   * Lime, which is a surface and never a text colour
   * -------------------------------------------------------------------- */

  it('reads near-black text on every lime in the ramp', () => {
    for (const lime of [colors.lime300, colors.lime400, colors.lime500, colors.lime600, colors.lime700]) {
      expect(ratio(colors.textOnLime, lime), lime).toBeGreaterThanOrEqual(BODY);
    }
  });

  /**
   * THE RULE `docs/ui-kit.md` STATES, MEASURED. "Never lime text on a light surface. It
   * measures 1.3:1 and is unreadable." Asserting the failure is what keeps the reason for the
   * rule attached to it: somebody who changes the lime ramp and quietly fixes this test has
   * changed the brand rather than the accessibility of one label.
   */
  it('refuses lime as a text colour on white, which is the mistake the rule exists for', () => {
    expect(ratio(colors.lime500, colors.whiteSurface)).toBeLessThan(LARGE_OR_NON_TEXT);
  });

  /**
   * And the other direction: `text-white/64` on a lime card, which `CLAUDE.md` names as the
   * reason the `onLime` variants exist. It is close to invisible, and this says by how much.
   */
  it('refuses translucent white on lime, which is why the onLime variants exist', () => {
    expect(ratio(colors.textSecondary, colors.lime500)).toBeLessThan(LARGE_OR_NON_TEXT);
  });

  /* -----------------------------------------------------------------------
   * The white surfaces
   * -------------------------------------------------------------------- */

  it('reads near-black text on both white surfaces', () => {
    expect(ratio(colors.textOnWhite, colors.whiteSurface)).toBeGreaterThanOrEqual(BODY);
    expect(ratio(colors.textOnWhite, colors.whiteMuted)).toBeGreaterThanOrEqual(BODY);
  });

  /**
   * `Pill`'s primary and `IconButton`'s light invert under `data-on-white` (issue 232): a
   * white pill on a white modal has no edge at all. The inverted fill is `--surface-1` at rest
   * and `--surface-3` on hover, and both have to be visible as a control against white.
   */
  it('gives the inverted primary pill an edge on white', () => {
    for (const fill of [colors.surface1, colors.surface3]) {
      expect(ratio(fill, colors.whiteSurface), fill).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
      expect(ratio(colors.textPrimary, fill), fill).toBeGreaterThanOrEqual(BODY);
    }
  });

  /** The focus ring under `data-on-white` is near-black, because lime there is under 3:1. */
  it('draws a visible focus ring on white once it turns near-black', () => {
    expect(ratio(colors.textOnWhite, colors.whiteSurface)).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
  });

  /* -----------------------------------------------------------------------
   * Danger as a fill — issue 229
   * -------------------------------------------------------------------- */

  /**
   * `Pill` and `IconButton`'s `danger` and `StatBlock`'s down badge are labels on a `--danger`
   * fill, at 11–16px and weight 500–600, which is not large text.
   */
  it('reads near-black text on danger', () => {
    expect(ratio(colors.textOnDanger, colors.danger)).toBeGreaterThanOrEqual(BODY);
  });

  /** Why `--text-on-danger` exists: the white label it replaced, measured. */
  it('refuses white as a label colour on danger', () => {
    expect(ratio(colors.textPrimary, colors.danger)).toBeLessThan(BODY);
  });

  /* -----------------------------------------------------------------------
   * The focus ring, and the states that carry meaning
   * -------------------------------------------------------------------- */

  /**
   * §9.3: "focus must be visible on every interactive element, including on lime." The ring is
   * `--lime-500`, which means it has to clear 3:1 against the darkest surface it is drawn on
   * AND against a lime button's own fill — the second is the one that is easy to miss, because
   * the ring is offset onto the surface behind the control rather than onto the control.
   */
  it('draws a visible focus ring on every surface it lands on', () => {
    for (const [name, surface] of DARK_SURFACES) {
      expect(ratio(colors.lime500, surface), name).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
    }
    expect(ratio(colors.lime500, colors.whiteSurface), 'on white').toBeLessThan(LARGE_OR_NON_TEXT);
  });

  /**
   * The status colours are never the only signal — §9.2 forbids colour alone — but they are
   * still drawn as icons and borders, which 1.4.11 covers.
   */
  it('draws every status colour visibly on the surfaces it appears on', () => {
    for (const status of [colors.success, colors.warning, colors.danger, colors.info, colors.hot]) {
      expect(ratio(status, colors.surface1), status).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
      expect(ratio(status, colors.surface2), status).toBeGreaterThanOrEqual(LARGE_OR_NON_TEXT);
    }
  });
});

/* -------------------------------------------------------------------------
 * WCAG 2.x relative luminance and contrast, from the specification
 * ---------------------------------------------------------------------- */

/**
 * The contrast ratio between a foreground and a background.
 *
 * The foreground may be translucent, in which case it is composited over the background first
 * — which is what a browser does and what makes `rgba(255,255,255,0.64)` a real colour rather
 * than an unanswerable question. The background must be opaque: a translucent surface over an
 * unknown parent has no ratio, and the token file has none.
 */
function ratio(foreground: string, background: string): number {
  const back = parse(background);
  if (back.alpha !== 1) {
    throw new Error(`${background} is translucent, so nothing can be measured against it`);
  }

  const front = composite(parse(foreground), back);

  const lighter = Math.max(luminance(front), luminance(back));
  const darker = Math.min(luminance(front), luminance(back));

  return (lighter + 0.05) / (darker + 0.05);
}

interface Rgba {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** `#RRGGBB` and `rgba(r,g,b,a)`, which is every shape the token file uses. */
function parse(colour: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex?.[1] !== undefined) {
    const value = Number.parseInt(hex[1], 16);
    return {
      red: (value >> 16) & 0xff,
      green: (value >> 8) & 0xff,
      blue: value & 0xff,
      alpha: 1,
    };
  }

  const rgba = /^rgba?\(([^)]+)\)$/i.exec(colour.trim());
  if (rgba?.[1] !== undefined) {
    const parts = rgba[1].split(',').map((part) => Number.parseFloat(part.trim()));
    const [red, green, blue, alpha] = parts;
    if (red === undefined || green === undefined || blue === undefined) {
      throw new Error(`Cannot read ${colour}`);
    }
    return { red, green, blue, alpha: alpha ?? 1 };
  }

  throw new Error(`Cannot read ${colour}`);
}

/** `front` painted over `back`, the way a browser composites it. */
function composite(front: Rgba, back: Rgba): Rgba {
  if (front.alpha === 1) return front;

  return {
    red: front.red * front.alpha + back.red * (1 - front.alpha),
    green: front.green * front.alpha + back.green * (1 - front.alpha),
    blue: front.blue * front.alpha + back.blue * (1 - front.alpha),
    alpha: 1,
  };
}

/** WCAG 2.x relative luminance. */
function luminance({ red, green, blue }: Rgba): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
