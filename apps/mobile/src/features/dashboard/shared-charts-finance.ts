import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';

/**
 * What the Funding and backers panel and the Finance panel (#163) both need from a read: which of
 * the dashboard's refusals it met, and which state a section draws. Their cache keys are in
 * `queryKeys`, under the unpersisted `dashboard` root: offline, a panel shows what it read earlier
 * in this session.
 */

/** The web's `messageFor`: 401, 403 and 404 have their own words; anything else is the service. */
export type PanelFailure = 'signedOut' | 'notGranted' | 'noCampaign' | 'unavailable';

export function panelFailureOf(error: unknown): PanelFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'signedOut';
    if (error.status === 403) return 'notGranted';
    if (error.status === 404) return 'noCampaign';
  }
  return 'unavailable';
}

/**
 * One read's state, in the order `Screen` gives them: data first (fresh, or stale with a notice),
 * then a failure, then loading. `unreachable` is a failure the phone caused — offline with nothing
 * read yet — which is worded as that rather than as the service's fault.
 */
export type SectionState<T> =
  | { readonly kind: 'ready'; readonly data: T; readonly stale: boolean }
  | { readonly kind: 'failed'; readonly failure: PanelFailure; readonly error: unknown }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'loading' };

export function sectionOf<T>(query: UseQueryResult<T>, online: boolean): SectionState<T> {
  if (query.data !== undefined) {
    return { kind: 'ready', data: query.data, stale: !online || query.isRefetchError };
  }
  if (query.fetchStatus === 'paused' || (!online && query.isError)) return { kind: 'unreachable' };
  if (query.isError) return { kind: 'failed', failure: panelFailureOf(query.error), error: query.error };
  return { kind: 'loading' };
}

/** Pull to refresh over several reads. The spinner stays until the last of them settles. */
export function usePullToRefresh(refetches: readonly (() => Promise<unknown>)[]) {
  const [refreshing, setRefreshing] = useState(false);
  return {
    refreshing,
    onRefresh: () => {
      setRefreshing(true);
      void Promise.allSettled(refetches.map((refetch) => refetch())).finally(() => setRefreshing(false));
    },
  };
}
