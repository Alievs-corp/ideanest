/**
 * The shape `scripts/generate-icons.mjs` writes: one Iconsax drawing per variant, as data.
 *
 * Colour is never stored. Every coloured attribute holds `currentColor`, and `Icon` sets the
 * token colour once on the `Svg` — which is how a glyph can only ever be drawn in a token.
 */
export type IconVariant = 'linear' | 'bold' | 'bulk';

export interface GlyphNode {
  readonly el: 'path' | 'circle' | 'rect' | 'g' | 'line' | 'ellipse' | 'polygon' | 'polyline';
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly children?: readonly GlyphNode[];
}

export interface IconGlyph {
  readonly name: string;
  readonly linear: readonly GlyphNode[];
  readonly bold: readonly GlyphNode[];
  readonly bulk: readonly GlyphNode[];
}
