/**
 * The grids campaign cards are laid out in — one string per grid, read by every list that
 * draws `ProjectCard` or `ProfileCampaignCard` and by its loading skeleton.
 *
 * <h2>Why the grid is 85% of the column (#368)</h2>
 *
 * The owner asked for campaign cards 15% smaller at every screen size. A card fills its grid
 * track, and the track fills the content column, so at a given viewport a card's width is
 * fixed by the column count and the column's width. Changing the count cannot give 85%: one
 * column more turns three into four and makes every card 75% of what it was, two into three
 * makes it 67%, and the phone has a single column with nowhere to go. A `scale` or `zoom`
 * would shrink the pixels and leave the box, the hit target and the layout as they were.
 *
 * So the grid itself is 85% of the column — `max-w-[85%]` — with the same tracks and the same
 * `gap-4` (docs/ui-kit.md §6.2). Each card comes out at (0.85·W − gaps) / n, within half a
 * percent of 0.85 of the old (W − gaps) / n at every breakpoint. On a phone the lone column
 * is centred, because a single card hanging off the left edge reads as a mistake; from `sm`
 * up the grid starts on the same line as the heading above it, and the space it gives up is
 * on the right.
 *
 * Tailwind reads these classes from this file, so they are written out whole rather than
 * assembled. `lib/images/sizes.ts` derives each card's `sizes` from them — change one and
 * change the other, or the covers are downloaded at the wrong width.
 */

/** Discovery feed, home page, category landing, search results, collection campaigns. */
export const CAMPAIGN_GRID =
  'mx-auto grid w-full max-w-[85%] list-none grid-cols-1 gap-4 sm:mx-0 sm:grid-cols-2 xl:grid-cols-3';

/**
 * A profile's created and backed lists. The same 85%, inside the profile page's narrower
 * `max-w-[1120px]` column, where the third track arrives at `lg` rather than `xl`.
 */
export const PROFILE_CAMPAIGN_GRID =
  'mx-auto grid w-full max-w-[85%] list-none grid-cols-1 gap-4 sm:mx-0 sm:grid-cols-2 lg:grid-cols-3';
