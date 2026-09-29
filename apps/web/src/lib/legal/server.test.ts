import { describe, expect, it } from 'vitest';
import { fetchArchivedLegalDocument, fetchLegalCatalogue, fetchLegalDocument } from './server';

/**
 * The legal reads' three answers — issue #147.
 *
 * <p>The defect: every non-OK status and every thrown error came back as `null`, and the pages
 * draw `null` as "this document has not been published yet". A 503, a timeout or a DNS failure
 * therefore told a reader that IdeaNest had no terms of use. Only the service's 404 means that,
 * and these tests pin the line between the two where it is drawn.
 */

const ENV = { IDEANEST_API_ORIGIN: 'https://api.test' };

const DOCUMENT = {
  kind: 'TERMS_OF_USE',
  locale: 'en',
  version: 3,
  title: 'Terms of use',
  body: 'First paragraph.\n\nSecond paragraph.',
  contentHash: 'a'.repeat(64),
  effectiveFrom: '2026-03-01T00:00:00Z',
  publishedAt: '2026-02-20T10:00:00Z',
};

function answering(status: number, body: unknown = { code: 'X' }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
}

function throwing(cause: unknown) {
  return (async () => {
    throw cause;
  }) as unknown as typeof fetch;
}

/** What each way of failing looks like from `fetch`. */
const FAILURES: ReadonlyArray<readonly [string, typeof fetch]> = [
  ['a 500', answering(500).fetchImpl],
  ['a 502', answering(502).fetchImpl],
  ['a 503', answering(503).fetchImpl],
  ['a 403 from something in front of the service', answering(403).fetchImpl],
  ['a network failure', throwing(new TypeError('fetch failed'))],
  ['a DNS failure', throwing(new TypeError('getaddrinfo ENOTFOUND api.test'))],
  ['a timeout', throwing(new DOMException('The operation timed out.', 'TimeoutError'))],
  ['an aborted request', throwing(new DOMException('This operation was aborted', 'AbortError'))],
  ['a 200 whose body does not narrow', answering(200, { kind: 'TERMS_OF_USE' }).fetchImpl],
];

describe('the current version of a document', () => {
  it('is published when the service answers with one', async () => {
    const { calls, fetchImpl } = answering(200, DOCUMENT);

    const read = await fetchLegalDocument('terms-of-use', 'en', { env: ENV, fetchImpl });

    expect(read).toEqual({ state: 'published', document: DOCUMENT });
    expect(calls[0]?.url).toBe('https://api.test/v1/legal/documents/TERMS_OF_USE?locale=en');
  });

  it('is unpublished on a 404, and only on a 404', async () => {
    const { fetchImpl } = answering(404, { code: 'LEGAL_DOCUMENT_NOT_PUBLISHED' });

    expect(await fetchLegalDocument('terms-of-use', 'en', { env: ENV, fetchImpl })).toEqual({
      state: 'unpublished',
    });
  });

  it.each(FAILURES)('is unavailable, not unpublished, on %s', async (_, fetchImpl) => {
    expect(await fetchLegalDocument('terms-of-use', 'en', { env: ENV, fetchImpl })).toEqual({
      state: 'unavailable',
    });
  });

  it('holds nothing of a failure: the next read asks the service again', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1
        ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify(DOCUMENT), { status: 200 });
    }) as unknown as typeof fetch;

    expect((await fetchLegalDocument('terms-of-use', 'en', { env: ENV, fetchImpl })).state).toBe(
      'unavailable',
    );
    expect((await fetchLegalDocument('terms-of-use', 'en', { env: ENV, fetchImpl })).state).toBe(
      'published',
    );
    expect(calls).toBe(2);
  });

  it('asks for the hour-long window on the request itself, where Next keeps only a 200', async () => {
    const { calls, fetchImpl } = answering(503);

    await fetchLegalDocument('terms-of-use', 'en', { env: ENV, fetchImpl });

    // Next's data cache stores a response under this window only when its status is 200, so
    // a 503 asked for with it is still not held. What must not happen is a window applied
    // anywhere this module could hold a failure itself — there is no such place, and the
    // previous test is the proof.
    expect((calls[0]?.init as { next?: { revalidate?: number } } | undefined)?.next?.revalidate).toBe(
      3600,
    );
    expect(calls[0]?.init?.credentials).toBe('omit');
  });
});

describe('an archived version', () => {
  it('is published when the service has it', async () => {
    const { calls, fetchImpl } = answering(200, DOCUMENT);

    const read = await fetchArchivedLegalDocument('terms-of-use', 3, 'en', { env: ENV, fetchImpl });

    expect(read.state).toBe('published');
    expect(calls[0]?.url).toBe(
      'https://api.test/v1/legal/documents/TERMS_OF_USE/versions/3?locale=en',
    );
  });

  it('is unpublished on a 404', async () => {
    const { fetchImpl } = answering(404);

    expect(
      (await fetchArchivedLegalDocument('terms-of-use', 9, 'en', { env: ENV, fetchImpl })).state,
    ).toBe('unpublished');
  });

  it.each(FAILURES)('is unavailable on %s', async (_, fetchImpl) => {
    expect(
      (await fetchArchivedLegalDocument('terms-of-use', 3, 'en', { env: ENV, fetchImpl })).state,
    ).toBe('unavailable');
  });
});

describe('the catalogue', () => {
  it('is the list the service answered, empty included', async () => {
    const summary = {
      kind: 'TERMS_OF_USE',
      locale: 'en',
      version: 3,
      title: 'Terms of use',
      effectiveFrom: null,
    };

    expect(
      await fetchLegalCatalogue('en', {
        env: ENV,
        fetchImpl: answering(200, { documents: [summary] }).fetchImpl,
      }),
    ).toEqual([summary]);
    expect(
      await fetchLegalCatalogue('en', { env: ENV, fetchImpl: answering(200, { documents: [] }).fetchImpl }),
    ).toEqual([]);
  });

  it.each([...FAILURES, ['a 404', answering(404).fetchImpl] as const])(
    'is null, never an empty list, on %s',
    async (_, fetchImpl) => {
      expect(await fetchLegalCatalogue('en', { env: ENV, fetchImpl })).toBeNull();
    },
  );
});
