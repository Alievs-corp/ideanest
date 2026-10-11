/**
 * The `sizes` attribute, derived from the layout rather than guessed.
 *
 * WHY THIS FILE EXISTS AT ALL. `sizes` is the only thing that tells the browser
 * how wide the image will be laid out, and it has to be decided before any
 * layout has happened. Get it wrong upwards and every visitor downloads a
 * picture four times larger than the box it lands in; get it wrong downwards
 * and the picture is upscaled and looks it. It is also the single easiest thing
 * in a codebase to leave stale: the grid gains a breakpoint, and the string in
 * some component two directories away still describes the old one.
 *
 * So each stop is written next to the Tailwind classes it mirrors, in one file,
 * and `sizesFor` refuses to build a string whose stops are in an order the
 * browser would not read the way the author intended.
 *
 * HOW THE BROWSER READS IT. `sizes` is a list of `(media condition) length`
 * pairs and the FIRST match wins — not the most specific. A list written
 * smallest-first therefore matches `(min-width: 640px)` on a 1400px viewport
 * and the last three entries are dead. `sizesFor` enforces descending order for
 * that reason, and the check is a test rather than a comment.
 */

export interface SizeStop {
  /**
   * The breakpoint this stop applies from, in CSS pixels. Omitted on the final
   * stop, which is the fallback every narrower viewport gets.
   */
  readonly minWidth?: number;
  /** How wide the image is laid out at that width — any CSS length. */
  readonly size: string;
}

/**
 * Builds a `sizes` attribute from stops written widest-first.
 *
 * Throws rather than returning something plausible. A malformed `sizes` costs
 * bandwidth on every request that follows and is invisible in review, so it is
 * worth failing the build for.
 */
export function sizesFor(stops: readonly SizeStop[]): string {
  if (stops.length === 0) {
    throw new Error('sizesFor needs at least the fallback stop.');
  }

  const last = stops[stops.length - 1];
  if (last === undefined || last.minWidth !== undefined) {
    throw new Error(
      'The last stop is the fallback and must not carry a minWidth, or viewports ' +
        'below the narrowest breakpoint get no size at all.',
    );
  }

  let previous = Number.POSITIVE_INFINITY;
  for (const stop of stops.slice(0, -1)) {
    if (stop.minWidth === undefined) {
      throw new Error('Only the last stop may omit minWidth.');
    }
    if (stop.minWidth >= previous) {
      throw new Error(
        `Stops must descend: ${stop.minWidth}px follows ${previous}px. The browser ` +
          'takes the first matching condition, so a stop after a wider one is dead.',
      );
    }
    previous = stop.minWidth;
  }

  return stops
    .map((stop) =>
      stop.minWidth === undefined ? stop.size : `(min-width: ${stop.minWidth}px) ${stop.size}`,
    )
    .join(', ');
}

/**
 * A campaign card's cover — `ProjectCard`, on the discovery feed, the home page, the
 * category landings, the search results and a collection's campaigns.
 *
 * Every one of those pages is `mx-auto w-full max-w-[1400px] px-5 sm:px-6`, and the grid is
 * `CAMPAIGN_GRID` in `components/browse/campaign-grid-layout.ts`: `max-w-[85%]` of that
 * column, `grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3` (#368). Tailwind's `sm` is 640px
 * and `xl` is 1280px, `gap-4` is 16px, `px-5` is 20px a side and `px-6` is 24.
 *
 *   ≥1400: the container stops growing — (0.85 × 1352 − 32) / 3 = 372.4, so 373px
 *   ≥1280: three columns      — (0.85 × (100vw − 48) − 32) / 3 = (85vw − 72.8) / 3
 *    ≥640: two columns        — (0.85 × (100vw − 48) − 16) / 2 = 42.5vw − 28.4
 *    else: one column         —  0.85 × (100vw − 40)           = 85vw − 34
 *
 * The constants are rounded towards the larger box, so a cover is never upscaled. The widest
 * this ever asks for is 373 CSS pixels, so a 3× display wants 1119; nothing on this surface
 * has any use for the 2048 and 3840 candidates Next offers by default, which is why
 * `next.config.mjs` stops at 1440.
 */
