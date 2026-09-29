import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { ProjectCard } from '../../lib/discovery/api';
import type { Category } from '../../lib/categories/api';
import { CategoryLanding } from './CategoryLanding';
import CATALOGUE from '@ideanest/messages/en.json';
import { resolveServerTree } from '../../test-support/server-tree';

/*
 * The real catalogue, through next-intl's own formatter — issue #324.
 *
 * `createTranslator` rather than a hand-rolled substitution, because the count is an ICU plural
 * — {count, plural, one {# campaign} other {# campaigns}} — and a regex that swapped the
 * placeholder for a number would produce a sentence no language actually renders.
 * `CampaignSummary.test.tsx` established the mock and this is the same one.
 */
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');

  return {
    getLocale: async () => 'en',
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'en', messages: CATALOGUE, namespace: namespace as never }),
  };
});

/** `CategoryLanding` is an async server component since #324 — see `test-support/server-tree`. */
async function renderLanding(element: ReactElement): Promise<void> {
  render(await resolveServerTree(element) as ReactElement);
}

/**
 * The body of a category or subcategory landing page — §4.13 WS-05, issue #265.
 *
 * WHAT THESE COVER:
 *
 *   - the trail is rendered for a reader as well as declared in JSON-LD for a crawler. A page
 *     with only the machine half is one a person lands on with no way up.
 *   - the subcategory chips are on the category page and are the only link a crawler will find
 *     to a hundred subcategory pages.
 *   - the empty state is `empty`, not `filtered`: nothing here is a filter the reader chose,
 *     and telling them to clear one would be telling them to undo something they did not do.
 *   - the way into the feed carries the category as a real filter URL.
 */

const GAMES: Category = {
  id: '1',
  slug: 'games',
  name: 'Games',
  subcategories: [
    { id: '1a', slug: 'tabletop', name: 'Tabletop' },
    { id: '1b', slug: 'video', name: 'Video games' },
  ],
};

const CARD: ProjectCard = {
  id: 'c1',
  slug: 'a-campaign',
  creatorSlug: 'aysel',
  title: 'A campaign',
  creator: { name: 'Aysel', slug: 'aysel' },
  pledged: { amount: '1200.00', currency: 'AZN' },
  goal: { amount: '2000.00', currency: 'AZN' },
  completionPercent: '60.00',
  backersCount: 12,
  daysLeft: 9,
  badge: 'live',
  state: 'LIVE',
};

afterEach(cleanup);

describe('a category page', () => {
  it('names itself and shows the trail it sits in', async () => {
    await renderLanding(<CategoryLanding category={GAMES} campaigns={[CARD]} hasMore={false} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Categories' })).toHaveAttribute('href', '/en/categories');
  });

  it('links every subcategory, which is the only path a crawler has to them', async () => {
    await renderLanding(<CategoryLanding category={GAMES} campaigns={[CARD]} hasMore={false} />);

    const children = screen.getByRole('navigation', { name: 'Subcategories of Games' });
    expect(within(children).getByRole('link', { name: 'Tabletop' })).toHaveAttribute('href', '/en/categories/games/tabletop');
    expect(within(children).getByRole('link', { name: 'Video games' })).toHaveAttribute('href', '/en/categories/games/video');
  });

  it('offers the same category inside the feed, as a real filter URL', async () => {
    await renderLanding(<CategoryLanding category={GAMES} campaigns={[CARD]} hasMore={false} />);

    const link = screen.getByRole('link', { name: /Filter and sort Games in the feed/u });
    expect(link).toHaveAttribute('href', '/en/discover?category=games');
  });

  it('says there is more when the service said so', async () => {
    await renderLanding(<CategoryLanding category={GAMES} campaigns={[CARD]} hasMore />);

    expect(screen.getByRole('link', { name: /See every campaign in Games/u })).toBeInTheDocument();
  });
});

describe('a subcategory page', () => {
  it('names the child and puts the parent in the trail', async () => {
    await renderLanding(
      <CategoryLanding
        category={GAMES}
        subcategory={GAMES.subcategories[0]}
        campaigns={[CARD]}
        hasMore={false}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Tabletop' })).toBeInTheDocument();

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Games' })).toHaveAttribute('href', '/en/categories/games');
  });

  it('does not offer its own children, because it has none', async () => {
    await renderLanding(
      <CategoryLanding
        category={GAMES}
        subcategory={GAMES.subcategories[0]}
        campaigns={[CARD]}
        hasMore={false}
      />,
    );

    expect(screen.queryByRole('navigation', { name: 'Subcategories of Games' })).toBeNull();
  });

  it('carries both slugs into the feed link', async () => {
    await renderLanding(
      <CategoryLanding
        category={GAMES}
        subcategory={GAMES.subcategories[0]}
        campaigns={[CARD]}
        hasMore={false}
      />,
    );

    expect(screen.getByRole('link', { name: /in the feed/u })).toHaveAttribute('href', '/en/discover?category=games&subcategory=tabletop');
  });
});

describe('with nothing published', () => {
  it('says the category is empty rather than telling the reader to clear a filter', async () => {
    await renderLanding(<CategoryLanding category={GAMES} campaigns={[]} hasMore={false} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Nothing published in Games yet' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/clear/iu)).toBeNull();
    expect(screen.getByRole('link', { name: 'Browse the feed' })).toHaveAttribute('href', '/en/discover');
  });

  it('still lists the subcategories, which may not be empty', async () => {
    await renderLanding(<CategoryLanding category={GAMES} campaigns={[]} hasMore={false} />);

    expect(screen.getByRole('link', { name: 'Tabletop' })).toBeInTheDocument();
  });
});

describe('the count', () => {
  it('is stated as text rather than left to be counted off the screen', async () => {
    await renderLanding(<CategoryLanding category={GAMES} campaigns={[CARD]} hasMore={false} />);
    expect(screen.getByText('1 campaign')).toBeInTheDocument();
  });

  it('pluralises', async () => {
    await renderLanding(<CategoryLanding category={GAMES} campaigns={[CARD, { ...CARD, id: 'c2' }]} hasMore={false} />);
    expect(screen.getByText('2 campaigns')).toBeInTheDocument();
  });
});
