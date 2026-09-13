import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  getDiscoveryFacets,
  getDiscoveryFeed,
  type DiscoveryFacets,
  type DiscoveryFeed,
  type ProjectCard as ProjectCardData,
} from '../../lib/discovery/api';
import type { DiscoveryFilters } from '../../lib/discovery/filters';
import { expectNoViolations } from '../../test-axe';
import { DiscoveryView } from './DiscoveryView';
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
 * The discovery surface end to end, with the two endpoints stubbed.
 *
 * WHAT THESE COVER, and why each one is here rather than left to Storybook:
 *
 *   - a filter goes into the URL AND into the request. The URL is the state
 *     (D-12), so a filter that changes only one of the two is a link that means
 *     something different to the person who receives it.
 *   - the chips reflect and remove the active set, with an accessible name that
 *     says what removing does.
 *   - the sort changes the request rather than re-sorting on the client.
 *   - "show more" APPENDS and fires ONCE PER CURSOR. A duplicated page is the
 *     characteristic infinite-scroll bug and it is invisible in a screenshot.
 *   - the empty state names the filter responsible. "No results" is
 *     indistinguishable from "the platform has nothing".
 *   - a refusal is the service's own RFC 9457 prose, never a generic apology.
 *   - a facet count of zero is visibly unavailable rather than silently gone.
 *   - the rail is operable by keyboard and structured as named groups.
 *   - a page arriving is announced.
 *
 * `next/navigation` is stubbed with a query string that actually changes, so
 * "the filter went into the URL" and "the page re-read the URL and refetched"
 * are the same assertion rather than two hopeful ones.
 */

const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let search = '';

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => search,
    /** What the address bar holds, as the router would write it. */
    navigate: (href: string) => {
      const mark = href.indexOf('?');
      search = mark === -1 ? '' : href.slice(mark + 1);
      for (const listener of [...listeners]) listener();
    },
    reset: (initial = '') => {
      search = initial;
      for (const listener of [...listeners]) listener();
    },
  };
});

vi.mock('next/navigation', async (importOriginal) => {
  const { useSyncExternalStore } = await import('react');

  return {
    /*
     * Spread first so the real module's other exports survive — `i18n/navigation.tsx` reads
     * `useParams` to learn the route's language, and a factory that replaced the module
     * wholesale left it undefined.
     */
    ...(await importOriginal<typeof import('next/navigation')>()),
    usePathname: () => '/en/discover',
    useRouter: () => ({
      push: nav.navigate,
      replace: nav.navigate,
      prefetch: () => {},
      back: () => {},
      forward: () => {},
      refresh: () => {},
    }),
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(nav.subscribe, nav.read, nav.read)),
  };
});

vi.mock('../../lib/discovery/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/discovery/api')>()),
  getDiscoveryFeed: vi.fn(),
  getDiscoveryFacets: vi.fn(),
}));

/*
 * The suggestion endpoint is stubbed to answer with nothing. Typing into the
 * search box would otherwise reach `fetch` for a relative URL that no server is
 * behind, and a failing request in the middle of an unrelated assertion is
 * noise rather than a finding. What the autocomplete DOES is covered in
 * `SearchBox.test.tsx`; what is covered here is that the query reaches the feed
 * and the URL.
 */
vi.mock('../../lib/discovery/suggest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/discovery/suggest')>()),
  getSuggestions: vi.fn().mockResolvedValue([]),
}));

const feedMock = vi.mocked(getDiscoveryFeed);
const facetsMock = vi.mocked(getDiscoveryFacets);

/* -------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------- */

function card(slug: string, overrides: Partial<ProjectCardData> = {}): ProjectCardData {
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
    ...overrides,
  };
}

/**
 * Counts chosen so that no two dimensions agree. "Art" counts zero, which is
 * the option the rail must show as unavailable rather than remove.
 */
