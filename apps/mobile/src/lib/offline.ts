import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { ApiError } from '@ideanest/api-client';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import type { Persister } from '@tanstack/react-query-persist-client';
import { deviceStore, type KeyValueStore } from './storage';

/**
 * Offline caching — issue #115. **Saved campaigns and pledges readable without a
 * connection.**
 *
 * <h2>Persisting the query cache rather than building a second one</h2>
 *
 * The alternative was a local database mirroring the API, written on every read
 * and queried by the screens. That is a second source of truth for every field
 * on a campaign, with its own migrations and its own staleness rules, and the
 * screens would have to decide which of the two they were rendering. Persisting
 * TanStack Query's own cache means the screens never know: `useQuery` answers
 * from the cache it already answers from, and the only difference offline is
 * that the background refetch fails.
 *
 * <h2>Synchronous, which is the whole reason MMKV is the store</h2>
 *
 * A persister backed by `AsyncStorage` restores after the first render, so the
 * first frame a backer sees on a plane is the empty state — and then it fills
 * in. MMKV reads on the calling thread, so the cache is already there.
 *
 * <h2>What is persisted, and what is deliberately not</h2>
 *
 * Only the queries #115 names: what somebody saved, what they backed, and the
 * campaigns behind those. Everything else — discovery feeds, search results,
 * suggestions — is dropped by {@link shouldPersistQuery}. A feed is a ranking
 * computed at a moment; restoring last week's is worse than showing that the
 * device is offline, because it looks current. Nothing personal beyond those two
 * lists is written either: this store is unencrypted (see `lib/storage.ts`), so
 * what goes in it is what a backer could screenshot anyway.
 */

/** The persisted cache's key. Versioned, so a shape change invalidates rather than crashes. */
const CACHE_KEY = 'ideanest.query-cache.v1';

/**
 * How long a restored cache may be believed.
 *
 * A week, because the thing being cached is a campaign a backer has already
 * chosen to keep — its title, its creator, and roughly where its funding got to.
 * A figure a week old shown as current would be wrong, which is why the screens
 * that render it say when it was last fetched rather than presenting it plain.
 */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The query keys whose data survives a restart.
 *
 * Matched on the first element of the key rather than the whole of it, so that
 * `['saved', cursor]` and `['saved']` are one decision. See the class comment
 * for why the discovery feed is not in this list.
 */
const PERSISTED_ROOTS: readonly string[] = ['saved', 'pledges', 'project'];

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return typeof root === 'string' && PERSISTED_ROOTS.includes(root);
}

/**
 * How long the persister waits before writing again.
 *
 * <p>The whole cache is serialised on every write, so an unthrottled persister rewrites
 * the document once per query that settles — which on a discovery screen is once per
 * scroll. A second is far shorter than the gap between a person's interactions and far
 * longer than a burst of them.
 *
 * <p>It is a parameter rather than a constant because it is also a trap in a test: the
 * throttle means a save requested and immediately read back has not happened, and a test
 * that did not know that would conclude the cache does not work.
 */
export const WRITE_THROTTLE_MS = 1_000;

/** A persister over any key/value store. The store is a parameter so a test can pass its own. */
export function createPersister(
  store: KeyValueStore = deviceStore,
  throttleTime: number = WRITE_THROTTLE_MS,
): Persister {
  return createSyncStoragePersister({
    key: CACHE_KEY,
    throttleTime,
    storage: {
      getItem: (key) => store.getString(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.remove(key),
    },
  });
}

/**
 * The application's query client.
 *
 * `networkMode: 'offlineFirst'` is the setting that makes #115 work at all.
 * TanStack Query's default pauses a query when the device reports no
 * connection, so a cached campaign would sit behind a spinner that never
 * resolves. `offlineFirst` runs the query, lets it fail, and leaves the restored
 * data on screen — which is what "readable without a connection" means.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        gcTime: MAX_CACHE_AGE_MS,
        staleTime: 60_000,
        /*
         * Two retries rather than three, and none of them on a 4xx. A phone on a
         * flaky connection benefits from a retry; a phone in a tunnel benefits
         * from being told, and the default backoff spends thirty seconds
         * discovering what the first failure already said.
         */
        retry: shouldRetry,
      },
      /*
       * The same mode for writes, and for the same reason. `lib/connectivity.ts`
       * tells `onlineManager` when the phone is offline, and a mutation in the
       * default `online` mode would then wait silently for a connection instead
       * of failing with the "check your connection" every form already says.
       */
      mutations: { networkMode: 'offlineFirst' },
    },
  });
}

/**
 * Whether a failed query is tried again — issue #150.
 *
 * <p>Twice, and never on a 4xx other than 408 (timeout) and 429 (rate limited):
 * the rest are the service's considered answer, and asking again gets the same
 * one. The rule the comment above always stated; the number it replaced retried
 * those too.
 *
 * <p>Never while the phone is offline. Since
 * `lib/connectivity.ts` wires `onlineManager`, a retry decided on while offline
 * would not fail — it would **pause** until the connection returned, and a paused
 * query with nothing cached is neither loading nor an error, so a screen would
 * fall through to its empty state ("Nothing saved yet") on a plane. Declining the
 * retry keeps today's behaviour: the query errors, the screen shows its error or
 * its cached data with its notice, and `refetchOnReconnect` — the thing the
 * wiring is for — fetches it again when the phone is back.
 */
export function shouldRetry(failureCount: number, error?: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    if (error.status !== 408 && error.status !== 429) return false;
  }
  return failureCount < 2 && onlineManager.isOnline();
}

/**
 * Erases the persisted cache from the device, now — issue #29.
 *
 * <h2>Why `queryClient.clear()` is not enough on its own</h2>
 *
 * Clearing the client empties memory and lets the persister write the emptied
 * cache back — after {@link WRITE_THROTTLE_MS}. Two of the three persisted roots
 * are private: `saved` and `pledges` are one account's, and leaving them on disk
 * for a second after a sign-out means an application killed inside that second
 * leaves them there for ever. So the document is removed directly as well, which
 * is synchronous because MMKV is.
 *
 * <p>Both are done rather than only this one: removing the file without clearing
 * the client would leave the data in memory, and the next settled query would
 * write it straight back.
 */
export function forgetPersistedCache(store: KeyValueStore = deviceStore): void {
  store.remove(CACHE_KEY);
}

/** What `PersistQueryClientProvider` is given. One place, so the screens cannot disagree. */
export function persistOptions(store?: KeyValueStore, throttleTime?: number) {
  return {
    persister: createPersister(store, throttleTime),
    maxAge: MAX_CACHE_AGE_MS,
    dehydrateOptions: {
      shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) =>
        query.state.status === 'success' && shouldPersistQuery(query.queryKey),
    },
  };
}
