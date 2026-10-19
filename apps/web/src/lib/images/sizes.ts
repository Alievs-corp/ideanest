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
 * `CAMPAIGN_GRID` in `components/browse/campaign-grid-layout.ts`: the whole column,
 * `grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`. Tailwind's `sm` is 640px,
 * `lg` 1024px and `xl` 1280px, `gap-4` is 16px, `px-5` is 20px a side and `px-6` is 24.
 *
 *   ≥1400: the container stops growing — (1352 − 48) / 4 = 326px
 *   ≥1280: four columns       — (100vw − 48 − 48) / 4 = 25vw − 24
 *   ≥1024: three columns      — (100vw − 48 − 32) / 3 = (100vw − 80) / 3
 *    ≥640: two columns        — (100vw − 48 − 16) / 2 = 50vw − 32
 *    else: one column         —  100vw − 40
 *
 * The widest this asks for is a two-column card at 1023px, 479.5 CSS pixels, so a 3× display
 * wants 1439; nothing on this surface has any use for the 2048 and 3840 candidates Next offers
 * by default, which is why `next.config.mjs` stops at 1440.
 */
export const CAMPAIGN_CARD_SIZES = sizesFor([
  { minWidth: 1400, size: '326px' },
  { minWidth: 1280, size: 'calc(25vw - 24px)' },
  { minWidth: 1024, size: 'calc((100vw - 80px) / 3)' },
  { minWidth: 640, size: 'calc(50vw - 32px)' },
  { size: 'calc(100vw - 40px)' },
]);

/**
 * The home page's featured campaign — the left half of its first band from `lg` (1024px).
 *
 * Two equal columns with a 40px gap inside the 1400px `px-6` column; below `lg` the card is
 * not drawn at all, so the smallest stop is never downloaded (the cover is lazy, and a lazy
 * image under `display: none` is not fetched).
 *
 *   ≥1400: the container stops growing — (1352 − 40) / 2 = 656px
 *   ≥1024: two columns        — (100vw − 48 − 40) / 2 = 50vw − 44px
 */
export const FEATURED_CARD_SIZES = sizesFor([
  { minWidth: 1400, size: '656px' },
  { minWidth: 1024, size: 'calc(50vw - 44px)' },
  { size: 'calc(100vw - 40px)' },
]);

/**
 * A campaign card's cover on a profile — `ProfileCampaignCard`, in `PROFILE_CAMPAIGN_GRID`.
 *
 * The whole of the profile page's `mx-auto w-full max-w-[1120px] px-5 sm:px-6` column, with
 * the third column arriving at `lg` (1024px) and no fourth.
 *
 *   ≥1168: the container stops growing — (1072 − 32) / 3 = 346.7, so 347px
 *   ≥1024: three columns      — (100vw − 48 − 32) / 3 = (100vw − 80) / 3
 *    ≥640: two columns        — 50vw − 32
 *    else: one column         — 100vw − 40
 */
export const PROFILE_CARD_SIZES = sizesFor([
  { minWidth: 1168, size: '347px' },
  { minWidth: 1024, size: 'calc((100vw - 80px) / 3)' },
  { minWidth: 640, size: 'calc(50vw - 32px)' },
  { size: 'calc(100vw - 40px)' },
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
