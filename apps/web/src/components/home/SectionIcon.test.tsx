import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Category, LampCharge, Send2, Timer1, TrendUp } from '../icons/iconsax';
import { SectionIcon, type SectionGesture } from './SectionIcon';

afterEach(cleanup);

const GLYPHS = [
  [TrendUp, 'rise'],
  [Timer1, 'tilt'],
  [Send2, 'launch'],
  [LampCharge, 'swing'],
  [Category, 'turn'],
] as const satisfies readonly (readonly [unknown, SectionGesture])[];

describe('SectionIcon', () => {
  it('is hidden from assistive technology — the heading beside it already says what the band is', () => {
    const { container } = render(<SectionIcon glyph={Timer1} gesture="tilt" />);
    const mark = container.firstElementChild;
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('svg')).toHaveLength(3);
  });

  it('draws the line at rest and a filled drawing only under the pointer or focus', () => {
    const { container } = render(<SectionIcon glyph={Timer1} gesture="tilt" />);
    const [line, bold, bulk] = Array.from(container.querySelectorAll('svg'));
    expect(line?.getAttribute('class')).not.toContain(' opacity-0');
    expect(line?.getAttribute('class')).toContain('group-hover/heading:opacity-0');
    for (const filled of [bold, bulk]) {
      expect(filled?.getAttribute('class')).toContain('opacity-0');
      expect(filled?.getAttribute('class')).toContain('group-hover/heading:opacity-100');
      expect(filled?.getAttribute('class')).toContain('group-focus-within/heading:opacity-100');
    }
  });

  it('fills solid on the dark theme, like the logo, and two-tone on the light one', () => {
    const { container } = render(<SectionIcon glyph={Timer1} gesture="tilt" />);
    const [, bold, bulk] = Array.from(container.querySelectorAll('svg'));
    expect(bold?.querySelector('[opacity]')).toBeNull();
    expect(bold?.getAttribute('class')).toContain('[[data-theme=light]_&]:hidden');
    expect(bulk?.querySelector('[opacity]')).not.toBeNull();
    expect(bulk?.getAttribute('class')?.split(/\s+/)).toContain('hidden');
    expect(bulk?.getAttribute('class')).toContain('[[data-theme=light]_&]:block');
  });

  it('turns lime ink only while it answers — never lime at rest, never raw lime', () => {
    const { container } = render(<SectionIcon glyph={Timer1} gesture="tilt" />);
    const classes = (container.firstElementChild?.getAttribute('class') ?? '').split(/\s+/);
    expect(classes).toContain('text-fg');
    expect(classes).toContain('group-hover/heading:text-lime-ink');
    expect(classes).toContain('group-focus-within/heading:text-lime-ink');
    for (const name of classes) {
      if (name.includes('lime')) expect(name).toMatch(/^group-(hover|focus-within)\/heading:.*lime-ink/);
    }
  });

  it.each(GLYPHS)('moves %s only for a reader who has not asked for reduced motion', (glyph, gesture) => {
    const { container } = render(<SectionIcon glyph={glyph} gesture={gesture} />);
    const mover = container.querySelector('svg')?.parentElement;
    const moves = (mover?.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((name) => /(rotate|translate|scale)/.test(name) && !name.startsWith('transition'));
    expect(moves.length).toBeGreaterThan(0);
    for (const name of moves) expect(name.startsWith('motion-safe:')).toBe(true);
  });

  it('draws in the text colour, never a literal', () => {
    for (const [glyph] of GLYPHS) {
      const { container, unmount } = render(<SectionIcon glyph={glyph} gesture="turn" />);
      for (const node of Array.from(container.querySelectorAll('path, circle, rect, line'))) {
        for (const attribute of ['fill', 'stroke']) {
          const value = node.getAttribute(attribute);
          if (value !== null) expect(value).toBe('currentColor');
        }
      }
      unmount();
    }
  });
});