export const CAMPAIGN_CARD_SIZES = sizesFor([
  { minWidth: 1400, size: '373px' },
  { minWidth: 1280, size: 'calc((85vw - 72px) / 3)' },
  { minWidth: 640, size: 'calc(42.5vw - 28px)' },
  { size: 'calc(85vw - 34px)' },
]);

/**
 * A campaign card's cover on a profile — `ProfileCampaignCard`, in `PROFILE_CAMPAIGN_GRID`.
 *
 * The same 85% grid inside the profile page's `mx-auto w-full max-w-[1120px] px-5 sm:px-6`,
 * with the third column arriving at `lg` (1024px) rather than `xl`.
 *
 *   ≥1168: the container stops growing — (0.85 × 1072 − 32) / 3 = 293.1, so 294px
 *   ≥1024: three columns      — (85vw − 72.8) / 3
 *    ≥640: two columns        — 42.5vw − 28.4
 *    else: one column         — 85vw − 34
 */
export const PROFILE_CARD_SIZES = sizesFor([
  { minWidth: 1168, size: '294px' },
  { minWidth: 1024, size: 'calc((85vw - 72px) / 3)' },
  { minWidth: 640, size: 'calc(42.5vw - 28px)' },
  { size: 'calc(85vw - 34px)' },
]);

/**
 * A collection's card on the collection index — `CollectionCard`, in `CollectionIndex`.
 *
 * Not a campaign card, and not shrunk with them: this grid is the full width of the
 * `max-w-[1400px] px-5 sm:px-6` column, `grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3`.
 *
 *   ≥1400: the container stops growing — (1400 − 48 − 32) / 3 = 440px
 *   ≥1280: three columns      — (100vw − 48 − 32) / 3
 *    ≥640: two columns        — (100vw − 48 − 16) / 2
 *    else: one column         —  100vw − 40
 */
export const COLLECTION_CARD_SIZES = sizesFor([
  { minWidth: 1400, size: '440px' },
  { minWidth: 1280, size: 'calc((100vw - 80px) / 3)' },
  { minWidth: 640, size: 'calc(50vw - 32px)' },
  { size: 'calc(100vw - 40px)' },
]);

/**
 * The prelaunch page's cover, the largest contentful paint on that route.
 *
 * `PrelaunchView`: `mx-auto w-full max-w-[720px] px-5 sm:px-6`. The column stops
 * growing once the viewport can hold 720 + 48 = 768px.
 */
export const PRELAUNCH_COVER_SIZES = sizesFor([
  { minWidth: 768, size: '720px' },
  { minWidth: 640, size: 'calc(100vw - 48px)' },
  { size: 'calc(100vw - 40px)' },
]);

/**
 * A collection's cover on its own landing page — D-08, §4.13 WS-04.
 *
 * `CollectionHeader`: the page is `mx-auto w-full max-w-[1400px] px-5 sm:px-6`, and the header
 * is `lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-10`. Tailwind's `lg` is 1024px, so
 * the cover column is 560 CSS pixels at every width the two-column layout applies at — the
 * `1fr` track absorbs everything the `minmax` does not take — and below it the cover is the
 * full content width.
 *
 *   ≥1024: the right-hand column — 560px
 *    ≥640: one column, `px-6`    — 100vw − 48
 *    else: one column, `px-5`    — 100vw − 40
 *
 * THE INDEX'S CARDS ARE NOT HERE. `CollectionCard` sits in a full-width three-column grid on
 * the index page and takes `COLLECTION_CARD_SIZES`, above.
 */
export const COLLECTION_COVER_SIZES = sizesFor([
  { minWidth: 1024, size: '560px' },
  { minWidth: 640, size: 'calc(100vw - 48px)' },
  { size: 'calc(100vw - 40px)' },
]);

/*
 * THERE IS NO EDITOR ENTRY, deliberately. The campaign editor's previews render
 * a plain `<img>` rather than `next/image` — `CoverImageField` says why — so
 * they have no `sizes` to derive. A constant here for a surface that never
 * reads it is a constant that stops matching that surface's layout without
 * anybody noticing.
 */
