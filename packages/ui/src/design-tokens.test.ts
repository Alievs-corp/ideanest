import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  accent,
  colors,
  duration,
  easing,
  radius,
  shadow,
  STAGGER_STEP,
} from '@ideanest/design-tokens';

/**
 * Guard rail for the rule stated in docs/ui-kit.md: every colour comes from the
 * token file. A literal hex inside a component means the palette has silently
 * grown a member nobody agreed to, and it will drift from the rest of the system.
 *
 * This test is the reason a designer can trust the token file is the whole truth.
 */

const SRC = join(import.meta.dirname, '.');

/** Hex colours that may legitimately appear in source. */
const ALLOWED = new Set<string>([
  // Referenced in an explanatory comment about a contrast failure.
  '#34D058',
  '#C6F432',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('colour discipline', () => {
  const files = walk(SRC).filter(
    (f) => !f.endsWith('design-tokens.test.ts') && !f.includes('sample-data'),
  );

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [relative(SRC, f), f]))(
    'has no unapproved hex literal: %s',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      const found: string[] = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      const offenders = found
        .map((h: string) => h.toUpperCase())
        .filter((h: string) => !ALLOWED.has(h));

      expect(
        offenders,
        `Use a token from @ideanest/design-tokens instead of a literal colour. ` +
          `See docs/ui-kit.md §2.`,
      ).toEqual([]);
    },
  );
});

describe('token contract', () => {
  it('keeps the documented contrast pairings intact', () => {
    // Near-black on lime is the only legible pairing; see docs/ui-kit.md §9.1.
    expect(colors.textOnLime).toBe('#0A0A0A');
    expect(colors.lime500).toBe('#C6F432');
  });

  it('keeps lime and success distinct', () => {
    // Conflating them tells backers "achieved" when the system means "hurry".
    expect(colors.lime500).not.toBe(colors.success);
  });

  it('does not use pure black as the page surface', () => {
    // Pure black smears during scroll on OLED panels.
    expect(colors.surface1).not.toBe('#000000');
  });
});

/**
 * `theme.css` and `index.ts` hold the same design twice, once for the browser and once for
 * React Native, and the header of each says "keep the two in sync". Until this existed nothing
 * did: `--lime-glow` and both shadows lived only in CSS, so the app could not draw a funded
 * progress bar or a floating panel without writing the value inline.
 *
 * Every custom property is looked up in the export it belongs to AND compared by value, because
 * a counterpart with a different value is the drift this exists to catch, only quieter.
 */
describe('theme.css and index.ts agree', () => {
  const css = readFileSync(join(import.meta.dirname, '../../design-tokens/src/theme.css'), 'utf8');
  const properties = [...css.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)].map(
    ([, name, value]) => [name, value?.replace(/\/\*.*?\*\//g, '').trim()] as [string, string],
  );

  it('finds the custom properties to compare', () => {
    expect(properties.length).toBeGreaterThan(30);
  });

  it.each(properties)('exports --%s from index.ts with the same value', (name, value) => {
    expect(counterpart(name), `--${name} has no counterpart in index.ts`).toBeDefined();
    expect(normalise(String(counterpart(name)))).toBe(normalise(value));
  });
});

/**
 * Where a custom property lives in the TypeScript export. The prefix decides the object, and
 * the rest of the name, camel-cased, is the key: `--surface-1` is `colors.surface1`,
 * `--radius-md` is `radius.md`, `--transition-fast` is `duration.fast`.
 */
function counterpart(name: string): unknown {
  const camel = (text: string) =>
    text.replace(/-(.)/g, (_match, next: string) => next.toUpperCase());
  const lookup = (object: object, key: string) => (object as Record<string, unknown>)[key];

  if (name === 'stagger-step') return `${STAGGER_STEP}ms`;
  if (name.startsWith('accent-')) {
    const [hue, glow] = name.slice('accent-'.length).split('-');
    const tone = lookup(accent, hue ?? '') as { surface: string; glow: string } | undefined;
    return glow === 'glow' ? tone?.glow : tone?.surface;
  }
  if (name.startsWith('radius-')) {
    const value = lookup(radius, name.slice('radius-'.length));
    return value === undefined ? undefined : `${String(value)}px`;
  }
  if (name.startsWith('shadow-')) return lookup(shadow, name.slice('shadow-'.length));
  if (name.startsWith('transition-')) {
    const value = lookup(duration, name.slice('transition-'.length));
    // The CSS spells the easing into the shorthand; the export keeps it in `easing`.
    return value === undefined ? undefined : `${Number(value) / 1000}s ease-in-out`;
  }
  if (name.startsWith('ease-')) {
    const value = lookup(easing, camel(name.slice('ease-'.length)));
    return Array.isArray(value) ? `cubic-bezier(${value.join(', ')})` : undefined;
  }
  return lookup(colors, camel(name));
}

/**
 * One spelling for a value both files may write differently: `rgb(255 255 255 / 0.08)` and
 * `rgba(255,255,255,0.08)` are the same colour, and a hex digit's case is not a difference.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/rgba?\(([^)]+)\)/g, (_match, inner: string) => {
      const parts = inner
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      const [red, green, blue, alpha = 1] = parts;
      return `rgba(${red},${green},${blue},${alpha})`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