const FACETS: DiscoveryFacets = {
  status: [
    { value: 'upcoming', count: 4 },
    { value: 'live', count: 12 },
    { value: 'extended', count: 0 },
    { value: 'successful', count: 7 },
  ],
  categories: [
    {
      slug: 'games',
      name: 'Games',
      count: 9,
      subcategories: [
        { slug: 'tabletop', name: 'Tabletop games', count: 5 },
        { slug: 'video', name: 'Video games', count: 4 },
      ],
    },
    { slug: 'art', name: 'Art', count: 0, subcategories: [] },
  ],
  tags: [
    { slug: 'handmade', name: 'Handmade', count: 6 },
    { slug: 'ceramics', name: 'Ceramics', count: 3 },
  ],
  completion: [
    { value: 'under_25', count: 3 },
    { value: '25_to_50', count: 2 },
    { value: '50_to_75', count: 1 },
    { value: '75_to_100', count: 1 },
    { value: 'over_100', count: 8 },
  ],
  goalAmount: [
    { value: 'under_1000', count: 2 },
    { value: '1000_to_5000', count: 6 },
    { value: '5000_to_20000', count: 4 },
    { value: '20000_to_50000', count: 1 },
    { value: 'over_50000', count: 0 },
  ],
  amountRaised: [
    { value: 'under_1000', count: 9 },
    { value: '1000_to_5000', count: 2 },
    { value: '5000_to_20000', count: 1 },
    { value: '20000_to_50000', count: 1 },
    { value: 'over_50000', count: 0 },
  ],
};

const FIRST_PAGE: DiscoveryFeed = {
  items: [card('alpha'), card('bravo'), card('charlie')],
  nextCursor: 'cursor-2',
};

/** The filters the most recent feed request was made with. */
function lastQuery(): DiscoveryFilters {
  const call = feedMock.mock.calls.at(-1);
  if (call === undefined) throw new Error('the feed was never requested');
  return call[0];
}

function lastCursor(): string | null | undefined {
  return feedMock.mock.calls.at(-1)?.[1]?.cursor;
}

