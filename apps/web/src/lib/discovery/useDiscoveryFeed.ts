'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/problem';
import { getDiscoveryFeed, type DiscoveryFeed, type ProjectCard } from './api';
import { filterKey, type DiscoveryFilters } from '@ideanest/discovery/filters';
import type { FeedCopy } from '../i18n/feed-copy';
import type { Locale } from '../i18n/locale';
import { pluralise } from '../i18n/plurals';

/**
 * D-04's cursor-paginated feed, as a hook.
 *
 * WHY A CURSOR AND NOT AN OFFSET. `pledged_amount` moves continuously on a
 * funding platform, so a campaign promoted from the bottom of the order to the
 * top shifts every row below it — and under `OFFSET` the next page then returns
 * a card the reader has already seen. A keyset cursor shows a row that moves
 * once or not at all. The server's `DiscoveryApiTests` has the test that
 * justifies the design; this hook's job is not to undo it.
 *
 * THE END OF THE FEED IS AN ABSENT CURSOR, never a short page. A page that
 * comes back with fewer cards than were asked for is still followed by more
 * whenever `nextCursor` is present, and a client that stopped on a short page
 * would truncate a feed whose last page happened to be full.
 *
 * ONE REQUEST PER CURSOR, ENFORCED. A sentinel at the bottom of a grid crosses
 * the viewport repeatedly — a scroll that overshoots and settles, a window
 * resize, an image loading above it and pushing it back down — and every
 * crossing fires the observer again. Without the guard below the same page is
 * fetched three times and appended three times, which reads as duplicated
 * cards. Cursors that have been requested are remembered rather than merely
 * "am I loading right now", because the second crossing routinely arrives
 * between the response landing and React committing the state it produced.
 */

export type FeedStatus = 'loading' | 'ready' | 'failed';

