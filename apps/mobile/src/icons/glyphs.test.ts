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

  it('derives the two glyphs Iconsax does not draw', () => {
    expect(Glyphs.Close.linear[0]?.attrs.transform).toBe('rotate(45 12 12)');
    expect(Glyphs.Tick.linear).toHaveLength(1);
    expect(Glyphs.Tick.bold[0]?.attrs.strokeWidth).toBeGreaterThan(
      Number(Glyphs.Tick.linear[0]?.attrs.strokeWidth),
    );
  });
});