async function open(initialSearch = ''): Promise<UserEvent> {
  nav.reset(initialSearch);

  const user = userEvent.setup();
  render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} />);
  await screen.findByRole('heading', { level: 1, name: 'Discover' });
  await waitFor(() => expect(feedMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Games' })).toBeInTheDocument());

  return user;
}

const search = (): URLSearchParams => new URLSearchParams(nav.read());

beforeEach(() => {
  vi.clearAllMocks();
  nav.reset('');
  feedMock.mockResolvedValue(FIRST_PAGE);
  facetsMock.mockResolvedValue(FACETS);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------
 * The feed
 * ---------------------------------------------------------------------- */

describe('DiscoveryView', () => {
  it('announces that it is loading rather than showing an empty page', () => {
    feedMock.mockReturnValue(new Promise<DiscoveryFeed>(() => {}));
    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} />);

    const label = screen.getByText('Loading projects', { selector: 'span' });
    expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a card per campaign and announces how many arrived', async () => {
    await open();

    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'charlie' })).toBeInTheDocument();

    // Polite, not assertive: a page of results is an outcome the reader asked
    // for, not an interruption to assert over whatever they are hearing.
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('3 projects shown.');
  });

  it('asks for the service default sort by sending none', async () => {
    await open();

    expect(lastQuery().sort).toBe('newest');
    expect(search().has('sort')).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * Filters
 * ---------------------------------------------------------------------- */

describe('applying a filter', () => {
  it('puts a status in the URL and refetches with it', async () => {
    const user = await open();

    await user.click(screen.getByRole('checkbox', { name: 'Live' }));

    await waitFor(() => expect(search().get('status')).toBe('live'));
    await waitFor(() => expect(lastQuery().statuses).toEqual(['live']));
  });

  it('puts a category in the URL and reveals its subcategories', async () => {
    const user = await open();

    await user.click(screen.getByRole('checkbox', { name: 'Games' }));

    await waitFor(() => expect(search().get('category')).toBe('games'));
    await waitFor(() => expect(lastQuery().categories).toEqual(['games']));

    // A hundred subcategories at once is a rail nobody can read, so they appear
    // under the category that was chosen.
    const nested = await screen.findByRole('list', { name: 'Games subcategories' });
    await user.click(within(nested).getByRole('checkbox', { name: 'Tabletop games' }));

    await waitFor(() => expect(search().get('subcategory')).toBe('tabletop'));
    await waitFor(() => expect(lastQuery().subcategories).toEqual(['tabletop']));
  });

  it('puts a completion band, a goal band and a tag in the URL', async () => {
    const user = await open();

    await user.click(screen.getByRole('checkbox', { name: 'Funded — 100% or more' }));
    await waitFor(() => expect(search().get('completion')).toBe('over_100'));

    await user.click(screen.getAllByRole('checkbox', { name: '1,000 to under 5,000 AZN' })[0]!);
    await waitFor(() => expect(search().get('goalBand')).toBe('1000_to_5000'));

    await user.click(screen.getByRole('checkbox', { name: 'Handmade' }));
    await waitFor(() => expect(search().get('tag')).toBe('handmade'));

    await waitFor(() => {
      const query = lastQuery();
      expect(query.completion).toEqual(['over_100']);
      expect(query.goal.bands).toEqual(['1000_to_5000']);
      expect(query.tags).toEqual(['handmade']);
    });
  });

  it('applies a custom money range only once, through its own control', async () => {
    const user = await open();
    const requestsBefore = feedMock.mock.calls.length;

    await user.type(screen.getByLabelText('Lowest goal amount'), '2500');
    await user.type(screen.getByLabelText('Highest goal amount'), '20000');

    // Typing must not fetch. A range applied per keystroke sends a feed for
    // "2", "25", "250" and "2500" on the way to 25,000.
    expect(feedMock.mock.calls.length).toBe(requestsBefore);

    await user.click(screen.getByRole('button', { name: 'Apply the custom goal amount range' }));

    await waitFor(() => {
      expect(search().get('goalMin')).toBe('2500');
      expect(search().get('goalMax')).toBe('20000');
    });
    await waitFor(() => expect(lastQuery().goal).toEqual({ bands: [], min: '2500', max: '20000' }));
  });

  it('refuses a range the service would refuse, and says why', async () => {
    const user = await open();

    await user.type(screen.getByLabelText('Lowest goal amount'), '5000');
    await user.type(screen.getByLabelText('Highest goal amount'), '1000');
    await user.click(screen.getByRole('button', { name: 'Apply the custom goal amount range' }));

    // `?goalMin=5000&goalMax=1000` is a 400. Announced on insertion rather than
    // only coloured.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The lowest amount must not be more than the highest.',
    );
    expect(search().has('goalMin')).toBe(false);
  });

  it('refuses an amount a JavaScript number would swallow', async () => {
    const user = await open();

    await user.type(screen.getByLabelText('Lowest goal amount'), '1e5');
    await user.click(screen.getByRole('button', { name: 'Apply the custom goal amount range' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount in digits');
    expect(search().has('goalMin')).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * Facet counts
 * ---------------------------------------------------------------------- */

describe('facet counts', () => {
  it('shows the count beside every value', async () => {
    await open();

    const live = screen.getByRole('checkbox', { name: 'Live' }).closest('li');
    expect(live).toHaveTextContent('12');

    const games = screen.getByRole('checkbox', { name: 'Games' }).closest('li');
    expect(games).toHaveTextContent('9');
  });

  it('marks an empty value unavailable rather than removing it', async () => {
    await open();

    // A control that disappears when its count reaches zero is a control that
    // moves under the reader's cursor, and a filter whose options come and go
    // is a filter people stop trusting.
    const art = screen.getByRole('checkbox', { name: 'Art' });
    expect(art).toBeDisabled();
    expect(art.closest('div')).toHaveTextContent('None');

    const extended = screen.getByRole('checkbox', { name: 'Extended' });
    expect(extended).toBeDisabled();
    expect(extended.closest('li')).toHaveTextContent('None');
  });

  it('keeps a chosen value operable even once it counts zero', async () => {
    // Otherwise the reader is left holding a filter they cannot remove from the
    // control that applied it.
    await open('status=extended');

    expect(screen.getByRole('checkbox', { name: 'Extended' })).toBeEnabled();
  });

  it('never shows an unknown count as zero', async () => {
    // The panel failing is a rail without numbers, not a rail of disabled
    // controls — the filters still work, because the feed is its own request.
    facetsMock.mockRejectedValue(new Error('nope'));
    nav.reset('');
    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} />);

    await waitFor(() => expect(feedMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Live' })).toBeEnabled());
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * Chips
 * ---------------------------------------------------------------------- */

describe('the applied-filter chips', () => {
  it('reflects the active set, naming each filter by its group', async () => {
    await open('status=live&category=games&tag=handmade');

    expect(screen.getByRole('button', { name: 'Remove Status filter: Live' })).toBeInTheDocument();
    // The translated name from the panel, not the slug.
    expect(screen.getByRole('button', { name: 'Remove Category filter: Games' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Tag filter: Handmade' })).toBeInTheDocument();
  });

  it('removes exactly the filter its chip names', async () => {
    const user = await open('status=live&category=games');

    await user.click(screen.getByRole('button', { name: 'Remove Status filter: Live' }));

    await waitFor(() => expect(search().has('status')).toBe(false));
    expect(search().get('category')).toBe('games');
    await waitFor(() => expect(lastQuery().statuses).toEqual([]));
  });

  it('clears every filter and keeps the order the reader chose', async () => {
    const user = await open('status=live&tag=handmade&sort=ending_soon');

    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));

    await waitFor(() => expect(search().toString()).toBe('sort=ending_soon'));
    await waitFor(() => expect(lastQuery().sort).toBe('ending_soon'));
  });

  it('shows no chip row when nothing is filtered', async () => {
    await open();

    expect(screen.queryByRole('group', { name: 'Applied filters' })).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * Sort
 * ---------------------------------------------------------------------- */

describe('the sort control', () => {
  it('changes the request and the URL', async () => {
    const user = await open();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'most_funded');

    await waitFor(() => expect(search().get('sort')).toBe('most_funded'));
    await waitFor(() => expect(lastQuery().sort).toBe('most_funded'));
  });

  it('offers only the orders the service can serve', async () => {
    await open();

    const options = within(screen.getByRole('combobox', { name: 'Sort by' }))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);

    expect(options).toEqual(['newest', 'ending_soon', 'most_funded', 'most_backed', 'popularity']);
    // Declared by the service and refused by every implementation of it (#44,
    // #47). Offering an order that empties the page is worse than not offering
    // it.
    expect(options).not.toContain('relevance');
    expect(options).not.toContain('near_me');
    // `best_match` has nothing to rank on an unsearched feed and the service
    // resolves it straight back to `newest`, so offering it here would be a
    // control that appears selectable and then does nothing.
    expect(options).not.toContain('best_match');
  });

  it('offers best match, and shows it, once there is something to match', async () => {
    await open('q=ceramics');

    const control = screen.getByRole('combobox', { name: 'Sort by' }) as HTMLSelectElement;
    const options = within(control)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);

    expect(options).toContain('best_match');
    // AND IT IS SELECTED. An unstated sort resolves to `best_match` server-side
    // whenever `q` is present, so a control reading "Newest" over this feed
    // would be describing an order the service is not using.
    expect(control.value).toBe('best_match');
    expect(lastQuery().sort).toBe('best_match');
  });

  it('keeps an order the reader chose over a search', async () => {
    await open('q=ceramics&sort=ending_soon');

    expect((screen.getByRole('combobox', { name: 'Sort by' }) as HTMLSelectElement).value).toBe(
      'ending_soon',
    );
    expect(lastQuery().sort).toBe('ending_soon');
  });
});

/* -------------------------------------------------------------------------
 * Free text
 * ---------------------------------------------------------------------- */

describe('searching the feed', () => {
  it('sends the query with the filters and puts it in the URL', async () => {
    const user = await open('category=games');

    await user.type(
      screen.getByRole('combobox', { name: 'Search campaigns' }),
      'ceramics{Enter}',
    );

    await waitFor(() => expect(search().get('q')).toBe('ceramics'));
    await waitFor(() => expect(lastQuery().query).toBe('ceramics'));
    // `?q=` composes with every filter rather than replacing them.
    expect(lastQuery().categories).toEqual(['games']);
  });

  it('opens holding what the URL is searching for', async () => {
    await open('q=ceramics');

    expect(screen.getByRole('combobox', { name: 'Search campaigns' })).toHaveValue('ceramics');
    expect(lastQuery().query).toBe('ceramics');
  });

  it('names the search in the empty state rather than blaming the filters', async () => {
    feedMock.mockResolvedValue({ items: [] });
    await open('q=qwertyuiop');

    // No facet counts the query — it narrows the set the facets are counted
    // over rather than being a dimension of its own — so `blameFor` cannot see
    // it and would blame the filters for an emptiness a misspelt word caused.
    expect(
      await screen.findByRole('heading', { name: 'No projects match “qwertyuiop”' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear the search' })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * Paging
 * ---------------------------------------------------------------------- */

describe('showing more projects', () => {
  it('appends the next page rather than replacing the feed', async () => {
    const user = await open();
    feedMock.mockResolvedValueOnce({ items: [card('delta')], nextCursor: null });

    await user.click(screen.getByRole('button', { name: 'Show more projects' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'delta' })).toBeInTheDocument());
    // The first page is still there.
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
    expect(lastCursor()).toBe('cursor-2');
  });

  it('sends each cursor exactly once, however many times the control fires', async () => {
    // A sentinel at the bottom of a grid crosses the viewport repeatedly — an
    // overshooting scroll, a resize, an image loading above it. Without the
    // guard the same page is fetched and appended three times, and the reader
    // sees every card twice.
    const user = await open();

    let release: (page: DiscoveryFeed) => void = () => {};
    feedMock.mockReturnValueOnce(
      new Promise<DiscoveryFeed>((resolve) => {
        release = resolve;
      }),
    );

    const button = screen.getByRole('button', { name: 'Show more projects' });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Loading more projects' }));
    await user.click(screen.getByRole('button', { name: 'Loading more projects' }));

    const forCursorTwo = feedMock.mock.calls.filter((call) => call[1]?.cursor === 'cursor-2');
    expect(forCursorTwo).toHaveLength(1);

    release({ items: [card('delta')], nextCursor: null });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'delta' })).toBeInTheDocument());

    // And still once, now that the response has landed and been committed.
    expect(feedMock.mock.calls.filter((call) => call[1]?.cursor === 'cursor-2')).toHaveLength(1);
  });

  it('announces the page that arrived', async () => {
    const user = await open();
    feedMock.mockResolvedValueOnce({ items: [card('delta'), card('echo')], nextCursor: null });

    await user.click(screen.getByRole('button', { name: 'Show more projects' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('2 more projects loaded.'),
    );
  });

  it('offers a real control rather than only a scroll observer', async () => {
    // A keyboard user and a screen-reader user never produce a scroll that
    // intersects anything. The observer is the enhancement; this is the
    // mechanism.
    const user = await open();

    // Focused and pressed with the keyboard rather than the pointer.
    const button = screen.getByRole('button', { name: 'Show more projects' });
    button.focus();
    expect(button).toHaveFocus();

    feedMock.mockResolvedValueOnce({ items: [card('delta')], nextCursor: null });
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'delta' })).toBeInTheDocument());
  });

  it('says the feed has ended rather than leaving a control that does nothing', async () => {
    feedMock.mockResolvedValue({ items: [card('alpha')], nextCursor: null });
    await open();

    expect(screen.queryByRole('button', { name: 'Show more projects' })).not.toBeInTheDocument();
    expect(screen.getByText('That is every project matching these filters.')).toBeInTheDocument();
  });

  it('keeps the cards already read when the next page fails', async () => {
    const user = await open();
    feedMock.mockRejectedValueOnce(
      new ApiError(400, {
        code: 'DISCOVERY_CURSOR_MISMATCH',
        title: 'Cursor does not match this query',
        detail: 'This cursor was issued for a different query.',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Show more projects' }));

    await waitFor(() =>
      expect(screen.getByText('This cursor was issued for a different query.')).toBeInTheDocument(),
    );
    // Blanking a feed somebody is reading is a worse answer than saying the
    // next page did not arrive.
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * Empty and failed
 * ---------------------------------------------------------------------- */

describe('when nothing matches', () => {
  it('names the filter responsible and offers to remove it', async () => {
    feedMock.mockResolvedValue({ items: [], nextCursor: null });
    const user = await open('status=live&category=art');

    // "Art" counts zero under the rest of the choice, so it is the value that
    // is incompatible with it — and removing it is the move that brings results
    // back.
    expect(await screen.findByText(/has no campaigns/)).toHaveTextContent('Art');
    // And the filter that is NOT to blame is not offered for removal here — a
    // list of every filter would be the "undo choices at random" this replaces.
    expect(screen.queryByRole('button', { name: 'Remove Live' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Art' }));

    await waitFor(() => expect(search().has('category')).toBe(false));
    expect(search().get('status')).toBe('live');
  });

  it('names them all when no single filter is to blame', async () => {
    // Tags are AND'd: each can have campaigns behind it while nothing carries
    // both. Blaming one would send the reader to remove the wrong filter.
    feedMock.mockResolvedValue({ items: [], nextCursor: null });
    await open('tag=handmade,ceramics');

    const description = await screen.findByText(/nothing in common/);
    expect(description).toHaveTextContent('Handmade, Ceramics');
  });

  it('says the platform is empty when nothing is filtered at all', async () => {
    feedMock.mockResolvedValue({ items: [], nextCursor: null });
    await open();

    expect(await screen.findByRole('heading', { name: 'No projects to show yet' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No projects match these filters.');
  });
});

describe('when the service refuses', () => {
  it('surfaces the problem detail rather than a generic apology', async () => {
    feedMock.mockRejectedValue(
      new ApiError(400, {
        code: 'DISCOVERY_VALUE_UNKNOWN',
        title: 'Unknown filter value',
        detail: "'finished' is not a value that status takes.",
        meta: { parameter: 'status', value: 'finished', allowed: ['live', 'successful'] },
      }),
    );

    nav.reset('');
    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} />);

    // The endpoint knows which of its rules refused the request and this page
    // does not, so its wording is what is shown.
    expect(await screen.findByText("'finished' is not a value that status takes.")).toBeInTheDocument();
    expect(screen.getByText('Unknown filter value')).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('says the service could not be reached when there is no problem body', async () => {
    feedMock.mockRejectedValue(new TypeError('Failed to fetch'));

    nav.reset('');
    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} />);

    expect(
      await screen.findByText(/The service could not be reached/),
    ).toBeInTheDocument();
  });

  it('can be retried without inventing a filter nobody chose', async () => {
    feedMock.mockRejectedValueOnce(new ApiError(503, null));
    nav.reset('');

    const user = userEvent.setup();
    render(<DiscoveryView cardCopy={CARD_COPY} locale="en" copy={FEED_COPY} />);

    await screen.findByRole('button', { name: 'Try again' });
    feedMock.mockResolvedValue(FIRST_PAGE);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument());
    expect(nav.read()).toBe('');
  });
});

/* -------------------------------------------------------------------------
 * Structure and keyboard
 * ---------------------------------------------------------------------- */

describe('the rail as a structure', () => {
  it('groups every dimension in a named fieldset', async () => {
    await open();

    // Real `<fieldset>`/`<legend>`, so the rail is named groups a screen-reader
    // user can jump between rather than a soup of divs.
    for (const legend of [
      'Status',
      'Category',
      'Completion',
      'Goal amount',
      'Amount raised',
      'Tags',
    ]) {
      expect(screen.getByRole('group', { name: legend })).toBeInTheDocument();
    }
  });

  it('is a landmark with a name of its own', async () => {
    await open();

    expect(screen.getByRole('form', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Filter projects' })).toBeInTheDocument();
  });

  it('is operable end to end with the keyboard', async () => {
    const user = await open();

    const upcoming = screen.getByRole('checkbox', { name: 'Upcoming' });
    upcoming.focus();
    expect(upcoming).toHaveFocus();

    // Space toggles a real checkbox. Nothing here is a click handler on a div.
    await user.keyboard(' ');
    await waitFor(() => expect(search().get('status')).toBe('upcoming'));

    // And Tab keeps moving through the rail rather than trapping.
    await user.tab();
    expect(document.activeElement).not.toBe(upcoming);
  });

  it('does not offer a filter the service refuses', async () => {
    await open();

    // Location, saved, recommended and featured are representable on the
    // service's query object and refused by every implementation (#47, #44,
    // #48). A control answered with 400 is a promise the interface breaks.
    for (const absent of ['Country', 'City', 'Saved', 'Recommended', 'Featured', 'Near me']) {
      expect(screen.queryByRole('checkbox', { name: absent })).not.toBeInTheDocument();
    }
  });
});

describe('accessibility', () => {
  /**
   * #129. The automated half of §9, over the whole discovery surface with a feed, a rail and
   * an active filter on it — every state a reader actually meets. `src/test-axe.ts` says what
   * this catches and, more importantly, what it cannot: focus order, keyboard reachability
   * and whether a name is the *right* name are judgements, and they are the assertions above.
   */
  it('has no automatically detectable violation, with results and a filter applied', async () => {
    await open('status=live&category=games');

    await expectNoViolations(document.body);
  });

  it('has none in the empty state either, which is a different tree', async () => {
    feedMock.mockResolvedValue({ items: [], nextCursor: null });
    await open('q=nothing-matches-this');

    await expectNoViolations(document.body);
  });
});
