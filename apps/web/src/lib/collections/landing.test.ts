import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCollection } from '../api/server';
import type { Collection } from './api';
import { collectionSocialDescription, resolveCollectionLanding } from './landing';
import CATALOGUE from '../../../messages/en.json';

/** The fallback the route resolves, from the catalogue the page will actually draw. */
const FALLBACK = CATALOGUE.discovery.collections.socialDescription;

/**
 * What a collection landing page resolves to — D-08, issue #266.
 *
 * WHAT THESE COVER:
 *
 *   - **every refusal is the same answer.** A slug that names nothing, a collection that has
 *     not been published, one outside its window, and a service that could not be reached all
 *     resolve to `not-found`. The first three are indistinguishable by design
 *     (`CollectionController`: a 403 would confirm that `/collections/spring-2027` exists to
 *     anybody who guesses), and this function must not undo that by telling them apart.
 *   - the campaigns arrive in the curator's order and are passed through untouched.
 *   - `nextCursor` is carried, because a short page is not the end of a collection — only the
 *     absence of a cursor is.
 *   - the social description is the curator's own standfirst when there is one, and invents no
 *     count and no deadline when there is not.
 */

vi.mock('../api/server', () => ({ fetchCollection: vi.fn() }));

const fetchMock = vi.mocked(fetchCollection);

const COLLECTION: Collection = {
  id: 'c1',
  slug: 'spring-2026',
  kind: 'open_call',
  title: 'Spring 2026',
  description: 'Applications for the spring programme.',
  image: null,
  grantsBadge: true,
  projectCount: 2,
  opensAt: '2026-03-01T00:00:00Z',
  closesAt: '2026-05-31T20:59:59Z',
};

const CARD = {
  id: 'p1',
  slug: 'a-campaign',
  creatorSlug: 'aysel',
  title: 'A campaign',
  creator: { name: 'Aysel', slug: 'aysel' },
  pledged: { amount: '10.00', currency: 'AZN' },
  backersCount: 1,
  state: 'LIVE',
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ collection: COLLECTION, items: [CARD], nextCursor: null });
});

describe('a collection that is visible', () => {
  it('resolves with its campaigns in the order the service sent them', async () => {
    const second = { ...CARD, id: 'p2', slug: 'another' };
    fetchMock.mockResolvedValue({ collection: COLLECTION, items: [second, CARD], nextCursor: null });

    const result = await resolveCollectionLanding('spring-2026');

    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.collection.title).toBe('Spring 2026');
    expect(result.campaigns.map((card) => card.id)).toEqual(['p2', 'p1']);
  });

  it('asks for a full page', async () => {
    await resolveCollectionLanding('spring-2026');

    expect(fetchMock).toHaveBeenCalledWith('spring-2026', { limit: 24 });
  });

  it('carries the cursor, because a short page is not the end of the list', async () => {
    fetchMock.mockResolvedValue({ collection: COLLECTION, items: [CARD], nextCursor: 'abc' });

    const result = await resolveCollectionLanding('spring-2026');

    expect(result.kind === 'found' && result.nextCursor).toBe('abc');
  });

  it('is a page with an empty list when the collection has nothing published in it', async () => {
    // A curator may have chosen campaigns that have not launched. The collection exists, has a
    // name and a window, and the page is honest about being empty — which a 404 would not be.
    fetchMock.mockResolvedValue({ collection: COLLECTION, items: [], nextCursor: null });

    const result = await resolveCollectionLanding('spring-2026');

    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.campaigns).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});

describe('a collection that is not visible', () => {
  it('is not found, whatever the reason was', async () => {
    fetchMock.mockResolvedValue(null);

    expect(await resolveCollectionLanding('spring-2027')).toEqual({ kind: 'not-found' });
  });

  it('is not found when the service could not be reached either', async () => {
    // The uncomfortable one, and still right: without the response there is no title for the
    // heading and no way to know the slug is real, so the alternative is a page titled with a
    // slug at a URL a crawler will index and re-crawl forever.
    fetchMock.mockResolvedValue(null);

    expect(await resolveCollectionLanding('anything')).toEqual({ kind: 'not-found' });
  });
});

describe('what a collection says about itself in a shared link', () => {
  it('is the curator’s own standfirst', () => {
    expect(collectionSocialDescription(COLLECTION, FALLBACK)).toBe('Applications for the spring programme.');
  });

  it('names the collection and stops when there is no standfirst', () => {
    const description = collectionSocialDescription({ ...COLLECTION, description: null }, FALLBACK);

    expect(description).toBe(
      'Spring 2026 — a curated collection of crowdfunding campaigns on IdeyaNest.',
    );
  });

  it('invents no count and no deadline, which go stale in a cache', () => {
    const description = collectionSocialDescription({ ...COLLECTION, description: '   ' }, FALLBACK);

    expect(description).not.toMatch(/\d\scampaign/u);
    expect(description).not.toContain('May');
  });
});
