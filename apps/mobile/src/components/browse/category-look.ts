import { categoryLook, type CategoryIconKey } from '@ideanest/discovery/category-look';
import { Glyphs, type IconGlyph } from '../../icons';

/**
 * The app's half of `@ideanest/discovery/category-look` (#335): each category's icon key as an
 * Iconsax glyph. The web maps the same keys to Lucide, so a category is one colour and one
 * picture on both clients. Draw them `bulk` — they are feature icons on an accent.
 */
export const CATEGORY_GLYPHS: Readonly<Record<CategoryIconKey, IconGlyph>> = {
  technology: Glyphs.Cpu,
  design: Glyphs.PenTool,
  games: Glyphs.Game,
  art: Glyphs.Brush,
  music: Glyphs.Musicnote,
  film: Glyphs.Video,
  publishing: Glyphs.Book1,
  food: Glyphs.Coffee,
  fashion: Glyphs.ShoppingBag,
  photography: Glyphs.Camera,
  comics: Glyphs.Message,
  crafts: Glyphs.Scissor,
  dance: Glyphs.MagicStar,
  journalism: Glyphs.DocumentText,
  theatre: Glyphs.Mask,
  other: Glyphs.Category,
};

/** A category's glyph, by slug. */
export function categoryGlyph(slug: string): IconGlyph {
  return CATEGORY_GLYPHS[categoryLook(slug).icon];
}
