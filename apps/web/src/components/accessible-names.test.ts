import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The words nobody reviewing a screen ever reads — issue #86.
 *
 * <h2>Why these needed a rule of their own</h2>
 *
 * #86 was six strings left over after seven surfaces had been translated, and four of them
 * were `SkeletonGroup` labels. That is not a coincidence. A skeleton's label is the
 * accessible name of a loading region: invisible to everybody looking at the page, and
 * announced to exactly the readers who cannot see it. Discovery, the inbox and the shipping
 * form were all drawn from the catalogue around them and still said "Loading projects" in
 * English, because nobody reads a skeleton.
 *
 * <p>An `aria-label` is the same shape of mistake with the same cause. Both survive every
 * review of the screen they are on, which is why they are checked by a test instead.
 *
 * <h2>Source-reading, deliberately, and narrow</h2>
 *
 * It reads the components' own source rather than rendering them: a literal is a property of
 * the file, and a test that mounted every client component to find one would be a test of the
 * fetch mocks. It says nothing about whether the key is the RIGHT one — `catalogue.test.ts`
 * and `account-area.pages.test.ts` cover the rest — only that a name a screen reader
 * announces was not typed in one language.
 *
 * <p>Both attributes reach a component as an expression now. Something resolved on the server
 * and handed down, or a prop: `DiscoverySkeleton` takes its label from the caller precisely
 * because it is rendered from a Suspense fallback on the server and from the feed on the
 * client, and only one of those can read a catalogue.
 */

const SOURCE = join(process.cwd(), 'src');

/** Every `.tsx` under `src`, except the tests, which are allowed to type words. */
function components(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return components(path);
    if (!entry.name.endsWith('.tsx')) return [];
    if (entry.name.endsWith('.test.tsx') || entry.name.endsWith('.stories.tsx')) return [];

    return [path];
  });
}

const FILES = components(SOURCE);

describe('the names only a screen reader hears', () => {
  it('finds the components to read, so an empty sweep cannot pass for a clean one', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('never carries an `aria-label` as a literal', () => {
    const offenders = FILES.filter((path) => /aria-label="/u.test(readFileSync(path, 'utf8'))).map(
      (path) => path.slice(SOURCE.length + 1),
    );

    expect(offenders, 'these announce an English name whatever the reader chose').toEqual([]);
  });

  it('never labels a loading region with a literal', () => {
    /*
     * `SkeletonGroup` is the kit's live region for a load in progress, and its `label` is what
     * is announced while the shimmer is on screen. Matched across lines because the attribute
     * is usually not on the same line as the tag.
     */
    const offenders = FILES.filter((path) =>
      /<SkeletonGroup[^>]*\slabel="/su.test(readFileSync(path, 'utf8')),
    ).map((path) => path.slice(SOURCE.length + 1));

    expect(offenders, 'a skeleton label is a word like any other and belongs in the catalogue')
      .toEqual([]);
  });
});
