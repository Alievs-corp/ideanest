import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '../i18n/locale';
import {
  fetchCampaignPage,
  fetchCollection,
  fetchCollections,
  fetchDiscoveryFeed,
  fetchLegalDocument,
  fetchPublicRewards,
} from './server';

/**
 * The reads a Server Component makes — #119.
 *
 * What is worth asserting here is the wiring, because none of it fails loudly:
 *
 *   - **an absolute URL.** `lib/api/client.ts` uses a relative `/v1` path, which works in a
 *     browser because `next.config.mjs` rewrites it and throws on a server, where there is
 *     no origin and no rewrite. Getting this wrong is a page that works in every test and
 *     500s in production;
 *   - **a refusal is `null`, a bug is not.** A 404 must render a 404 and a misconfigured
 *     base URL must not be swallowed into "this campaign does not exist";
 *   - **the filters reach the service under its own parameter names**, repeated where they
 *     were repeated — a comma-joined list is one filter whose name contains a comma.
 */

const ENV = { IDEANEST_API_ORIGIN: 'https://api.test' };

function ok(body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
}

function refuses(status: number) {
  return (async () =>
    new Response(JSON.stringify({ code: 'PROJECT_NOT_FOUND' }), {
      status,
      headers: { 'content-type': 'application/problem+json' },
    })) as unknown as typeof fetch;
}

