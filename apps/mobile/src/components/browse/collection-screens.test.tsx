/*
 * A device east of Greenwich, set before anything formats a date: 23:30 UTC on the 31st is
 * already the 1st here, so a window date that followed the device's zone would fail below.
 */
process.env.TZ = 'Asia/Baku';

import type { ReactElement, ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { collectionFrom, type WireCollection } from '@ideanest/discovery/collections';
import { setLocale } from '../../lib/locale';
import { CollectionCard } from './collection-card';
import { CollectionHeader } from './collection-header';
import { CollectionIndex } from './collection-index';
import { CollectionPage } from './collection-page';

/**
 * The collection screens — issue #154: the card and the header (the facts in the web's order,
 * dates in UTC, an unknown kind left unlabelled, the badge's two sentences), the index, and one
 * collection paging in place without asking for one cursor twice.
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const React = require('react');
  const hrefOf = (href: unknown): string => {
    if (typeof href === 'string') return href;
    const { pathname = '', params = {} } = href as {
      pathname?: string;
      params?: Record<string, string>;
    };
    let path = pathname;
    for (const [name, value] of Object.entries(params)) path = path.replace(`[${name}]`, value);
    return path;
  };
  return {
    Link: ({ children, href }: { children: ReactNode; href: unknown }) =>
      React.createElement(View, { testID: `href:${hrefOf(href)}` }, children),
    Stack: Object.assign(() => null, { Screen: () => null }),
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), setParams: jest.fn() }),
    useLocalSearchParams: () => ({}),
  };
});

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const C = en.discovery.collections;

const SPRING: WireCollection = {
  id: 'k1',
  slug: 'spring-picks',
  kind: 'open_call',
  title: 'Spring picks',
  description: 'Campaigns for the spring.',
  grantsBadge: true,
  projectCount: 12,
  opensAt: '2026-09-01T00:00:00Z',
  // 23:30 UTC on the 31st is already 1 November in Baku. The window says the 31st everywhere.
  closesAt: '2026-10-31T23:30:00Z',
  image: { url: 'https://cdn.example/spring.jpg', width: 1600, height: 900 },
};

function card(title: string, index: number) {
  return {
    id: `c-${index}`,
    slug: `campaign-${index}`,
    creatorSlug: 'aysel',
    creator: { name: 'Aysel', slug: 'aysel' },
    title,
    state: 'LIVE',
    badge: 'live',
    completionPercent: '40',
    pledged: { amount: '1000.00', currency: 'AZN' },
    backersCount: 3,
    daysLeft: 12,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
const fail = () => Promise.reject(new TypeError('Network request failed'));

type Route = (url: URL) => Response | Promise<Response>;
let routes: { index: Route; collection: Route };
let requests: URL[];
let client: QueryClient;

beforeEach(async () => {
  // The dates follow the app's language, which is a store of its own rather than the provider's.
  await act(async () => setLocale('en'));
  mockPush.mockReset();
  requests = [];
  routes = {
    index: () => json({ items: [SPRING, { ...SPRING, id: 'k2', slug: 'staff', kind: 'staff_selection', title: 'Staff picks' }] }),
    collection: (url) =>
      url.searchParams.has('cursor')
        ? json({ collection: SPRING, items: [card('Kite', 1)] })
        : json({ collection: SPRING, items: [card('Solar Lamp', 0)], nextCursor: 'c1' }),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname.endsWith('/v1/collections')) return routes.index(url);
    if (url.pathname.includes('/v1/collections/')) return routes.collection(url);
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => client?.clear());

async function show(ui: ReactElement) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {ui}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return view;
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const collection = (overrides: Partial<WireCollection> = {}) =>
  collectionFrom({ ...SPRING, ...overrides })!;
const facts = () => screen.getAllByTestId('collection-fact').map((fact) => fact.props.accessibilityLabel);

describe('the collection card', () => {
  it('is one link to the collection, named by its title', async () => {
    await show(<CollectionCard collection={collection()} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Spring picks' })).toBeTruthy();
    expect(screen.getByTestId('href:/collections/spring-picks')).toBeTruthy();
  });

  it('states the count, then when it closes, then since when it is open — in UTC', async () => {
    await show(<CollectionCard collection={collection()} />);
    expect(facts()).toEqual([
      'Campaigns, 12',
      'Closes, 31 October 2026',
      'Open since, 1 September 2026',
    ]);
    // On this device the same instant is the 1st: the card is not reading the device's zone.
    expect(new Date('2026-10-31T23:30:00Z').getDate()).toBe(1);
  });

  it('writes the date in the app’s language, Azerbaijani included', async () => {
    await act(async () => setLocale('az'));
    await show(<CollectionCard collection={collection()} />);
    expect(facts()[1]).toBe('Closes, 31 oktyabr 2026');
  });

  it('drops a date that will not parse, rather than printing it', async () => {
    await show(<CollectionCard collection={collection({ closesAt: 'soon' })} />);
    expect(facts()).toEqual(['Campaigns, 12', 'Open since, 1 September 2026']);
  });

  it('labels a known kind, and an unknown kind not at all', async () => {
    const view = await show(<CollectionCard collection={collection()} />);
    expect(screen.getByText(C.kinds.open_call)).toBeTruthy();
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <IntlProvider locale="en" messages={en}>
          <CollectionCard collection={collection({ kind: 'festival' })} />
        </IntlProvider>
      </SafeAreaProvider>,
    );
    expect(screen.queryByTestId('collection-kind')).toBeNull();
    expect(screen.queryByText('festival')).toBeNull();
  });
});

describe('the collection header', () => {
  it('reads the trail, the kind, the title, the standfirst, the sentence, the facts, the cover', async () => {
    await show(<CollectionHeader collection={collection()} />);
    const trail = screen.getByLabelText('Breadcrumb');
    expect(within(trail).getByRole('link', { name: 'Collections' })).toBeTruthy();
    expect(within(trail).getByText('Spring picks')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Spring picks' })).toBeTruthy();
    expect(screen.getByText(C.sentences.open_call)).toBeTruthy();
    expect(facts()).toEqual([
      'In this collection, 12 campaigns',
      'Closes, 31 October 2026',
      'Open since, 1 September 2026',
    ]);
    // The cover comes after the text, so reading order is visual order.
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('"collection-facts"')).toBeGreaterThan(-1);
    expect(tree.indexOf('"collection-cover"')).toBeGreaterThan(tree.indexOf('"collection-facts"'));
  });

  it('says membership is what an open call grants', async () => {
    await show(<CollectionHeader collection={collection()} />);
    expect(screen.getByTestId('collection-badge')).toHaveTextContent(`${C.badge} ${C.badgeOpenCall}`);
  });

  it('says a themed collection is a selection, not a guarantee', async () => {
    await show(<CollectionHeader collection={collection({ kind: 'themed' })} />);
    expect(screen.getByTestId('collection-badge')).toHaveTextContent(`${C.badge} ${C.badgeCurated}`);
  });

  it('has no tag and no sentence for a kind this build does not know, and no badge unless granted', async () => {
    await show(<CollectionHeader collection={collection({ kind: 'festival', grantsBadge: false })} />);
    expect(screen.queryByTestId('collection-kind')).toBeNull();
    expect(screen.queryByTestId('collection-sentence')).toBeNull();
    expect(screen.queryByTestId('collection-badge')).toBeNull();
  });
});

describe('the collections index', () => {
  it('lists the collections in the curator’s order, under the list’s name', async () => {
    await show(<CollectionIndex />);
    const list = screen.getByLabelText(C.listLabel);
    expect(within(list).getAllByRole('link').map((link) => link.props.accessibilityLabel)).toEqual([
      'Spring picks',
      'Staff picks',
    ]);
  });

  it('offers the feed when nothing is curated, and a retry too when the read failed', async () => {
    routes.index = () => json({ items: [] });
    await show(<CollectionIndex />);
    expect(screen.getByText(C.emptyTitle)).toBeTruthy();
    expect(screen.queryByTestId('collections-retry')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: C.emptyAction }));
    expect(mockPush).toHaveBeenCalledWith('/discover');

    client.clear();
    routes.index = fail;
    await show(<CollectionIndex />);
    expect(screen.getByTestId('collections-retry')).toBeTruthy();
  });
});

describe('one collection', () => {
  const pages = () => requests.filter((url) => url.pathname.endsWith('/v1/collections/spring-picks'));

  it('asks for the first page with limit as the contract’s string, and no cursor', async () => {
    await show(<CollectionPage slug="spring-picks" />);
    expect(pages()).toHaveLength(1);
    expect(pages()[0]?.searchParams.get('limit')).toBe('24');
    expect(pages()[0]?.searchParams.has('cursor')).toBe(false);
    expect(screen.getByTestId('collection-count')).toHaveTextContent('1 campaign shown, with more to load');
  });

  it('appends the next page on Show more, named for the collection', async () => {
    await show(<CollectionPage slug="spring-picks" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Show more campaigns in Spring picks' }));
    await settle();
    expect(pages()[1]?.searchParams.get('cursor')).toBe('c1');
    expect(pages()[1]?.searchParams.get('limit')).toBe('24');
    expect(screen.getByRole('link', { name: /Solar Lamp/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Kite/ })).toBeTruthy();
    expect(screen.getByTestId('collection-count')).toHaveTextContent('2 campaigns shown');
    expect(screen.queryByTestId('show-more')).toBeNull();
  });

  it('is disabled while a page loads, and never asks for one cursor twice', async () => {
    let release: (response: Response) => void = () => {};
    routes.collection = (url) =>
      url.searchParams.has('cursor')
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : json({ collection: SPRING, items: [card('Solar Lamp', 0)], nextCursor: 'c1' });

    await show(<CollectionPage slug="spring-picks" />);
    const more = screen.getByTestId('show-more');
    await fireEvent.press(more);
    await fireEvent.press(more);
    await settle();
    expect(screen.getByTestId('show-more')).toBeDisabled();
    expect(screen.getByTestId('show-more')).toHaveTextContent(C.loading);
    await fireEvent.press(screen.getByTestId('show-more'));
    expect(pages().filter((url) => url.searchParams.get('cursor') === 'c1')).toHaveLength(1);

    await act(async () => release(json({ collection: SPRING, items: [card('Kite', 1)] })));
    await settle();
    expect(screen.getByRole('link', { name: /Kite/ })).toBeTruthy();
  });

  it('keeps the cards it has, and says the next page did not load, when it failed', async () => {
    routes.collection = (url) =>
      url.searchParams.has('cursor')
        ? problem(500, { title: 'Unavailable', detail: 'The collection service is restarting.' })
        : json({ collection: SPRING, items: [card('Solar Lamp', 0)], nextCursor: 'c1' });

    await show(<CollectionPage slug="spring-picks" />);
    await fireEvent.press(screen.getByTestId('show-more'));
    await settle();
    const alert = screen.getByTestId('next-page-error');
    expect(within(alert).getByText(C.nextFailedTitle)).toBeTruthy();
    expect(within(alert).getByText('The collection service is restarting.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Solar Lamp/ })).toBeTruthy();
    // The button stays, and is how the page is retried.
    expect(screen.getByTestId('show-more')).not.toBeDisabled();

    routes.collection = (url) =>
      url.searchParams.has('cursor')
        ? json({ collection: SPRING, items: [card('Kite', 1)] })
        : json({ collection: SPRING, items: [card('Solar Lamp', 0)], nextCursor: 'c1' });
    await fireEvent.press(screen.getByTestId('show-more'));
    await settle();
    expect(pages().filter((url) => url.searchParams.get('cursor') === 'c1')).toHaveLength(2);
    expect(screen.queryByTestId('next-page-error')).toBeNull();
    expect(screen.getByRole('link', { name: /Kite/ })).toBeTruthy();
  });

  it('pages again after a refresh hands back the cursor that had failed', async () => {
    let nextFails = true;
    routes.collection = (url) =>
      url.searchParams.has('cursor')
        ? nextFails
          ? fail()
          : json({ collection: SPRING, items: [card('Kite', 1)] })
        : json({ collection: SPRING, items: [card('Solar Lamp', 0)], nextCursor: 'c1' });

    await show(<CollectionPage slug="spring-picks" />);
    await fireEvent.press(screen.getByTestId('show-more'));
    await settle();
    expect(screen.getByTestId('next-page-error')).toBeTruthy();

    // A pull, or a reconnect: the first page again, with the same cursor (the service buckets it).
    nextFails = false;
    await act(async () => {
      await client.refetchQueries();
    });
    await settle();
    expect(screen.queryByTestId('next-page-error')).toBeNull();

    await fireEvent.press(screen.getByTestId('show-more'));
    await settle();
    expect(screen.getByRole('link', { name: /Kite/ })).toBeTruthy();
  });

  it('is the not-found screen when the service answers 404', async () => {
    routes.collection = () => problem(404, { title: 'Not Found' });
    await show(<CollectionPage slug="spring-picks" />);
    expect(screen.getByTestId('collection-not-found')).toBeTruthy();
  });

  it('is an error with retry, not "not found", when the service could not be reached', async () => {
    routes.collection = fail;
    await show(<CollectionPage slug="spring-picks" />);
    expect(screen.getByTestId('collection-error')).toBeTruthy();
    expect(screen.queryByTestId('collection-not-found')).toBeNull();
  });

  it('says nothing is published in it yet, and offers the feed, when it has no campaigns', async () => {
    routes.collection = () => json({ collection: SPRING, items: [] });
    await show(<CollectionPage slug="spring-picks" />);
    expect(screen.getByText(C.campaignsEmptyTitle)).toBeTruthy();
    expect(
      screen.getByText('No campaign in Spring picks is published at the moment. The feed carries every campaign on the platform.'),
    ).toBeTruthy();
  });
});
