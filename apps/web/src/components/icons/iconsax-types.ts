/**
 * The shape `scripts/generate-icons.mjs` writes: one Iconsax drawing per variant, as data —
 * the web's half of the mobile app's `src/icons/types.ts`.
 *
 * Colour is never stored. Every coloured attribute holds `currentColor`, so a glyph takes the
 * token colour of the text around it and can only ever be drawn in a token.
 */
export interface GlyphNode {
  readonly el: 'path' | 'circle' | 'rect' | 'g' | 'line' | 'ellipse' | 'polygon' | 'polyline';
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly children?: readonly GlyphNode[];
}

export interface IconsaxGlyph {
  readonly name: string;
  /** The line drawing — at rest. */
  readonly linear: readonly GlyphNode[];
  /** The solid drawing — under the pointer on the dark theme, one lime like the logo. */
  readonly bold: readonly GlyphNode[];
  /** The filled drawing, its second layer the same colour at 40% — under the pointer on light. */
  readonly bulk: readonly GlyphNode[];
}
