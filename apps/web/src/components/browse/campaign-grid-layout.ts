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
 * The home page's two desktop shapes — Kickstarter's front page, asked for by the owner. Below
 * `lg` both are exactly `CAMPAIGN_GRID`'s one and two columns, so a phone and a tablet draw
 * the page they always did.
 *
 * `HOME_SPLIT_GRID` is the right half of the first band: two columns from `sm` and still two
 * at `lg`, where the band gives it half the width beside the popular campaigns. Its rows are
 * equal from `lg`, as the two popular cards' are, so the two halves end their rows on one line.
 * `HOME_SPLIT_GRID_SPARSE` is the same half when it has too few campaigns to fill its rows: equal
 * rows would stretch one or two cards to the popular half's whole height, so each row keeps its
 * card's own height and the rows gather at the top.
 *
 * `HOME_RAIL` turns a grid into a row from `lg`: one line of cards that scrolls sideways under
 * the section's arrows, three across at `lg` and four at `xl` — the same widths
 * `CAMPAIGN_GRID` gives there, so `CAMPAIGN_CARD_SIZES` still describes every cover. The
 * vertical padding is room the row would otherwise cut off: an `overflow-x` container clips
 * the other axis too, so a hovered card's 4px lift would lose its top edge and the accent
 * glow under every card (`0 16px 32px -12px`, 36px deep) would end in a hard line. The
 * negative margins give the same room back, so the row sits where a grid would.
 */
export const HOME_SPLIT_GRID = 'grid w-full list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:auto-rows-fr';

export const HOME_SPLIT_GRID_SPARSE = 'grid w-full list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:content-start';

export const HOME_RAIL =
  'grid w-full list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:-mt-2 lg:-mb-10 lg:flex lg:snap-x lg:snap-mandatory lg:overflow-x-auto lg:pt-2 lg:pb-10 lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden';

export const HOME_RAIL_ITEM =
  'lg:w-[calc((100%-2rem)/3)] lg:shrink-0 lg:snap-start xl:w-[calc((100%-3rem)/4)]';

/**
 * A profile's created and backed lists, edge to edge in the profile page's narrower
 * `max-w-[1120px]` column. Three tracks rather than four: in that column a fourth would make
 * each card 256px, smaller than the card's interior was drawn for.
 */
export const PROFILE_CAMPAIGN_GRID =
  'grid w-full list-none grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
