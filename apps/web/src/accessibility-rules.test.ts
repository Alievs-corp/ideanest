import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The two rules from §9 that no rendered test can see — issue #129.
 *
 * <h2>Why these are static scans</h2>
 *
 * Both catch defects that are invisible in a rendered tree. A `<div onClick={…}>` looks and
 * behaves correctly for anybody using a mouse, and axe does not flag it either: there is no
 * ARIA violation in a `<div>` that happens to have a listener, and a rule that guessed would
 * fire on every card with a hover effect. Colour is worse — jsdom computes no styles at all,
 * so every automated contrast rule is inert under this test runner.
 *
 * <p>They also cover every component in the application rather than the ones somebody
 * remembered to write a test for. The rendered passes in the flow suites cover the three
 * surfaces #129 names; these cover the rest, cheaply, for ever.
 *
 * <p>The arithmetic that decides which token is legible on which surface is
 * `packages/ui/src/contrast.test.ts`, beside the token file it reads. This is the other half:
 * whether the tokens that came out of it are used for what they are for.
 */

const SOURCE = join(import.meta.dirname, '.');

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * One JSX opening tag, with its attributes.
 *
 * `[^<>]` keeps the match inside a single tag, with `\{[^{}]*\}` allowing one level of
 * expression braces — enough for `onClick={close}` and `className={cn(…)}`, and not enough to
 * run away across a file.
 */
function openingTags(source: string, tags: string): Iterable<RegExpMatchArray> {
  return source.matchAll(new RegExp(`<(${tags})((?:[^<>]|\\{[^{}]*\\})*?)>`, 'gs'));
}

interface Found {
  readonly file: string;
  readonly tag: string;
  readonly attributes: string;
}

function scan(tags: string, matching: (attributes: string) => boolean): readonly Found[] {
  const found: Found[] = [];

  for (const file of sourceFiles(SOURCE)) {
    const source = readFileSync(file, 'utf8');

    for (const match of openingTags(source, tags)) {
      const [, tag, attributes] = match;
      if (tag === undefined || attributes === undefined) continue;
      if (!matching(attributes)) continue;

      found.push({ file: relative(SOURCE, file), tag, attributes });
    }
  }

  return found;
}

describe('the static half of the accessibility rules', () => {
  it('finds source to scan, so a broken scan cannot pass as a clean one', () => {
    expect(sourceFiles(SOURCE).length).toBeGreaterThan(50);
  });

  /* -----------------------------------------------------------------------
   * Keyboard reachability
   * -------------------------------------------------------------------- */

  /**
   * Elements a browser already makes focusable and operable. Capitalised components are not
   * scanned: `<Pill onClick=…>` is this application's own button, and what it renders is
   * checked in `packages/ui` where it is defined.
   */
  const PLAIN = 'div|span|p|li|ul|ol|section|article|header|footer|nav|aside|figure|td|tr|label|img|h1|h2|h3|h4';

  const clickHandlers = scan(PLAIN, (attributes) => /\bonClick\s*=/u.test(attributes));

  it('puts every click handler on an element a keyboard can reach', () => {
    /*
     * A modal's backdrop is the one exception, and it is not really one: it is
     * `aria-hidden="true"`, so it is not in the accessibility tree at all, and dismissing by
     * clicking outside is a convenience that is always duplicated — every dialog here closes
     * on Escape and has a close button.
     *
     * Anything else fails, and the fix is never `tabIndex={0}` plus a key handler. That is
     * re-implementing Enter, Space, the disabled state, the focus ring and the role, and the
     * ones that get forgotten are the ones that matter. Use a `<button>`.
     */
    const offenders = clickHandlers
      .filter((handler) => !/\baria-hidden\s*=\s*["{]?true/u.test(handler.attributes))
      .map((handler) => `${handler.file}: <${handler.tag}>`);

    expect(
      offenders,
      'A click handler on a plain element is a control a keyboard reader cannot reach. ' +
        'Use a <button>; the only exception is an aria-hidden modal backdrop.',
    ).toEqual([]);
  });

  /** Pinned, so a fourth backdrop is something somebody looks at rather than a count that grew. */
  it('has exactly the three modal backdrops as its exception', () => {
    expect(clickHandlers.map((handler) => handler.file).sort()).toEqual([
      join('components', 'moderation', 'ReportControl.tsx'),
      join('components', 'shell', 'MobileNavDrawer.tsx'),
      join('components', 'shell', 'WhatsAppLauncher.tsx'),
    ]);
  });

  /* -----------------------------------------------------------------------
   * Contrast, where the token is used rather than where it is defined
   * -------------------------------------------------------------------- */

  /**
   * `--text-tertiary` MEASURES 3.8:1, WHICH IS NOT A BODY-TEXT RATIO.
   *
   * `docs/ui-kit.md` §9.1 recorded it as 4.9:1 and called it "AA at 16px+" until #129
   * recomputed the table. Both halves were wrong, and four places had taken the table at its
   * word: the footer's entire link list, the subcategory links on `/categories`, the
   * not-found page's suggestions, and the sentence a profile shows when somebody has written
   * no biography.
   *
   * <p>A link is the sharpest case and the easiest to check, which is why this scan is
   * limited to them: text inside a control has to clear 4.5:1 whatever its size, a link is
   * always text somebody has to read to decide whether to follow it, and hovering to make it
   * legible is not something a reader can be asked to do. Non-interactive prose in this token
   * is a judgement about size and repetition, and stays a matter for review.
   */
  it('never puts an interactive control in the tertiary text colour', () => {
    const offenders = scan('Link|a|button|Pill', (attributes) =>
      /\btext-white\/40\b/u.test(attributes),
    ).map((found) => `${found.file}: <${found.tag}>`);

    expect(
      offenders,
      'text-white/40 is --text-tertiary, which measures 3.8:1 — below WCAG 1.4.3 for text ' +
        'of any size inside a control. Use text-white/64. See docs/ui-kit.md §9.1.',
    ).toEqual([]);
  });

  /**
   * `--text-disabled` is 24% white, which is below every threshold there is. §9.2 lists using
   * it for readable text as a prohibition outright, and this is that prohibition, checked.
   */
  it('never uses the disabled colour for text a reader has to read', () => {
    const offenders = scan('Link|a|button|Pill|p|span|li', (attributes) =>
      /\btext-white\/24\b/u.test(attributes),
    ).map((found) => `${found.file}: <${found.tag}>`);

    expect(
      offenders,
      'text-white/24 is --text-disabled and is not a readable colour. See docs/ui-kit.md §9.2.',
    ).toEqual([]);
  });
});