describe('the campaign read', () => {
  it('addresses the service directly, by both slugs', async () => {
    const { calls, fetchImpl } = ok({ id: 'p1' });

    await fetchCampaignPage('ayan', 'coffee-table-book', { env: ENV, fetchImpl });

    expect(calls[0]?.url).toBe('https://api.test/v1/projects/ayan/coffee-table-book');
  });

  it('asks for the reader’s language', async () => {
    const { calls, fetchImpl } = ok({ id: 'p1' });

    await fetchCampaignPage('ayan', 'book', { env: ENV, fetchImpl, locale: 'az' });

    expect(new Headers(calls[0]?.init?.headers).get('accept-language')).toBe('az');
  });

  /**
   * #324. This read used to send no `Accept-Language` at all unless a caller passed one, and
   * the reason was real while it lasted: negotiating meant reading a cookie, and a cookie
   * makes a cached public render dynamic. #123 put the language in the path, so the header is
   * now a constant per cache entry rather than a `Vary` — and the four data surfaces the
   * service already translates finally follow the page they are rendered on.
   *
   * Outside a request there is no page and no language, which is what this asserts: the
   * sitemap and these tests fall back to the platform default rather than throwing.
   */
  it('states a language even with no request to read one from', async () => {
    const { calls, fetchImpl } = ok({ id: 'p1' });

    await fetchCampaignPage('ayan', 'book', { env: ENV, fetchImpl });

    expect(new Headers(calls[0]?.init?.headers).get('accept-language')).toBe(DEFAULT_LOCALE);
  });

  /**
   * The service puts sixty seconds on its own `Cache-Control`. Holding a different opinion
   * here would mean two caches disagreeing about the same bytes, with the tighter one
   * winning by accident.
   */
  it('holds the response for as long as the service says it may', async () => {
    const { calls, fetchImpl } = ok({ id: 'p1' });

    await fetchCampaignPage('ayan', 'book', { env: ENV, fetchImpl });

    expect((calls[0]?.init as { next?: { revalidate?: number } }).next?.revalidate).toBe(60);
  });

  it('is null for a campaign the service will not serve', async () => {
    const page = await fetchCampaignPage('ayan', 'gone', { env: ENV, fetchImpl: refuses(404) });

    expect(page).toBeNull();
  });

  it('is null when the service cannot be reached at all', async () => {
    const unreachable = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    expect(await fetchCampaignPage('ayan', 'book', { env: ENV, fetchImpl: unreachable })).toBeNull();
  });

  /**
   * A bug is not a refusal. Swallowing this would turn a misconfigured deployment into a
   * site where every campaign has quietly stopped existing — which nobody notices in
   * staging and everybody notices in production.
   */
  it('lets a programming error surface rather than answering null', async () => {
    const broken = (async () => {
      throw new RangeError('somebody wrote a bug');
    }) as unknown as typeof fetch;

    await expect(fetchCampaignPage('ayan', 'book', { env: ENV, fetchImpl: broken })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('the reward read', () => {
  it('asks by campaign identifier, on the public path', async () => {
    const { calls, fetchImpl } = ok({ currency: 'AZN', rewards: [] });

    await fetchPublicRewards('0193f2a1', { env: ENV, fetchImpl });

    expect(calls[0]?.url).toBe('https://api.test/v1/projects/0193f2a1/rewards/public');
  });

  /**
   * `null` rather than an empty list. An empty list is a campaign offering nothing, which is
   * a real and different thing, and a page that could not tell them apart would print "no
   * rewards" over a service that was merely restarting.
   */
  it('is null when the read failed, not an empty list', async () => {
    expect(await fetchPublicRewards('p1', { env: ENV, fetchImpl: refuses(503) })).toBeNull();
  });
});

describe('the discovery read', () => {
  it('sends the filters under the service’s own parameter names', async () => {
    const { calls, fetchImpl } = ok({ items: [] });

    await fetchDiscoveryFeed('status=live&limit=24', { env: ENV, fetchImpl });

    const url = new URL(calls[0]?.url as string);
    expect(url.origin + url.pathname).toBe('https://api.test/v1/discover');
    expect(url.searchParams.get('status')).toBe('live');
    expect(url.searchParams.get('limit')).toBe('24');
  });

  /**
   * `?tag=a&tag=b` is two tags to `DiscoveryQueryBinder`; `?tag=a,b` is one tag whose name
   * contains a comma. A round trip through an object has to preserve the difference.
   */
  it('keeps a repeated filter repeated', async () => {
    const { calls, fetchImpl } = ok({ items: [] });

    await fetchDiscoveryFeed('tag=ceramics&tag=design', { env: ENV, fetchImpl });

    expect(new URL(calls[0]?.url as string).searchParams.getAll('tag')).toEqual([
      'ceramics',
      'design',
    ]);
  });

  it('asks for the unfiltered feed when there are no filters', async () => {
    const { calls, fetchImpl } = ok({ items: [] });

    await fetchDiscoveryFeed('', { env: ENV, fetchImpl });

    expect(calls[0]?.url).toBe('https://api.test/v1/discover');
  });

  it('is null when the service refuses, so the page falls back to fetching in the browser', async () => {
    expect(await fetchDiscoveryFeed('', { env: ENV, fetchImpl: refuses(429) })).toBeNull();
  });
});

describe('the collections reads', () => {
  it('asks the service directly for the index', async () => {
    const { calls, fetchImpl } = ok({ items: [] });

    await fetchCollections({ env: ENV, fetchImpl });

    expect(calls[0]?.url).toBe('https://api.test/v1/collections');
  });

  /**
   * A collection with no slug has no URL, so a card for it would be a link to nowhere in the
   * site's own crawl path — and this index is the only path a crawler has to a collection
   * page. `lib/collections/api.ts` owns the decision; this asserts the reader goes through it
   * rather than casting the generated type wholesale.
   */
  it('drops a row it could not render, and keeps the rest in order', async () => {
    const { fetchImpl } = ok({
      items: [
        { slug: 'staff-picks', title: 'Staff picks', kind: 'staff_selection' },
        { title: 'No slug' },
        { slug: 'spring-2026', title: 'Spring 2026', kind: 'open_call' },
      ],
    });

    const collections = await fetchCollections({ env: ENV, fetchImpl });

    expect(collections?.map((collection) => collection.slug)).toEqual([
      'staff-picks',
      'spring-2026',
    ]);
  });

  it('holds the index for as long as the service says it may', async () => {
    const { calls, fetchImpl } = ok({ items: [] });

    await fetchCollections({ env: ENV, fetchImpl });

    expect((calls[0]?.init as { next?: { revalidate?: number } }).next?.revalidate).toBe(60);
  });

  it('is null when the index could not be read', async () => {
    expect(await fetchCollections({ env: ENV, fetchImpl: refuses(503) })).toBeNull();
  });

  it('asks for one collection by slug, with the paging parameters the service names', async () => {
    const { calls, fetchImpl } = ok({
      collection: { slug: 'spring-2026', title: 'Spring 2026', kind: 'open_call' },
      items: [],
    });

    await fetchCollection('spring-2026', { cursor: 'abc', limit: 24 }, { env: ENV, fetchImpl });

    const url = new URL(calls[0]?.url as string);
    expect(url.origin + url.pathname).toBe('https://api.test/v1/collections/spring-2026');
    expect(url.searchParams.get('cursor')).toBe('abc');
    expect(url.searchParams.get('limit')).toBe('24');
  });

  /**
   * A slug that names nothing, a collection that has not been published, and one outside its
   * window are one answer on the wire and stay one answer here — `CollectionController`
   * explains that a 403 would confirm to anybody who guesses a slug that the platform is
   * preparing something under it, and a client that told them apart would leak from the
   * browser what the service refused to leak.
   */
  it('is null for a collection the service will not serve', async () => {
    expect(
      await fetchCollection('spring-2027', {}, { env: ENV, fetchImpl: refuses(404) }),
    ).toBeNull();
  });

  it('is null for a 200 carrying no usable collection, rather than an empty page', async () => {
    const { fetchImpl } = ok({ items: [] });

    expect(await fetchCollection('spring-2026', {}, { env: ENV, fetchImpl })).toBeNull();
  });

  it('carries the cursor, because a short page is not the end of a collection', async () => {
    const { fetchImpl } = ok({
      collection: { slug: 'spring-2026', title: 'Spring 2026', kind: 'open_call' },
      items: [],
      nextCursor: 'abc',
    });

    const landing = await fetchCollection('spring-2026', {}, { env: ENV, fetchImpl });

    expect(landing?.nextCursor).toBe('abc');
  });
});

/**
 * The checkout's backer-agreement read — issue #147.
 *
 * It had the legal pages' defect in the other place it can do harm: every refusal and every
 * network failure was one `null`, and `null` meant "no agreement in force". During an outage the
 * checkout drew no risk statement and offered a confirmation the service refuses once an
 * agreement is in force. The three answers are pinned here; the page's use of them is pinned in
 * `back/page.test.tsx`.
 */
describe('the backer agreement read', () => {
  const AGREEMENT = {
    kind: 'BACKER_AGREEMENT',
    locale: 'en',
    version: 2,
    title: 'Backer agreement',
    body: 'Text.',
    contentHash: 'b'.repeat(64),
  };

  it('is published, with its version, when the service answers with one', async () => {
    const { calls, fetchImpl } = ok(AGREEMENT);

    const read = await fetchLegalDocument('BACKER_AGREEMENT', { env: ENV, fetchImpl });

    expect(read.state).toBe('published');
    expect(read.state === 'published' ? read.document.version : null).toBe(2);
    expect(calls[0]?.url).toBe('https://api.test/v1/legal/documents/BACKER_AGREEMENT');
  });

  it('is unpublished on a 404', async () => {
    expect(await fetchLegalDocument('BACKER_AGREEMENT', { env: ENV, fetchImpl: refuses(404) })).toEqual({
      state: 'unpublished',
    });
  });

  it.each([403, 500, 502, 503])('is unavailable, not unpublished, on a %i', async (status) => {
    expect(
      await fetchLegalDocument('BACKER_AGREEMENT', { env: ENV, fetchImpl: refuses(status) }),
    ).toEqual({ state: 'unavailable' });
  });

  it.each([
    ['a network failure', new TypeError('fetch failed')],
    ['a timeout', new DOMException('The operation timed out.', 'TimeoutError')],
    ['an aborted request', new DOMException('This operation was aborted', 'AbortError')],
  ])('is unavailable on %s', async (_, cause) => {
    const fetchImpl = (async () => {
      throw cause;
    }) as unknown as typeof fetch;

    expect(await fetchLegalDocument('BACKER_AGREEMENT', { env: ENV, fetchImpl })).toEqual({
      state: 'unavailable',
    });
  });

  it('still rethrows a bug rather than calling it an outage', async () => {
    const fetchImpl = (async () => {
      throw new RangeError('a programming error');
    }) as unknown as typeof fetch;

    await expect(fetchLegalDocument('BACKER_AGREEMENT', { env: ENV, fetchImpl })).rejects.toThrow(
      RangeError,
    );
  });
});
