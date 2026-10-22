import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  getDiscoveryFacets,
  getDiscoveryFeed,
  type DiscoveryFacets,
  type DiscoveryFeed,
  type ProjectCard as ProjectCardData,
} from '../../lib/discovery/api';
import { DiscoveryView } from './DiscoveryView';
import { shellCopyFrom } from '../../lib/i18n/shell-copy';

const MARKET_COPY = shellCopyFrom(translatorFor('shell')).market;
import { projectCardCopyFrom } from '../../lib/i18n/card-copy';
import { translatorFor } from '../../test-copy';
import { feedCopyFrom } from '../../lib/i18n/feed-copy';
/*
 * The copy the route would have resolved, built from `messages/en.json` by the same function it
 * calls — issue #324. Retyping the sentences here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const FEED_COPY = feedCopyFrom(
  translatorFor('discovery.feed'),
  translatorFor('discovery.filters'),
  translatorFor('discovery.suggest'),
);
/*
 * The copy the route would have resolved, built from `messages/en.json` by the same function it
 * calls — issue #324. Retyping the sentences here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const CARD_COPY = projectCardCopyFrom(translatorFor('discovery.card'), translatorFor('common'));

/**
 * The server-rendered first page — #119, from the client's side of it.
 *
 * The complaint #119 makes is that `/discover` shipped an empty grid: the feed was fetched
 * in the browser, so a crawler and a link unfurler were served a skeleton. The page now
 * fetches page one on the server and hands it here. What that has to mean, and what these
 * tests hold it to:
 *
 *   - **the cards are rendered without a request.** If the browser fetched anyway, the
 *     markup would be right and the request would be pure waste on the platform's busiest
 *     read;
 *   - **a seeded page for a different filter set is ignored.** The key is what makes that
 *     checkable, and showing one filter's cards under another filter's URL is the bug it
 *     prevents;
 *   - **no seed is a supported state.** The server read can fail, and the view then behaves
 *     exactly as it did before #119 rather than rendering an error;
 *   - **paging still works from a seeded page.** The cursor comes from the server's page,
 *     so "show more" has to continue from it rather than re-request page one.
 *
 * A separate file from `DiscoveryView.test.tsx` because it needs a different `next/navigation`
 * fixture — a fixed query string rather than one the router rewrites — and the two harnesses
 * in one file would be two ways to answer "what does the address bar say".
 */

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/discover',
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('../../lib/discovery/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/discovery/api')>()),
  getDiscoveryFeed: vi.fn(),
  getDiscoveryFacets: vi.fn(),
}));

vi.mock('../../lib/discovery/suggest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/discovery/suggest')>()),
  getSuggestions: vi.fn().mockResolvedValue([]),
}));

const feedMock = vi.mocked(getDiscoveryFeed);
const facetsMock = vi.mocked(getDiscoveryFacets);

const FACETS: DiscoveryFacets = {
  status: [],
  categories: [],
  subcategories: [],
  tags: [],
  programmes: [],
  completion: [],
  countries: [],
  cities: [],
  showOnly: [],
} as unknown as DiscoveryFacets;

function card(slug: string): ProjectCardData {
  return {
    id: `id-${slug}`,
    slug,
    creatorSlug: 'sound-lab',
    title: slug,
    creator: { name: 'Sound Lab', slug: 'sound-lab' },
    image: null,
    goal: { amount: '1000.00', currency: 'AZN' },
    pledged: { amount: '250.00', currency: 'AZN' },
    completionPercent: '25.00',
    backersCount: 2,
    daysLeft: 10,
    badge: 'live',
    state: 'LIVE',
    launchedAt: '2026-08-01T00:00:00Z',
    deadline: '2026-09-05T00:00:00Z',
  };
}

function feed(slugs: string[], nextCursor: string | null = null): DiscoveryFeed {
  return { items: slugs.map(card), ...(nextCursor === null ? {} : { nextCursor }) };
}

beforeEach(() => {
  feedMock.mockReset();
  facetsMock.mockReset();
  facetsMock.mockResolvedValue(FACETS);
});

afterEach(cleanup);

describe('a server-rendered first page', () => {
  it('is shown without the browser asking for it again', async () => {
    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} marketCopy={MARKET_COPY} seeded={{ key: '', feed: feed(['analogue-synth', 'field-recorder']) }} />);

    expect(await screen.findByText('analogue-synth')).toBeInTheDocument();
    expect(screen.getByText('field-recorder')).toBeInTheDocument();
    // The whole point. A refetch would make the server render decoration rather than
    // delivery.
    expect(feedMock).not.toHaveBeenCalled();
  });

  /**
   * The key is what makes a seeded page safe. Without it, a page fetched for
   * `?status=live` would be shown under `?category=games` — a feed that ignores the filters
   * somebody just chose, which is worse than a slow one.
   */
  it('is ignored when it answers a different question', async () => {
    feedMock.mockResolvedValue(feed(['from-the-browser']));

    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} marketCopy={MARKET_COPY} seeded={{ key: 'status=live', feed: feed(['from-the-server']) }} />);

    expect(await screen.findByText('from-the-browser')).toBeInTheDocument();
    expect(screen.queryByText('from-the-server')).not.toBeInTheDocument();
    expect(feedMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The server read can fail — the service restarts, a deploy is in flight — and the page
   * passes nothing when it does. A visitor must then get the feed the way they always did,
   * not an error page.
   */
  it('is optional, and its absence is the behaviour that existed before', async () => {
    feedMock.mockResolvedValue(feed(['from-the-browser']));

    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} marketCopy={MARKET_COPY} />);

    expect(await screen.findByText('from-the-browser')).toBeInTheDocument();
    expect(feedMock).toHaveBeenCalledTimes(1);
  });

  it('announces the seeded page, as a fetched one is announced', async () => {
    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} marketCopy={MARKET_COPY} seeded={{ key: '', feed: feed(['analogue-synth']) }} />);

    await waitFor(() => {
      expect(screen.getByText('1 project shown.')).toBeInTheDocument();
    });
  });

  it('says nothing matched when the server render found nothing', async () => {
    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} marketCopy={MARKET_COPY} seeded={{ key: '', feed: feed([]) }} />);

    await waitFor(() => {
      expect(screen.getByText('No projects match these filters.')).toBeInTheDocument();
    });
    expect(feedMock).not.toHaveBeenCalled();
  });

  /**
   * Paging continues from the server's cursor rather than restarting.
   *
   * The seeded page carries `nextCursor`, so the first thing the browser asks for is page
   * two. A hook that lost the cursor would either stop the feed at twenty-four cards or
   * re-request page one and show every card twice.
   */
  it('pages on from the cursor the server render came back with', async () => {
    feedMock.mockResolvedValue(feed(['page-two']));

    render(
      <DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} marketCopy={MARKET_COPY} seeded={{ key: '', feed: feed(['page-one'], 'cursor-abc') }} />,
    );

    const more = await screen.findByRole('button', { name: /show more/i });
    more.click();

    await waitFor(() => {
      expect(screen.getByText('page-two')).toBeInTheDocument();
    });
    expect(screen.getByText('page-one')).toBeInTheDocument();
    expect(feedMock).toHaveBeenCalledWith(expect.anything(), { cursor: 'cursor-abc' });
  });
});