export interface DiscoveryFeedState {
  readonly items: readonly ProjectCard[];
  /**
   * The FIRST page's outcome, and only that.
   *
   * A page that fails part-way down the scroll does not move this to `failed`,
   * because the cards already on screen are still true and blanking a feed
   * somebody is reading is a worse answer than saying the next page did not
   * arrive. That failure is reported through `error` while the status stays
   * `ready`.
   */
  readonly status: FeedStatus;
  /** The RFC 9457 problem the service answered with, for the caller to render. */
  readonly error: ApiError | null;
  /** True when there is another page. Absent `nextCursor` is the only signal. */
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  /** What to put in the polite live region. Empty until a page has settled. */
  readonly announcement: string;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/**
 * What the polite live region says once a first page has settled.
 *
 * One function because there are three places a first page can arrive from — a fetch, a
 * seeded render, and a seeded render that replaced a previous filter set — and three
 * spellings of the same sentence is three chances for a screen-reader user to be told
 * something slightly different about the same event.
 *
 * <p>The count goes through CLDR rather than a singular/plural split since #324. Russian has
 * three forms and picks between them by the last digit, and this is the sentence a
 * screen-reader user hears instead of seeing the grid.
 */
function firstPageAnnouncement(count: number, copy: FeedCopy, locale: Locale): string {
  return count === 0 ? copy.announceNone : pluralise(locale, copy.announceShown, count);
}

/**
 * The first page, as the server already rendered it — #119.
 *
 * The key is the point of the pair. `filterKey` is what this hook already uses to decide
 * whether a page it holds still answers the question being asked, and a seeded page carries
 * the key it was fetched for so the two can be compared. A page seeded under one filter set
 * and shown under another would be a feed that ignores the filters somebody just chose.
 */
export interface SeededFeed {
  readonly key: string;
  readonly feed: DiscoveryFeed;
}

/**
 * @param seeded the first page from the server render, when there is one. Absent in every
 *     client-only caller and in every test that is about the fetching rather than about the
 *     seeding, which is why it is optional rather than nullable.
 */
export function useDiscoveryFeed(
  filters: DiscoveryFilters,
  copy: FeedCopy,
  locale: Locale,
  seeded?: SeededFeed,
): DiscoveryFeedState {
  const key = filterKey(filters);

  /** The seeded page, but only when it answers the question currently being asked. */
  const seededHere = seeded !== undefined && seeded.key === key ? seeded.feed : null;

  const [items, setItems] = useState<readonly ProjectCard[]>(() => seededHere?.items ?? []);
  const [status, setStatus] = useState<FeedStatus>(() => (seededHere === null ? 'loading' : 'ready'));
  const [error, setError] = useState<ApiError | null>(null);
  const [cursor, setCursor] = useState<string | null>(() => seededHere?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  /*
   * Seeded as well as the cards, because the live region is how a screen-reader user learns
   * that the feed arrived — and with a server-rendered page it arrived before they got here.
   * Left empty, a seeded feed would be silent to exactly the reader who cannot see it.
   */
  const [announcement, setAnnouncement] = useState(() =>
    seededHere === null ? '' : firstPageAnnouncement(seededHere.items.length, copy, locale),
  );

  /**
   * The filter key whose first page came from the server rather than from a fetch.
   *
   * Read by the effect below, which is what stops the browser re-requesting a page that is
   * already in the HTML it was served. Without it #119 would put the feed in the markup and
   * then fetch it again a moment later — the render would be right and the request would be
   * pure waste, on the platform's busiest read.
   */
  const seededKey = useRef<string | null>(seededHere === null ? null : key);

  /**
   * Every cursor a request has already been sent for, including the sentinel
   * for the first page. Reset when the query changes, because a cursor issued
   * for one filter set is refused by another (`DISCOVERY_CURSOR_MISMATCH`) and
   * the pages held are no longer answers to the question being asked.
   */
  const requested = useRef<Set<string>>(new Set());

  /**
   * Bumped to re-run the first-page effect for the same filters — what "try
   * again" does after a failure. Without it a retry would have to fake a change
   * to the query, which would put a filter in the URL nobody chose.
   */
  const [attempt, setAttempt] = useState(0);

  /**
   * The filters `loadMore` will send, read through a ref.
   *
   * `filters` is rebuilt from the URL on every render, so closing over it
   * directly would give `loadMore` a new identity every time — and the
   * `IntersectionObserver` that calls it would be torn down and rebuilt on
   * every render with it. The value is the same value either way: the effect
   * above has already reset everything whenever the filters changed.
   */
  const latestFilters = useRef(filters);
  latestFilters.current = filters;

  /*
   * A NEW SEEDED PAGE ARRIVES AS A PROP, AND IS ADOPTED DURING RENDER.
   *
   * Changing a filter is `router.push` to the same route with a different query string,
   * which re-runs the Server Component and hands this hook a fresh first page for the new
   * key. Adopting it in an effect would mean one paint of the previous filter's cards
   * followed by a swap; adopting it here means the very first render under the new key
   * shows the right feed — which is React's documented way of deriving state from props
   * that changed, and it re-renders immediately rather than committing the stale one.
   *
   * The guard is the key, so this runs once per seeded page and not on every render.
   */
  if (seededHere !== null && seededKey.current !== key) {
    seededKey.current = key;
    requested.current = new Set(['']);
    setItems(seededHere.items);
    setCursor(seededHere.nextCursor ?? null);
    setStatus('ready');
    setError(null);
    setLoadingMore(false);
    setAnnouncement(firstPageAnnouncement(seededHere.items.length, copy, locale));
  }

  useEffect(() => {
    if (seededKey.current === key) {
      /*
       * The first page for this filter set is already on screen because the server put it
       * there. `requested` still has to carry the sentinel, so that `loadMore` cannot be
       * talked into re-fetching page one, and the abort below has nothing to abort.
       */
      requested.current = new Set(['']);
      return;
    }

    const controller = new AbortController();

    requested.current = new Set(['']);
    setItems([]);
    setStatus('loading');
    setError(null);
    setCursor(null);
    setLoadingMore(false);

    void (async () => {
      try {
        const page = await getDiscoveryFeed(latestFilters.current, { signal: controller.signal });
        if (controller.signal.aborted) return;

        setItems(page.items);
        setCursor(page.nextCursor ?? null);
        setStatus('ready');
        setAnnouncement(firstPageAnnouncement(page.items.length, copy, locale));
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        setStatus('failed');
        setError(cause instanceof ApiError ? cause : null);
        setAnnouncement('The projects could not be loaded.');
      }
    })();

    return () => controller.abort();
    /*
     * Keyed on the SERIALISED filters rather than the object. `filters` is
     * rebuilt on every render from the URL, so an object identity check would
     * refetch the first page on every keystroke anywhere on the page. The key
     * covers everything that decides which campaigns come back and in what
     * order — the same rule the server's own fingerprint follows.
     */
  }, [key, attempt]);

  const loadMore = useCallback(() => {
    const next = cursor;
    if (next === null || next === '') return;
    if (requested.current.has(next)) return;
    requested.current.add(next);

    setLoadingMore(true);
    setError(null);

    void (async () => {
      try {
        const page = await getDiscoveryFeed(latestFilters.current, { cursor: next });

        setItems((previous) => [...previous, ...page.items]);
        setCursor(page.nextCursor ?? null);
        setAnnouncement(pluralise(locale, copy.announceMore, page.items.length));
      } catch (cause) {
        if (wasAborted(cause)) return;

        /*
         * A failure part-way down does not throw away what is on screen. The
         * cards already read are still the truth; what failed is the next page,
         * and the recovery is to press the control again — so the cursor is
         * released from the requested set rather than left claimed by a request
         * that produced nothing.
         */
        requested.current.delete(next);
        setError(cause instanceof ApiError ? cause : null);
        setAnnouncement('The next page could not be loaded.');
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [cursor]);

  const retry = useCallback(() => {
    /*
     * The seed is released first, and it has to be. A seeded page that failed on the server
     * arrives as no seed at all — but a seeded page that succeeded and was then followed by
     * a failed "show more" leaves `seededKey` set, and without this the effect would take
     * the early return and "try again" would do nothing at all. Releasing it makes retry
     * mean what it says: fetch page one again, from the browser.
     */
    seededKey.current = null;
    setAttempt((n) => n + 1);
  }, []);

  return useMemo(
    () => ({
      items,
      status,
      error,
      hasMore: cursor !== null && cursor !== '',
      loadingMore,
      announcement,
      loadMore,
      retry,
    }),
    [items, status, error, cursor, loadingMore, announcement, loadMore, retry],
  );
}
