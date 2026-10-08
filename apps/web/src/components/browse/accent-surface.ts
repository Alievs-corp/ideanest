import type { AccentName } from '@ideanest/discovery/category-look';

/**
 * The accent surfaces as Tailwind classes (#335), apart from the category icons so the campaign
 * card — which draws no icon of its category — does not carry eleven pictograms into the feed's
 * client bundle.
 *
 * The class strings are written out whole so Tailwind can find them; a class assembled from the
 * accent's name at runtime would never be generated.
 */

/** The accent as a surface, with the soft same-hue glow under it — the token's own `glow`. */
export const ACCENT_SURFACE: Readonly<Record<AccentName, string>> = {
  sun: 'bg-accent-sun shadow-[0_16px_32px_-12px_var(--accent-sun-glow)]',
  mint: 'bg-accent-mint shadow-[0_16px_32px_-12px_var(--accent-mint-glow)]',
  sky: 'bg-accent-sky shadow-[0_16px_32px_-12px_var(--accent-sky-glow)]',
};

/** The accent alone, for a badge too small to carry a glow. */
export const ACCENT_FILL: Readonly<Record<AccentName, string>> = {
  sun: 'bg-accent-sun',
  mint: 'bg-accent-mint',
  sky: 'bg-accent-sky',
};
