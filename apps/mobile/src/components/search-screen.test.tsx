import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import SearchScreen from '../app/(tabs)/search';

/**
 * The Search tab's field — issue #151's review: the field is drawn once, above every state, so the
 * input survives a search going from typing to loading to results, and the keyboard stays up.
 *
 * <p>Here rather than beside `app/(tabs)/search.tsx` because every file under `src/app` is a route
 * to Expo Router, and a test file there would be offered as a screen.
 */

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/* The screen, FlashList and the kit load on the first render; slow on a cold runner. */
jest.setTimeout(30_000);

const LABEL = en.discovery.suggest.inputLabel;
const LOADING = en.discovery.feed.loading;

function feed(titles: readonly string[]) {
  return {
    items: titles.map((title, index) => ({
      id: `campaign-${title}-${index}`,
      slug: `campaign-${index}`,
      creatorSlug: 'aysel',
      creator: { name: 'Aysel', slug: 'aysel' },
      title,
      completionPercent: '40',
      pledged: { amount: '1000.00', currency: 'AZN' },
      goal: { amount: '2500.00', currency: 'AZN' },
      daysLeft: 12,
    })),
    nextCursor: null,
  };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** Search answers wait for the test to release them, one per request, in order. */
let pending: ((response: Response) => void)[] = [];
let client: QueryClient;

afterEach(() => {
  // Nothing left waiting and no cache timers, so jest can exit when the suite ends.
  client.clear();
  pending = [];
});

beforeEach(() => {
  pending = [];
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/v1/search/suggest')) return Promise.resolve(json({ items: [] }));
    return new Promise<Response>((resolve) => pending.push(resolve));
  }) as unknown as typeof fetch;
});

async function renderSearch() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <SearchScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

async function answer(titles: readonly string[]) {
  await act(async () => {
    pending.shift()?.(json(feed(titles)));
  });
}

describe('the Search tab', () => {
  it('keeps one input through typing, loading and results', async () => {
    await renderSearch();
    const input = screen.getByLabelText(LABEL);

    // The third character starts the first search: the placeholders stand in under the field.
    await fireEvent.changeText(input, 'sol');
    expect(screen.getByLabelText(LOADING)).toBeTruthy();
    expect(screen.getByLabelText(LABEL)).toBe(input);

    await answer(['Solar lamp']);
    expect(screen.getByText('Solar lamp')).toBeTruthy();
    expect(screen.getByLabelText(LABEL)).toBe(input);

    // The next key is a new query. The last results stay while it loads — no skeleton — and the
    // input is still the same one.
    await fireEvent.changeText(input, 'sola');
    expect(screen.queryByLabelText(LOADING)).toBeNull();
    expect(screen.getByText('Solar lamp')).toBeTruthy();
    expect(screen.getByLabelText(LABEL)).toBe(input);

    await answer(['Solar oven']);
    expect(screen.getByText('Solar oven')).toBeTruthy();
    expect(screen.getByLabelText(LABEL)).toBe(input);
    expect(screen.getByLabelText(LABEL).props.value).toBe('sola');
  });
});
