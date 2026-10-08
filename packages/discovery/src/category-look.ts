import type { AccentName } from '@ideanest/design-tokens';

/**
 * How a category looks: its accent and its pictogram, on the web and on the phone (#335).
 *
 * One table both clients read, so Games is the same colour and the same picture in a browser
 * and in the app, and a campaign card takes the colour of its category on both. The accent is
 * decoration — lime keeps "act now", `success` keeps "funded" — and the icon always sits beside
 * the category's name, never instead of it.
 *
 * The icon is a key, not a component: the web draws Lucide and the app draws Iconsax, and each
 * maps these keys to its own set.
 *
 * <h2>The seeded taxonomy is listed, everything else is hashed</h2>
 *
 * §4.3 lets an administrator add a category without a deployment, so the table cannot be the
 * whole truth. A slug it does not know takes an accent hashed from the slug — stable across
 * screens, environments and reloads, which a hash of the row's UUID was not — and the generic
 * grid icon.
 *
 * The fifteen V11 seeds cycle sky, sun, mint in their sort order, so no two categories that sit
 * side by side in a two-, four- or five-column grid share a colour.
 */

export type { AccentName };

export const ACCENT_NAMES: readonly AccentName[] = ['sun', 'mint', 'sky'];

export type CategoryIconKey =
  | 'technology'
  | 'design'
  | 'games'
  | 'art'
  | 'music'
  | 'film'
  | 'publishing'
  | 'food'
  | 'fashion'
  | 'photography'
  | 'comics'
  | 'crafts'
  | 'dance'
  | 'journalism'
  | 'theatre'
  | 'other';

export interface CategoryLook {
  readonly accent: AccentName;
  readonly icon: CategoryIconKey;
}

const SEEDED: Readonly<Record<string, CategoryLook>> = {
  technology: { accent: 'sky', icon: 'technology' },
  design: { accent: 'sun', icon: 'design' },
  games: { accent: 'mint', icon: 'games' },
  art: { accent: 'sky', icon: 'art' },
  music: { accent: 'sun', icon: 'music' },
  film: { accent: 'mint', icon: 'film' },
  publishing: { accent: 'sky', icon: 'publishing' },
  food: { accent: 'sun', icon: 'food' },
  fashion: { accent: 'mint', icon: 'fashion' },
  photography: { accent: 'sky', icon: 'photography' },
  comics: { accent: 'sun', icon: 'comics' },
  crafts: { accent: 'mint', icon: 'crafts' },
  dance: { accent: 'sky', icon: 'dance' },
  journalism: { accent: 'sun', icon: 'journalism' },
  theatre: { accent: 'mint', icon: 'theatre' },
};

/** An accent hashed from any stable key: the same key is the same colour everywhere. */
export function hashAccent(key: string): AccentName {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return ACCENT_NAMES[Math.abs(hash) % ACCENT_NAMES.length] ?? 'sun';
}

/** The look of a category, by slug. */
export function categoryLook(slug: string): CategoryLook {
  return Object.hasOwn(SEEDED, slug)
    ? (SEEDED[slug] as CategoryLook)
    : { accent: hashAccent(slug), icon: 'other' };
}

/**
 * A campaign card's accent: its category's, or — for a campaign with no category, or an older
 * response without the field — one hashed from the campaign itself, so it still keeps one colour.
 */
export function campaignAccent(card: {
  readonly categorySlug?: string | null;
  readonly id?: string | null;
  readonly slug?: string | null;
}): AccentName {
  const category = card.categorySlug;
  if (category != null && category !== '') return categoryLook(category).accent;
  return hashAccent(card.id ?? card.slug ?? '');
}
