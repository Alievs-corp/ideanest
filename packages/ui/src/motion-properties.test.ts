import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard rail for the motion rule in CLAUDE.md §2 and docs/motion-system.md: animate
 * `transform` and `opacity`, never a property that moves layout — issue 146.
 *
 * A width, height, margin or offset transition makes the browser lay the page out again
 * on every frame. The progress bar did it on every campaign card; nothing failed, it was
 * just slower, which is why it took a source read to find. This test is that read, for
 * every file in the kit.
 *
 * Colour transitions are not layout and are not flagged: they repaint, and the kit uses
 * them for hover states throughout.
 */

const SRC = join(import.meta.dirname, '.');

/** Properties whose change forces layout. */
const LAYOUT =
  /\b(?:width|height|min-width|max-width|min-height|max-height|top|left|right|bottom|inset|margin[\w-]*|padding[\w-]*|gap|flex-basis|all)\b/;

/**
 * Transitions that predate the guard, each one a known debt rather than a precedent. Every
 * entry is tracked in issue 166, and the list may only shrink: a new entry is a design change
 * and needs an issue of its own.
 */
const KNOWN: ReadonlySet<string> = new Set([
  'components/Avatar/Avatar.tsx: transition-[margin]',
  'layout/TopBar.tsx: transition-[padding]',
  'layout/TopBar.tsx: transition-[max-width,background-color,border-color]',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The transitions one file declares: Tailwind's `transition-[…]`, and CSS or style-object
 * `transition` / `transition-property` / `transitionProperty` values.
 */
function transitionsIn(source: string): string[] {
  const found: string[] = [];
  for (const [whole] of source.matchAll(/transition-\[[^\]]+\]/g)) found.push(whole);
  for (const [whole] of source.matchAll(/transition(?:-property|Property)?\s*:\s*['"`]?[^;'"`}\n]+/g)) {
    found.push(whole.trim());
  }
  return found;
}

function movesLayout(transition: string): boolean {
  const properties = transition.startsWith('transition-[')
    ? transition.slice('transition-['.length, -1)
    : transition.slice(transition.indexOf(':') + 1);
  return LAYOUT.test(properties.replace(/var\([^)]*\)/g, ''));
}

describe('motion discipline', () => {
  const files = walk(SRC);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('recognises a layout transition in each form it can be written', () => {
    expect(transitionsIn("'transition-[width] duration-300'").filter(movesLayout)).toHaveLength(1);
    expect(transitionsIn('.fill { transition: height 0.8s ease; }').filter(movesLayout)).toHaveLength(1);
    expect(transitionsIn("style={{ transitionProperty: 'top' }}").filter(movesLayout)).toHaveLength(1);
    expect(transitionsIn("'transition-transform transition-[opacity,transform]'").filter(movesLayout)).toEqual([]);
    expect(transitionsIn("'transition-[background-color,border-color]'").filter(movesLayout)).toEqual([]);
  });

  it('animates no property that moves layout', () => {
    const offenders = files.flatMap((file) =>
      transitionsIn(readFileSync(file, 'utf8'))
        .filter(movesLayout)
        .map((transition) => `${relative(SRC, file).replaceAll('\\', '/')}: ${transition}`)
        .filter((entry) => !KNOWN.has(entry)),
    );

    expect(
      offenders,
      'Animate transform and opacity only. See CLAUDE.md §2 and docs/motion-system.md.',
    ).toEqual([]);
  });

  it('still needs every known exception, so the list cannot outlive its debt', () => {
    const present = new Set(
      files.flatMap((file) =>
        transitionsIn(readFileSync(file, 'utf8')).map(
          (transition) => `${relative(SRC, file).replaceAll('\\', '/')}: ${transition}`,
        ),
      ),
    );

    expect([...KNOWN].filter((entry) => !present.has(entry))).toEqual([]);
  });
});
