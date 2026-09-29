import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fetchCollection } from '../../../../../lib/api/server';
import type { Collection } from '../../../../../lib/collections/api';
import CollectionPage, { generateMetadata } from './page';

/**
 * `/collections/{slug}` — D-08, issue #266.
 *
 * WHAT THESE COVER, and why they are worth a route-level test rather than a component one:
 *
 *   - **a slug that names nothing renders the not-found route**, not an empty page. An empty
 *     landing page for `/collections/sprnig-2026` is a 200 that gets indexed, linked to, and
 *     re-crawled forever.
 *   - **and so does a collection that is merely not published**, indistinguishably. The
 *     service answers 404 rather than 403 so that a guessed slug cannot confirm the platform
 *     is preparing something under it, and a client that rendered "not open yet" would leak
 *     from the browser what the service refused to leak.
 *   - **the metadata and the body resolve the same collection.** They are two functions and
 *     the failure mode of letting them disagree is a real `<title>`, a canonical URL and a
 *     social card over a not-found body.
 *   - the campaigns are in the rendered HTML rather than fetched after hydration, which is the
 *     whole reason this route exists as a path.
 */

vi.mock('../../../../../lib/api/server', () => ({ fetchCollection: vi.fn() }));

/**
 * The real `notFound()` throws a control-flow error Next catches at the route boundary.
 * Throwing a recognisable one here is what lets a test assert that the page took that exit
 * rather than rendering something.
 */
const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => {
    throw NOT_FOUND;
  },
}));

/**
 * The request-scoped half of next-intl, which only exists inside a Next render — #324. The
 * page resolves the window's two terms and the page's language from it, and the answers here
 * are what `i18n/request.ts` would have produced for the English catalogue.
 */
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const CATALOGUE = (await import('@ideanest/messages/en.json')).default;

  return {
    getLocale: () => Promise.resolve('en'),
    /*
     * next-intl's own formatter rather than a stub returning a string. The page reads
     * `t.raw` for the kind table and the plural forms, and a bare function has no `raw` —
     * which fails as "t.raw is not a function" three frames inside a builder rather than
     * anywhere near the mock.
     */
    getTranslations: (namespace: string) =>
      Promise.resolve(
        createTranslator({ locale: 'en', messages: CATALOGUE, namespace: namespace as never }),
      ),
  };
});

const fetchMock = vi.mocked(fetchCollection);

const COLLECTION: Collection = {
  id: 'c1',
  slug: 'spring-2026',
  kind: 'open_call',
  title: 'Spring 2026',
  description: 'Applications for the spring programme.',
  image: null,
  grantsBadge: true,
  projectCount: 1,
  opensAt: '2026-03-01T00:00:00Z',
  closesAt: '2026-05-31T20:59:59Z',
};

const CARD = {
  id: 'p1',
  slug: 'a-campaign',
  creatorSlug: 'aysel',
  title: 'A campaign',
  creator: { name: 'Aysel', slug: 'aysel' },
  pledged: { amount: '1200.00', currency: 'AZN' },
  goal: { amount: '2000.00', currency: 'AZN' },
  completionPercent: '60.00',
  backersCount: 12,
  daysLeft: 9,
  badge: 'live' as const,
  state: 'LIVE',
};

function params(slug: string) {
  return { params: Promise.resolve({ locale: 'en', slug }) };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ collection: COLLECTION, items: [CARD], nextCursor: null });
});

afterEach(cleanup);

describe('a collection that is visible', () => {
  it('renders its header and its campaigns in the document itself', async () => {
    render(await CollectionPage(params('spring-2026')));

    expect(screen.getByRole('heading', { level: 1, name: 'Spring 2026' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'A campaign' })).toBeInTheDocument();
  });

  it('states the open call’s closing date', async () => {
    render(await CollectionPage(params('spring-2026')));

    expect(screen.getByText('Closes')).toBeInTheDocument();
    expect(screen.getByText('31 May 2026')).toHaveAttribute('datetime', '2026-05-31T20:59:59Z');
  });

  it('declares the trail it sits in, for a crawler as well as a reader', async () => {
    const { container } = render(await CollectionPage(params('spring-2026')));

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script?.textContent).toContain('BreadcrumbList');
    expect(script?.textContent).toContain('/collections/spring-2026');
  });

  it('takes its title and canonical from the same collection the body renders', async () => {
    const metadata = await generateMetadata(params('spring-2026'));

    expect(metadata.title).toBe('Spring 2026');
    expect(metadata.description).toBe('Applications for the spring programme.');
    expect(metadata.alternates?.canonical).toContain('/collections/spring-2026');
  });
});

describe('a collection that is not visible', () => {
  it('renders the not-found route rather than an empty page', async () => {
    fetchMock.mockResolvedValue(null);

    await expect(CollectionPage(params('sprnig-2026'))).rejects.toBe(NOT_FOUND);
  });

  it('describes nothing, so a 404 body never sits under a real social card', async () => {
    fetchMock.mockResolvedValue(null);

    const metadata = await generateMetadata(params('spring-2027'));

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates?.canonical).toBeUndefined();
    expect(metadata.openGraph).toBeNull();
  });
});
