import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccessibilityInfo, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as WebBrowser from 'expo-web-browser';
import type { BackerFulfilment, Fulfilment } from '@ideanest/account/fulfilment';
import { ApiError } from '@ideanest/api-client';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { queryKeys } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { DeliveriesScreen } from './delivery-list';
import { deliveryFrom } from './deliveries-api';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockGet = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../api/client', () => ({
  api: () => ({ get: mockGet }),
  sendJson: jest.fn(),
  traceIdOfError: () => null,
}));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const CATALOGUES = { az, en, ru, tr } as const;
type LocaleName = keyof typeof CATALOGUES;
const D = en.account.fulfilment.deliveries;

function row(pledgeId: string, parcel: Partial<Fulfilment> = {}, extra: Partial<BackerFulfilment> = {}): BackerFulfilment {
  return {
    projectId: 'project-1',
    projectTitle: `Campaign ${pledgeId}`,
    projectSlug: 'lamp',
    creatorSlug: 'maker',
    fulfilment: {
      pledgeId,
      status: 'PREPARING',
      carrier: null,
      trackingNumber: null,
      trackingUrl: null,
      shippedAt: null,
      deliveredAt: null,
      updatedAt: null,
      ...parcel,
    },
    ...extra,
  };
}

let client: QueryClient;

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show({ locale = 'en', seed }: { locale?: LocaleName; seed?: readonly BackerFulfilment[] } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  if (seed !== undefined) client.setQueryData(queryKeys.fulfilments(), seed);
  await act(async () => setLocale(locale));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale={locale} messages={CATALOGUES[locale]}>
          <DeliveriesScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

function answer(rows: readonly BackerFulfilment[]) {
  mockGet.mockResolvedValueOnce({ fulfilments: rows });
}

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReset();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

describe('DeliveriesScreen states', () => {
  it('shows three skeleton cards, named, while the list loads', async () => {
    mockGet.mockReturnValueOnce(new Promise(() => {}));
    await show();

    expect(screen.getByTestId('deliveries-loading').props.accessibilityLabel).toBe(D.loading);
    expect(screen.getByText(en.account.pages.deliveries.title)).toBeTruthy();
  });

  it('says nothing is on its way, with a way to browse', async () => {
    answer([]);
    await show();

    expect(screen.getByText(D.emptyTitle)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(D.emptyAction));
    expect(mockRouter.push).toHaveBeenCalledWith('/discover');
  });

  it('names the failure, with the service’s reason when it gave one, and retries', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(500, { status: 500, title: 'Broken.' }));
    answer([row('a')]);
    await show();

    expect(screen.getByText(D.failedTitle)).toBeTruthy();
    expect(screen.getByText('Broken.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.getByTestId('delivery-a')).toBeTruthy();
  });

  it('offline, shows the cached list with a notice', async () => {
    setOnline(false);
    mockGet.mockRejectedValue(new Error('offline'));
    await show({ seed: [row('a')] });

    expect(screen.getByText(en.mobile.deliveries.stale)).toBeTruthy();
    expect(screen.getByTestId('delivery-a')).toBeTruthy();
  });

  it('offline with nothing cached says so rather than loading for ever', async () => {
    setOnline(false);
    mockGet.mockRejectedValueOnce(new Error('offline'));
    await show();
    expect(screen.getByText(en.mobile.offline.nothingCached)).toBeTruthy();
  });

  it('signed out, asks to sign in and comes back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByText(en.mobile.deliveries.signedOutTitle)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.shell.actions.signIn));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/account/deliveries' } });
  });

  it('reloads on pull to refresh', async () => {
    answer([row('a')]);
    answer([row('a'), row('b')]);
    await show();
    const control = screen.getByTestId('deliveries').props.refreshControl as { props: { onRefresh: () => void } };
    await act(async () => control.props.onRefresh());
    await settle();

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('delivery-b')).toBeTruthy();
  });
});

