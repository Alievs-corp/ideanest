import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../lib/locale';
import { CampaignScreen } from './campaign-screen';
import type { CampaignTabBody, CampaignTabContext } from './tabs/contract';

/**
 * When a paging tab is asked for its next page — #155. The screen measures to the end of the
 * tab's rows, not of the list: the rewards and the report link under the body must not have to be
 * scrolled through before Updates or Comments load more.
 *
 * <p>The Updates tab is replaced here by one that pages, so the screen's side of the contract is
 * tested without the real tab (which another change builds). Layout is driven by hand: jest has
 * no layout engine, so the list's height, its content height and the footer's are fired as the
 * native events would arrive.
 */

const mockEndReached = jest.fn();

jest.mock('./tabs/updates-tab', () => {
  const { Text: MockText } = require('react-native');
  return {
    useUpdatesTab: (context: CampaignTabContext): CampaignTabBody => ({
      rows: context.active
        ? [{ key: 'u1', render: () => <MockText>Update one</MockText> }]
        : [],
      footer: null,
      onEndReached: context.active ? mockEndReached : null,
      refresh: () => Promise.resolve(),
      loading: false,
    }),
  };
});

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() }),
  useLocalSearchParams: () => ({ tab: 'updates' }),
  useIsFocused: () => true,
}));

jest.setTimeout(30_000);

const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  await act(async () => setLocale('en'));
  mockEndReached.mockClear();
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/projects/aysel/solar-lamp') {
      return json({
        id: ID,
        slug: 'solar-lamp',
        state: 'SUCCESSFUL',
        title: 'Solar Lamp',
        creator: { slug: 'aysel', name: 'Aysel' },
        pledged: { amount: '10.00', currency: 'AZN' },
      });
    }
    if (url.pathname === `/v1/projects/${ID}/rewards/public`) return json({ rewards: [] });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
});

let client: QueryClient;

afterEach(() => client?.clear());

async function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  await render(<CampaignScreen creatorSlug="aysel" projectSlug="solar-lamp" />, { wrapper });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const list = () => screen.getByTestId('campaign-list');

async function measure({ content, footer }: { content: number; footer: number }) {
  await fireEvent(list(), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } },
  });
  await fireEvent(screen.getByTestId('campaign-footer'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: footer } },
  });
  await fireEvent(list(), 'contentSizeChange', 390, content);
}

async function scrollTo(y: number, content: number) {
  await fireEvent.scroll(list(), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: content },
      layoutMeasurement: { width: 390, height: 800 },
    },
  });
}

describe('the next page of a paging tab', () => {
  it('is asked for near the end of the tab’s rows, before the rewards, once per page', async () => {
    await show();
    expect(screen.getByText('Update one')).toBeTruthy();

    // 3000pt of list, the last 1200 of them the rewards and the report: the body ends at 1800.
    await measure({ content: 3_000, footer: 1_200 });
    expect(mockEndReached).not.toHaveBeenCalled();

    await scrollTo(500, 3_000);
    expect(mockEndReached).not.toHaveBeenCalled();

    // The viewport's foot within half a screen (400) of the body's end: ask — while the reader
    // is still in the body, nowhere near the end of the list.
    await scrollTo(650, 3_000);
    expect(mockEndReached).toHaveBeenCalledTimes(1);

    // Not again for the same list, however far the reader goes.
    await scrollTo(1_900, 3_000);
    await scrollTo(700, 3_000);
    expect(mockEndReached).toHaveBeenCalledTimes(1);

    // The page arrived and the list grew: the end moved, and reaching it asks again.
    await fireEvent(list(), 'contentSizeChange', 390, 4_000);
    expect(mockEndReached).toHaveBeenCalledTimes(1);
    await scrollTo(1_700, 4_000);
    expect(mockEndReached).toHaveBeenCalledTimes(2);
  });

  it('asks at once when the tab’s rows end inside the first screen', async () => {
    await show();
    await measure({ content: 1_500, footer: 900 });
    expect(mockEndReached).toHaveBeenCalledTimes(1);
  });
});
