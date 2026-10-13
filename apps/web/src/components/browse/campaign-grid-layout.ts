/**
 * The grids campaign cards are laid out in — one string per grid, read by every list that
 * draws `ProjectCard` or `ProfileCampaignCard` and by its loading skeleton.
 *
 * <h2>Edge to edge, four across</h2>
 *
 * The grid fills the content column, so the first card lines up with the heading and the last
 * with the column's right edge — the cards are spread between the edges rather than gathered in
 * the middle. That replaces #368's `max-w-[85%]` and #374's `mx-auto`, which made the cards
 * smaller by narrowing the grid and then left a strip of empty page either side of it. The owner
 * asked for the spread and for four columns.
 *
 * Four tracks at `xl` keep the cards small without narrowing anything: at 1400px a card is
 * (1352 − 48) / 4 = 326px, smaller than the 373px #368 settled on. Between two columns and four
 * there is a third at `lg`, so a 1024–1279px window does not get two cards wider than any other
 * width ever shows. Same `gap-4` throughout (docs/ui-kit.md §6.2).
 *
 * Tailwind reads these classes from this file, so they are written out whole rather than
 * assembled. `lib/images/sizes.ts` derives each card's `sizes` from them — change one and
 * change the other, or the covers are downloaded at the wrong width.
 */

/** Discovery feed, home page, category landing, search results, collection campaigns. */
export const CAMPAIGN_GRID =
  'grid w-full list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/**
 * A profile's created and backed lists, edge to edge in the profile page's narrower
 * `max-w-[1120px]` column. Three tracks rather than four: in that column a fourth would make
 * each card 256px, smaller than the card's interior was drawn for.
 */
export const PROFILE_CAMPAIGN_GRID =
  'grid w-full list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
