import { Glyphs, type GlyphNode } from './index';

/**
 * The generated Iconsax set (#274). These hold the generator to the contract `Icon` relies on, so
 * a re-run against a changed source fails here rather than drawing a black or invisible glyph.
 */

const all = Object.values(Glyphs);

function walk(nodes: readonly GlyphNode[], visit: (node: GlyphNode) => void) {
  for (const node of nodes) {
    visit(node);
    if (node.children !== undefined) walk(node.children, visit);
  }
}

describe('generated glyphs', () => {
  it('draws every glyph in the three variants the skill uses', () => {
    for (const glyph of all) {
      for (const variant of ['linear', 'bold', 'bulk'] as const) {
        expect(glyph[variant].length).toBeGreaterThan(0);
      }
    }
  });

  it('never stores a colour: every painted attribute is currentColor', () => {
    for (const glyph of all) {
      for (const variant of ['linear', 'bold', 'bulk'] as const) {
        walk(glyph[variant], (node) => {
          for (const key of ['fill', 'stroke'] as const) {
            const value = node.attrs[key];
            if (value !== undefined && value !== 'none') expect(value).toBe('currentColor');
          }
        });
      }
    }
  });

  it('names each glyph after its export', () => {
    for (const [name, glyph] of Object.entries(Glyphs)) expect(glyph.name).toBe(name);
  });

  /**
   * Iconsax draws no bare cross and no bare tick. Both are one line, grown about the centre to a
   * full glyph's span — the checkbox tick must read at 14pt — with no tinted backdrop in any
   * variant, so a close button never shows a diamond behind its X.
   */
  it.each([
    ['Close', Glyphs.Close],
    ['Tick', Glyphs.Tick],
  ])('derives %s as one scaled line in every variant', (_name, glyph) => {
    for (const variant of ['linear', 'bold', 'bulk'] as const) {
      const [group] = glyph[variant];
      expect(glyph[variant]).toHaveLength(1);
      expect(String(group?.attrs.transform)).toMatch(/scale\(/);
      expect(group?.children).toHaveLength(1);
      expect(group?.children?.[0]?.attrs.opacity).toBeUndefined();
    }
    const weight = (variant: 'linear' | 'bold') => Number(glyph[variant][0]?.children?.[0]?.attrs.strokeWidth);
    expect(weight('bold')).toBeGreaterThan(weight('linear'));
  });
});
