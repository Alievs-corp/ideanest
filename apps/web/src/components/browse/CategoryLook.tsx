import {
  BookOpen,
  Brush,
  Camera,
  Coffee,
  Cpu,
  Drama,
  Gamepad2,
  LayoutGrid,
  MessageCircle,
  Music,
  Newspaper,
  PenTool,
  Scissors,
  ShoppingBag,
  Sparkles,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { categoryLook, type CategoryIconKey } from '@ideanest/discovery/category-look';
import { ACCENT_FILL } from './accent-surface';

/**
 * The web's half of `@ideanest/discovery/category-look` (#335): the icon key as a Lucide
 * component. The app maps the same keys to Iconsax, so a category is one colour and one picture
 * on both clients. The accent classes are in `accent-surface.ts`.
 */

export const CATEGORY_ICONS: Readonly<Record<CategoryIconKey, LucideIcon>> = {
  technology: Cpu,
  design: PenTool,
  games: Gamepad2,
  art: Brush,
  music: Music,
  film: Video,
  publishing: BookOpen,
  food: Coffee,
  fashion: ShoppingBag,
  photography: Camera,
  comics: MessageCircle,
  crafts: Scissors,
  dance: Sparkles,
  journalism: Newspaper,
  theatre: Drama,
  other: LayoutGrid,
};

/** A category's pictogram. Decorative: the name is always written beside it. */
export function CategoryIcon({ slug, className }: { readonly slug: string; readonly className?: string }) {
  const Icon = CATEGORY_ICONS[categoryLook(slug).icon];
  return <Icon aria-hidden="true" className={className} />;
}

/**
 * The category's icon on a disc of its accent — the mark beside a category's name on the index
 * and the landing page, as the app draws it.
 */
export function CategoryBadge({
  slug,
  size = 'md',
}: {
  readonly slug: string;
  readonly size?: 'md' | 'lg';
}) {
  const { accent } = categoryLook(slug);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-on-accent ${ACCENT_FILL[accent]} ${size === 'lg' ? 'size-14' : 'size-10'}`}
    >
      <CategoryIcon slug={slug} className={size === 'lg' ? 'size-[31px]' : 'size-[22px]'} />
    </span>
  );
}
