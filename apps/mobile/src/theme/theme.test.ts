/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { colors, radius, spacing } from '@ideanest/design-tokens';
import * as theme from './index';
import { fontSize, lineHeight, motion, tracking } from './index';

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
  const files = walk(SRC).filter((file) => !file.endsWith('theme.test.ts'));

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
