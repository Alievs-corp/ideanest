/**
 * @vitest-environment node
 *
 * This file reads a source file and compares numbers. Spinning up jsdom for it
 * would cost more than every assertion in it put together, and the suite is
 * already wide enough that the marginal worker matters.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The subset list in `layout.tsx` is the only thing standing between this
 * product and a row of tofu boxes where a creator's name should be.
 *
 * It reads the layout's source rather than importing it, because importing the
 * module executes `next/font/google`, which reaches the network at build time
 * and is not something a unit test should depend on. What matters here is the
 * literal that was written down, and the source is where that literal is.
 *
 * Resolved from `process.cwd()` — vitest's root is this package — rather than
 * from `import.meta.url`, which under the jsdom environment is not a `file:`
 * URL and cannot be turned into a path.
 */
const layoutSource = readFileSync(resolve(process.cwd(), 'src/app/[locale]/layout.tsx'), 'utf8');

/**
 * The `unicode-range` Google Fonts serves for each cut, copied from the
 * stylesheet at `fonts.googleapis.com/css2?family=Inter` on 2026-08-18.
 *
 * They are recorded rather than fetched for the same reason the test does not
 * import the layout: a unit test that fails when a CDN is slow teaches everyone
 * to ignore it. If Google ever narrows a range this test will go on passing and
 * the check has to be redone by hand — that is the trade, and it is the right
 * way round, because the failure this guards against is somebody editing the
 * list below, not Google redrawing its subsets.
 */
const SUBSET_RANGES: Record<string, ReadonlyArray<readonly [number, number]>> = {
  latin: [
    [0x0000, 0x00ff],
    [0x0131, 0x0131],
    [0x0152, 0x0153],
    [0x02bb, 0x02bc],
    [0x02c6, 0x02c6],
    [0x02da, 0x02da],
    [0x02dc, 0x02dc],
    [0x2000, 0x206f],
  ],
  'latin-ext': [
    [0x0100, 0x02ba],
    [0x02bd, 0x02c5],
    [0x02c7, 0x02cc],
    [0x02ce, 0x02d7],
    [0x02dd, 0x02ff],
    [0x1e00, 0x1e9f],
  ],
  /* Google's `cyrillic` cut: the modern Russian alphabet, the stressed vowel, the Ukrainian
   * ghe, and the numero sign. `cyrillic-ext` — the historic and minority-language letters —
   * is a separate file and is not declared. */
  cyrillic: [
    [0x0301, 0x0301],
    [0x0400, 0x045f],
    [0x0490, 0x0491],
    [0x04b0, 0x04b1],
    [0x2116, 0x2116],
  ],
};

/**
 * Every character Azerbaijani adds to the Latin alphabet, in both cases. `ə` is
 * the one to watch: it is the most common letter in the language and the one a
 * Latin-only subset drops.
 */
const AZERBAIJANI = [...'əğıöşüçƏĞİÖŞÜÇ'];

/**
 * Enough of Russian to catch the cut being dropped: both cases of а, б, я, ж, ю and ы, and
 * `ё`, which sits at U+0451 and is the letter a narrower range is most likely to lose.
 */
const RUSSIAN = [...'абяжюыёАБЯЖЮЫЁ'];

/**
 * The subsets passed to each face in the root layout — Inter for text, Geologica for headings.
 * Both draw the same four languages, so both are held to every assertion below.
 */
function declaredSubsetLists(): string[][] {
  const lists = [...layoutSource.matchAll(/subsets:\s*\[([^\]]*)\]/g)].map((match) =>
    [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string),
  );
  if (lists.length === 0) throw new Error('No `subsets:` array found in layout.tsx');
  return lists;
}

/** Every face's subsets, one after another; a face missing a cut fails on its own list. */
const FACES = declaredSubsetLists();

function declaredSubsets(): string[] {
  return FACES.flat();
}

function covers(subsets: readonly string[], codePoint: number): boolean {
  return subsets.some((subset) =>
    SUBSET_RANGES[subset]?.some(([from, to]) => codePoint >= from && codePoint <= to),
  );
}

describe('font subsets', () => {
  it('loads two faces, text and headings', () => {
    expect(FACES).toHaveLength(2);
  });

  it.each(FACES.map((subsets, index) => [index, subsets]))(
    'face %s declares every subset it needs and no more',
    (_index, subsets) => {
      expect([...subsets].sort()).toEqual(['cyrillic', 'latin', 'latin-ext']);
    },
  );

  it.each(AZERBAIJANI.map((character) => [character, character.codePointAt(0) as number]))(
    'covers %s (U+%s)',
    (character, codePoint) => {
      expect(
        covers(declaredSubsets(), codePoint),
        `${character} is not in any declared subset`,
      ).toBe(true);
    },
  );

  it.each(RUSSIAN.map((character) => [character, character.codePointAt(0) as number]))(
    'covers %s (U+%s)',
    (character, codePoint) => {
      /*
       * `messages/ru.json` has shipped since #324 and, until the `cyrillic` cut was declared,
       * every word of it rendered in the system fallback: Inter's Latin cuts carry no
       * Cyrillic. It did not look broken, it looked like a slightly different font, which is
       * exactly why it survived review for as long as it did.
       */
      expect(
        covers(declaredSubsets(), codePoint),
        `${character} is not in any declared subset`,
      ).toBe(true);
    },
  );

  /**
   * Preloading a cut nothing is written in spends bandwidth the largest
   * contentful paint needs. `cyrillic-ext` is the tempting one now that
   * `cyrillic` is declared — it carries the historic and minority-language
   * letters, and §21.1's four languages need none of them.
   */
  it('declares none of the cuts this product never renders', () => {
    expect(declaredSubsets()).not.toContain('cyrillic-ext');
    expect(declaredSubsets()).not.toContain('greek');
    expect(declaredSubsets()).not.toContain('greek-ext');
    expect(declaredSubsets()).not.toContain('vietnamese');
  });
});
