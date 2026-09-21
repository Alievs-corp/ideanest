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
 * <p>#99 added the third. A `ProgressBar`'s label is its accessible name and a `StatBlock`'s
 * is the word printed under the figure — the first is invisible to everybody who can see the
 * page and the second is a word so small nobody proofreads it. `LiveFunding` typed four of
 * them in English beneath a campaign page that was otherwise drawn from the catalogue, and
 * neither rule above would have caught one.
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

  /*
   * ISSUE #99. A literal here is not merely untranslated: `LiveFunding`'s
   * `label={backersCount === 1 ? 'backer' : 'backers'}` was ALSO wrong in Russian, which
   * picks between three forms by the last digit. The ternary is the shape the rule catches.
   */
  it('never labels a kit figure or progress bar with a literal', () => {
    const offenders = FILES.filter((path) =>
      labelsOf(readFileSync(path, 'utf8')).some(quotesAWord),
    ).map((path) => path.slice(SOURCE.length + 1));

    expect(offenders, 'a label under a figure is a word like any other and belongs in the catalogue')
      .toEqual([]);
  });
});

/**
 * Every `label=` expression on a `<ProgressBar>` or `<StatBlock>` in `source`.
 *
 * Scanned rather than matched, because the value is an expression and expressions nest: the
 * good spelling is `label={fillPlaceholders(copy.progressLabel, { percent })}`, whose own
 * braces a regex stops at, and the bad one is a ternary whose literals are several tokens in.
 */
function labelsOf(source: string): readonly string[] {
  const found: string[] = [];

  for (const match of source.matchAll(/<(?:ProgressBar|StatBlock)\b/gu)) {
    const tag = openingTag(source, match.index);
    const label = /\slabel=(?:("[^"]*")|\{)/u.exec(tag);
    if (label === null) continue;

    found.push(label[1] ?? braced(tag, label.index + label[0].length - 1));
  }

  return found;
}

/** From `<` to the `>` that closes the tag, ignoring any `>` inside a braced expression. */
function openingTag(source: string, start: number): string {
  let depth = 0;

  for (let at = start; at < source.length; at += 1) {
    const character = source[at];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === '>' && depth === 0) return source.slice(start, at);
  }

  return source.slice(start);
}

/** The contents of the braced expression beginning at `open`. */
function braced(text: string, open: number): string {
  let depth = 0;

  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1;
    else if (text[at] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, at);
    }
  }

  return text.slice(open + 1);
}

/**
 * Whether an expression quotes a word rather than reading one.
 *
 * A quoted string of letters is a word somebody typed. `size="md"` is not a label and never
 * reaches this; a class name never appears in a `label`; and `copy.pledged` carries no quotes
 * at all, which is the point.
 */
function quotesAWord(expression: string): boolean {
  return /(["'`])[^"'`]*\p{L}{2}[^"'`]*\1/u.test(expression);
}
