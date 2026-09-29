import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every custom property this application reads is one somebody defined — issue #134.
 *
 * <h2>Why the contrast guard did not catch it</h2>
 *
 * `packages/ui/src/contrast.test.ts` measures token pairs, and `design-tokens.test.ts` refuses
 * hex literals. Neither sees `text-[--ink-900]`: a class that names a token which does not
 * exist. CSS treats such a declaration as invalid at computed-value time, so the text falls
 * back to the inherited colour — on the survey builder's lime button, white body text on lime,
 * about 1.3:1. No build step complains and jsdom computes no styles, so only reading the source
 * can find it.
 *
 * <h2>What counts as defined</h2>
 *
 * A property declared in the token file, in `@ideanest/ui`'s stylesheet (which carries
 * Tailwind's theme bridge), or in this application's own stylesheet. A reference to anything
 * else is a typo or an invented colour, and CLAUDE.md §6 says never to invent one.
 */

const SOURCE = join(import.meta.dirname, '.');
const REPOSITORY = join(import.meta.dirname, '../../..');

/** The stylesheets that may declare a custom property this application reads. */
const STYLESHEETS = [
  'packages/design-tokens/src/theme.css',
  'packages/ui/src/styles.css',
  'apps/web/src/app/globals.css',
];

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

function defined(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const file of STYLESHEETS) {
    const css = readFileSync(join(REPOSITORY, file), 'utf8');
    for (const [, name] of css.matchAll(/(--[\w-]+)\s*:/g)) {
      if (name !== undefined) names.add(name);
    }
  }
  return names;
}

/**
 * The custom properties one file reads: `var(--x)`, Tailwind's arbitrary `[--x]`, and its
 * shorthand `-(--x)`. `[--x:value]` sets a property rather than reading one, and is not matched.
 */
function referencesIn(source: string): string[] {
  const names: string[] = [];
  for (const pattern of [/var\(\s*(--[\w-]+)/g, /\[(--[\w-]+)\]/g, /-\((--[\w-]+)\)/g]) {
    for (const [, name] of source.matchAll(pattern)) {
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

describe('custom property references', () => {
  it('finds source and definitions to compare, so a broken scan cannot pass as a clean one', () => {
    expect(sourceFiles(SOURCE).length).toBeGreaterThan(50);
    expect(defined().has('--text-on-lime')).toBe(true);
  });

  it('reads the forms a component writes a token in', () => {
    expect(referencesIn('text-[--ink-900] bg-(--surface-2) color: var(--lime-500);')).toEqual([
      '--lime-500',
      '--ink-900',
      '--surface-2',
    ]);
    expect(referencesIn('[--progress:40%]')).toEqual([]);
  });

  it('names no custom property that is not defined', () => {
    const tokens = defined();
    const undefinedReferences = sourceFiles(SOURCE).flatMap((file) =>
      referencesIn(readFileSync(file, 'utf8'))
        .filter((name) => !tokens.has(name))
        .map((name) => `${relative(SOURCE, file)}: ${name}`),
    );

    expect(undefinedReferences).toEqual([]);
  });
});
