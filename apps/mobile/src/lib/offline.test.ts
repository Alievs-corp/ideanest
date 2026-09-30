import { ApiError } from '@ideanest/api-client';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSave } from '@tanstack/react-query-persist-client';
import { NoCredentialError, retryMe } from './account';
import { createQueryClient, persistOptions, shouldPersistQuery, shouldRetry } from './offline';
import { memoryStore } from './storage';
import { queryKeys } from '../api/queries';

/**
 * Issue #115: saved projects and pledges readable without a connection.
 *
 * <p>The two properties that make that true rather than nearly true are asserted here.
 * The first is that the right queries survive a restart and the wrong ones do not — a
 * restored discovery feed looks current and is not. The second is `offlineFirst`: without
 * it TanStack Query pauses a query when the device reports no connection, so a cached
 * campaign sits behind a spinner that never resolves, which is the exact failure #115
 * exists to prevent and the one that unit tests usually miss.
 */

describe('what survives a restart', () => {
  it('keeps what somebody saved and what they backed', () => {
    expect(shouldPersistQuery(queryKeys.saved())).toBe(true);
    expect(shouldPersistQuery(queryKeys.pledges())).toBe(true);
    expect(shouldPersistQuery(queryKeys.project('aysel', 'solar-lamp'))).toBe(true);
  });

  it('drops a feed, which is a ranking computed at a moment', () => {
    // Restoring last week's is worse than showing that the device is offline, because it
    // looks current.
    expect(shouldPersistQuery(queryKeys.discover({}))).toBe(false);
    expect(shouldPersistQuery(queryKeys.search({ q: 'lamp' }))).toBe(false);
    expect(shouldPersistQuery(queryKeys.suggestions('lam'))).toBe(false);
  });

  it('matches on the root of the key, so a paged variant is one decision', () => {
    // ['saved'] and ['saved', cursor] must not disagree; the second spelling silently
    // not being cached is a bug that only shows on a phone with no signal.
    expect(shouldPersistQuery(['saved', 'cursor-2'])).toBe(true);
  });

  it('answers false for a key that is not a string at the root', () => {
    expect(shouldPersistQuery([])).toBe(false);
    expect(shouldPersistQuery([{ nonsense: true }])).toBe(false);
  });
});

describe('the query client', () => {
  it('runs queries offline rather than pausing them', () => {
    // The default, `online`, is what makes a cached campaign sit behind a spinner that
    // never resolves. This one setting is the whole of #115 working at all.
    const options = createQueryClient().getDefaultOptions().queries;
    expect(options?.networkMode).toBe('offlineFirst');
  });

  it('keeps a cached answer for as long as the persisted copy is trusted', () => {
    // A gcTime shorter than maxAge would evict the restored data before its window
    // expires, which would look exactly like the cache not working.
    const options = createQueryClient().getDefaultOptions().queries;
    expect(options?.gcTime).toBe(persistOptions().maxAge);
  });

  it('retries twice online, and never offline, so a retry fails rather than pauses', () => {
    // Issue #150 tells `onlineManager` the truth. A retry decided on offline would then
    // pause, and a paused query with no cache renders as an empty list rather than an error.
    try {
      onlineManager.setOnline(true);
      expect([0, 1, 2].map((count) => shouldRetry(count))).toEqual([true, true, false]);

      onlineManager.setOnline(false);
      expect(shouldRetry(0)).toBe(false);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('never retries a 4xx other than a timeout or a rate limit', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetry(0, new ApiError(status))).toBe(false);
    }
    for (const status of [408, 429, 500, 502, 503]) {
      expect(shouldRetry(0, new ApiError(status))).toBe(true);
    }
    expect(shouldRetry(0, new TypeError('Network request failed'))).toBe(true);
  });

  it("the account read's own rule declines offline too, and after a missing credential", () => {
    try {
      onlineManager.setOnline(true);
      expect([0, 2, 3].map((count) => retryMe(count, new Error('5xx')))).toEqual([true, true, false]);
      expect(retryMe(0, new NoCredentialError())).toBe(false);

      onlineManager.setOnline(false);
      expect(retryMe(0, new Error('5xx'))).toBe(false);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it.each([
    ['the default rule', undefined],
    ["the account read's rule", retryMe],
  ] as const)('offline, a failing query with %s errors rather than pausing', async (_name, retry) => {
    const client = createQueryClient();
    try {
      onlineManager.setOnline(false);
      const settled = client
        .fetchQuery({
          queryKey: ['offline-probe'],
          queryFn: () => Promise.reject(new TypeError('Network request failed')),
          retryDelay: 0,
          ...(retry === undefined ? {} : { retry }),
        })
        .then(
          () => 'resolved',
          () => 'errored',
        );
      // A paused query never settles; this would time out instead.
      await expect(settled).resolves.toBe('errored');
      expect(client.getQueryState(['offline-probe'])?.fetchStatus).toBe('idle');
    } finally {
      onlineManager.setOnline(true);
      client.clear();
    }
  });

  it('fails a write offline rather than holding it for a connection', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.networkMode).toBe('offlineFirst');
  });
});

describe('the persisted cache', () => {
  /*
   * `persistQueryClientSave` and `persistQueryClientRestore` rather than
   * `persistQueryClient`. That one subscribes to the cache and writes when it changes,
   * so a test that sets data and then subscribes observes no change at all.
   *
   * The persister is also given a throttle of zero, and the save is still followed by a
   * turn of the event loop. The throttle is a `setTimeout`, so even at zero the write
   * lands on the next macrotask rather than on the line that asked for it — with the
   * production throttle it is a second away. A test that did not know this would read as
   * "persistence does not work" rather than as "the write has not happened yet", which is
   * the reason `WRITE_THROTTLE_MS` is a named parameter instead of a constant.
   */
  const written = () => new Promise((resolve) => setTimeout(resolve, 0));

  /*
   * Every client is cleared. `setQueryData` schedules that query's garbage collection —
   * five minutes by default, and a week under this application's own defaults — and a
   * pending timer of that length is what makes Jest report a worker that would not exit.
   */
  const clients: QueryClient[] = [];
  const client = () => {
    const created = new QueryClient();
    clients.push(created);
    return created;
  };
  afterEach(() => {
    clients.splice(0).forEach((created) => created.clear());
  });

  it('restores a saved list into a fresh client', async () => {
    const store = memoryStore();

    const writing = client();
    writing.setQueryData(queryKeys.saved(), { items: [{ projectId: 'p1', title: 'Solar Lamp' }] });
    await persistQueryClientSave({ queryClient: writing, ...persistOptions(store, 0) });
    await written();

    const reading = client();
    await persistQueryClientRestore({ queryClient: reading, ...persistOptions(store, 0) });

    expect(reading.getQueryData(queryKeys.saved())).toEqual({
      items: [{ projectId: 'p1', title: 'Solar Lamp' }],
    });
  });

  it('does not restore a discovery feed that was in the same client', async () => {
    const store = memoryStore();

    const writing = client();
    writing.setQueryData(queryKeys.saved(), { items: [] });
    writing.setQueryData(queryKeys.discover({}), { items: [{ id: 'c1' }] });
    await persistQueryClientSave({ queryClient: writing, ...persistOptions(store, 0) });
    await written();

    const reading = client();
    await persistQueryClientRestore({ queryClient: reading, ...persistOptions(store, 0) });

    // The saved list came back and the feed did not, from one persisted document.
    expect(reading.getQueryData(queryKeys.saved())).toEqual({ items: [] });
    expect(reading.getQueryData(queryKeys.discover({}))).toBeUndefined();
  });
});
