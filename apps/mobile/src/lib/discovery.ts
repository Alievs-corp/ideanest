import { useMemo } from 'react';
import { ApiError } from '@ideanest/api-client';
import { filterVocabularyCopyFrom, type FilterVocabularyCopy } from '@ideanest/discovery/copy';
import {
  parseFilters,
  searchParamsFrom,
  toSearchParams,
  type DiscoveryFilters,
  type RawParams,
} from '@ideanest/discovery/filters';
import { useT } from './i18n';

/**
 * The Discover screen's state, read from and written to its route — issue #153.
 *
 * <h2>The route params are the state</h2>
 *
 * The web keeps the feed's filters in its address bar, so a filtered feed is a link. The app
 * keeps them in the `discover` route's params, under the same names, so the same link opens the
 * same feed (`/discover?category=games&sort=ending_soon`) and nothing has a second copy to keep
 * in step. Parsing and writing are `@ideanest/discovery`'s; this module only maps them onto
 * Expo Router.
 *
 * <h2>Replace, never push</h2>
 *
 * The web pushes a history entry per filter, so browser Back walks back through them. On a phone
 * Back leaves the screen, and forty stacked Discover screens would be a trap — so a change is
 * `router.setParams`, which replaces the params of the screen in place.
 */

/** Every parameter the feed reads, in the service's spelling. */
export const DISCOVERY_PARAMS = [
  'q',
  'status',
  'category',
  'subcategory',
  'tag',
  'completion',
  'goalBand',
  'goalMin',
  'goalMax',
  'raisedBand',
  'raisedMin',
  'raisedMax',
  'sort',
] as const;

/** The filters a route's params ask for — the same reading a browser gives the same query. */
export function filtersFromParams(params: RawParams): DiscoveryFilters {
  return parseFilters(searchParamsFrom(params));
}

/**
 * The params to set for a filter set: every feed parameter, with the ones the set does not use
 * cleared. `setParams` merges, so a filter that is removed has to be written as `undefined` or it
 * would stay.
 */
export function routeParamsFor(filters: DiscoveryFilters): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  for (const name of DISCOVERY_PARAMS) next[name] = undefined;
  for (const [name, value] of toSearchParams(filters)) next[name] = value;
  return next;
}

/** The chips' and the sheet's words, from `discovery.filters` in the reader's language. */
export function useFilterVocabulary(): FilterVocabularyCopy {
  const t = useT('discovery.filters');
  return useMemo(() => filterVocabularyCopyFrom({ raw: (key) => t.raw(key as never) }), [t]);
}

/** What went wrong with a feed request, in the web's words (`DiscoveryView.describeProblem`). */
export interface FeedProblem {
  readonly title: string;
  readonly detail: string;
}

/**
 * The problem's own title and detail when the service sent one, with "refused" for a problem
 * that gives no reason. No problem body at all — no answer, or one that was not ours — reads as
 * "unreachable", exactly as the web decides it.
 */
export function useFeedProblem(error: unknown): FeedProblem {
  const t = useT('discovery.feed');
  const problem = error instanceof ApiError ? error.problem : null;
  if (problem === null) return { title: t('errorTitle'), detail: t('unreachable') };
  return {
    title: problem.title ?? t('errorTitle'),
    detail: problem.detail ?? t('refused'),
  };
}
