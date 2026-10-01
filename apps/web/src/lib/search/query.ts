/**
 * The search route's query string — §4.13 WS-06.
 *
 * ONE PARAMETER NAME, WRITTEN AND READ IN ONE PLACE. It is `q`, because that is what
 * `GET /v1/search` calls it and what `@ideanest/discovery/filters` already writes into
 * `/discover`. The header writes this URL, the results page reads it, and the results page
 * hands the same word straight to the service — a second spelling anywhere in that chain is
 * a search box that silently searches for nothing.
 */

/** The service's own name for the free-text parameter (`DiscoveryQueryBinder`). */
export const SEARCH_QUERY_PARAM = 'q';

export const SEARCH_PATH = '/search';

/**
 * The results URL for a phrase.
 *
 * An empty or blank phrase produces a bare `/search`, never `/search?q=`. The two would be
 * the same page and different URLs, which is a duplicate for a crawler and a second history
 * entry for a reader who pressed Enter on an empty box.
 */
export function searchHref(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return SEARCH_PATH;

  const params = new URLSearchParams({ [SEARCH_QUERY_PARAM]: trimmed });
  return `${SEARCH_PATH}?${params.toString()}`;
}

/**
 * The phrase in a URL, trimmed, or the empty string.
 *
 * NEVER FOLDED. Folding is the service's (`ideanest_fold`), and a client that folded would
 * echo "secenek" back at somebody who typed "seç" — their own language spelled wrong at
 * them. `@ideanest/discovery/filters` states the same rule for the same parameter.
 *
 * A repeated `?q=a&q=b` takes the first. The service binds one value and the alternative —
 * joining them — would search for a phrase nobody typed.
 */
export function readSearchQuery(params: URLSearchParams): string {
  return (params.get(SEARCH_QUERY_PARAM) ?? '').trim();
}
