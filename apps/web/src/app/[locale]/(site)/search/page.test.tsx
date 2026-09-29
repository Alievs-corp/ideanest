import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DiscoveryFeed, ProjectCard } from '../../../../lib/discovery/api';
import { fetchSearchResults } from '../../../../lib/api/server';
import SearchPage, { generateMetadata } from './page';
import AZ from '../../../../../messages/az.json';

/**
 * `/search` in a language other than English — issue #142.
 *
 * The link into the feed under the results and the page's metadata description were typed in
 * English, so a reader of `/az/search` met Azerbaijani results with an English way onwards, and
 * a browser tab and a shared link described the page in English. Rendered in Azerbaijani because
 * English passing would prove nothing: the literals were English too.
 */

vi.mock('../../../../lib/api/server', () => ({ fetchSearchResults: vi.fn() }));

/*
 * The two client children are not what is under test and each needs a router of its own; the
 * grid's cards are covered by `ProjectCard.test.tsx`. Stand-ins keep this about the route.
 */
vi.mock('../../../../components/search/SearchField', () => ({ SearchField: () => null }));
vi.mock('../../../../components/browse/CampaignGrid', () => ({
  CampaignGrid: ({ label }: { label: string }) => <ul aria-label={label} />,
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const CATALOGUE = (await import('../../../../../messages/az.json')).default;

  return {
    getLocale: () => Promise.resolve('az'),
    getTranslations: (namespace: string) =>
      Promise.resolve(
        createTranslator({ locale: 'az', messages: CATALOGUE, namespace: namespace as never }),
      ),
  };
});

const fetchMock = vi.mocked(fetchSearchResults);

function feed(nextCursor: string | null): DiscoveryFeed {
  return { items: [{ id: 'p1' } as ProjectCard], nextCursor };
}

async function renderFor(query: string) {
  return render(await SearchPage({ searchParams: Promise.resolve({ q: query }) }));
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(cleanup);

describe('the search page in Azerbaijani', () => {
  it('describes itself in the route’s language', async () => {
    const metadata = await generateMetadata();

    expect(metadata.title).toBe(AZ.discovery.search.title);
    expect(metadata.description).toBe(AZ.discovery.search.metaDescription);
    expect(metadata.description).not.toContain('Search every campaign');
  });

  it('offers more results in the feed when there are more, in the route’s language', async () => {
    fetchMock.mockResolvedValue(feed('cursor-2'));
    await renderFor('lamp');

    const link = screen.getByRole('link', { name: AZ.discovery.search.moreInFeed });
    expect(link.getAttribute('href')).toMatch(/\/discover\?q=lamp(&|$)/u);
    expect(screen.queryByText('See more results in the feed')).not.toBeInTheDocument();
  });

  it('offers to refine the results in the feed when these are all of them', async () => {
    fetchMock.mockResolvedValue(feed(null));
    await renderFor('lamp');

    expect(screen.getByRole('link', { name: AZ.discovery.search.refineInFeed })).toBeInTheDocument();
    expect(screen.queryByText('Refine these results in the feed')).not.toBeInTheDocument();
  });
});