describe('DeliveryCard', () => {
  it.each([
    ['PREPARING', 'Preparing'],
    ['SHIPPED', 'On its way'],
    ['DELIVERED', 'Delivered'],
    ['RETURNED', 'Came back'],
  ] as const)('labels %s in words, with its sentence', async (status, label) => {
    answer([row('a', { status })]);
    await show();

    expect(within(screen.getByTestId('delivery-a-status')).getByText(label)).toBeTruthy();
    expect(screen.getByText(en.account.fulfilment.statusDetail[status])).toBeTruthy();
  });

  it.each(['az', 'ru', 'tr'] as const)('labels every status from the %s catalogue', async (locale) => {
    const statuses = ['PREPARING', 'SHIPPED', 'DELIVERED', 'RETURNED'] as const;
    answer(statuses.map((status) => row(status, { status })));
    await show({ locale });

    for (const status of statuses) {
      const label = CATALOGUES[locale].account.fulfilment.status[status];
      expect(within(screen.getByTestId(`delivery-${status}-status`)).getByText(label)).toBeTruthy();
    }
  });

  it('shows a status this build does not know as the service’s own word', async () => {
    answer([row('a', { status: 'LOST_IN_TRANSIT' })]);
    await show();

    expect(within(screen.getByTestId('delivery-a-status')).getByText('LOST_IN_TRANSIT')).toBeTruthy();
    expect(screen.getByText(en.account.fulfilment.statusDetail.unknown)).toBeTruthy();
  });

  it('opens an https tracking link in the in-app browser, never through Linking', async () => {
    const openURL = jest.spyOn(Linking, 'openURL');
    answer([row('a', { status: 'SHIPPED', carrier: 'AzerPost', trackingNumber: 'AB123', trackingUrl: 'https://carrier.example/t/AB123' })]);
    await show();

    const link = screen.getByTestId('delivery-a-tracking-link');
    expect(link.props.accessibilityRole).toBe('link');
    expect(link.props.accessibilityLabel).toBe('AB123');
    expect(link.props.accessibilityHint).toBe(en.mobile.deliveries.trackingHint);
    await fireEvent.press(link);

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://carrier.example/t/AB123');
    expect(openURL).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`${D.carrier}, AzerPost`)).toBeTruthy();
  });

  it.each(['javascript:alert(document.cookie)', 'ftp://carrier.example/t/AB123', 'data:text/html,hi', 'AB123'])(
    'shows the tracking number as text, not a link, for %s',
    async (trackingUrl) => {
      answer([row('a', { status: 'SHIPPED', trackingNumber: 'AB123', trackingUrl })]);
      await show();

      expect(screen.queryByTestId('delivery-a-tracking-link')).toBeNull();
      expect(screen.getByTestId('delivery-a-tracking-text').props.accessibilityLabel).toBe(`${D.tracking}, AB123`);
      expect(screen.queryAllByRole('link').map((node) => node.props.accessibilityLabel)).not.toContain('AB123');
    },
  );

  it('renders still under Reduce Motion, links working', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    answer([row('a')]);
    await show();

    await fireEvent.press(screen.getByTestId('delivery-a-address'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/pledges/[id]/address', params: { id: 'a' } });
  });

  it('dates the sending and the arrival', async () => {
    answer([row('a', { status: 'DELIVERED', shippedAt: '2026-09-01T08:00:00Z', deliveredAt: '2026-09-04T12:30:00Z' })]);
    await show();

    expect(screen.getByLabelText(/^Sent, 1 Sept 2026/)).toBeTruthy();
    expect(screen.getByLabelText(/^Arrived, 4 Sept 2026/)).toBeTruthy();
  });

  it('links to the pledge’s address and to the campaign', async () => {
    answer([row('pl-1')]);
    await show();

    const address = screen.getByTestId('delivery-pl-1-address');
    expect(address.props.accessibilityLabel).toBe(D.shippingAddress);
    await fireEvent.press(address);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/pledges/[id]/address', params: { id: 'pl-1' } });

    await fireEvent.press(screen.getByTestId('delivery-pl-1-campaign'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/projects/[creatorSlug]/[projectSlug]',
      params: { creatorSlug: 'maker', projectSlug: 'lamp' },
    });
  });

  it('keeps a removed campaign’s parcel, with no campaign link', async () => {
    answer([row('a', {}, { projectTitle: null, projectSlug: null, creatorSlug: null })]);
    await show();

    expect(screen.getByText(D.unlisted)).toBeTruthy();
    expect(screen.queryByTestId('delivery-a-campaign')).toBeNull();
    expect(screen.getByTestId('delivery-a-address')).toBeTruthy();
  });
});

describe('deliveryFrom', () => {
  it('reads absent fields as null, the shared shape', () => {
    expect(deliveryFrom({ projectId: 'p', fulfilment: { pledgeId: 'x', status: 'SHIPPED' } })).toEqual({
      projectId: 'p',
      projectTitle: null,
      projectSlug: null,
      creatorSlug: null,
      fulfilment: {
        pledgeId: 'x',
        status: 'SHIPPED',
        carrier: null,
        trackingNumber: null,
        trackingUrl: null,
        shippedAt: null,
        deliveredAt: null,
        updatedAt: null,
      },
    });
  });
});
