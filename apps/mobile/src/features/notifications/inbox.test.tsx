import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { InboxNotification, InboxPage } from '@ideanest/account/inbox';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { ACCOUNT_KEYS } from '../../lib/account';
import * as inboxApi from './api';
import { InboxScreen } from './inbox-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('./api', () => ({ listNotifications: jest.fn(), markNotificationRead: jest.fn() }));

jest.setTimeout(30_000);

const api = jest.mocked(inboxApi);
const I = en.account.notifications.inbox;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const HOUR = 60 * 60 * 1000;

function row(id: string, extra: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id,
    type: 'GOAL_REACHED',
    category: 'CAMPAIGN',
    params: {
      projectTitle: `Campaign ${id}`,
      creatorSlug: 'maker',
      projectSlug: `camp-${id}`,
      goal: { amount: '500.00', currency: 'AZN' },
    },
    occurredAt: new Date(Date.now() - HOUR).toISOString(),
    ...extra,
  };
}

function page(rows: InboxNotification[], extra: Partial<InboxPage> = {}): InboxPage {
  return {
    notifications: rows,
    unreadCount: rows.filter((r) => r.readAt === undefined || r.readAt === null).length,
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

async function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.spyOn(client, 'invalidateQueries');
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <InboxScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

function rowIds(): string[] {
  return screen
    .getAllByTestId(/^notification-(?!time-|mark-)/)
    .map((node) => String(node.props.testID).replace('notification-', ''));
}

/** Midday in Baku, so "an hour ago" is today and "a day ago" is yesterday whenever this runs. */
const NOW = new Date('2026-08-20T12:00:00+04:00');

beforeEach(async () => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the inbox', () => {
  it('groups rows under Today, Yesterday and the full date', async () => {
    api.listNotifications.mockResolvedValueOnce(
      page([
        row('a'),
        row('b', { occurredAt: new Date(Date.now() - 24 * HOUR).toISOString() }),
        row('c', { occurredAt: '2026-01-14T09:00:00.000Z' }),
      ]),
    );
    await show();

    expect(screen.getByRole('header', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Yesterday' })).toBeTruthy();
    expect(screen.getByRole('header', { name: /14 January 2026/ })).toBeTruthy();
    expect(rowIds()).toEqual(['a', 'b', 'c']);
  });

  it('says each row’s sentence, its category, its time and, in words, that it is unread', async () => {
    api.listNotifications.mockResolvedValueOnce(page([row('a'), row('b', { readAt: '2026-01-01T00:00:00Z' })]));
    await show();

    const unread = screen.getByTestId('notification-a');
    expect(unread.props.accessibilityLabel).toContain('Campaign a reached its goal of 500.00 AZN');
    expect(unread.props.accessibilityLabel).toContain(en.account.notifications.category.CAMPAIGN);
    expect(unread.props.accessibilityLabel).toContain(I.unreadWord);
    expect(unread.props.accessibilityRole).toBe('link');
    expect(unread.props.accessibilityHint).toMatch(/\d{2}:\d{2}/);
    expect(screen.getByTestId('notification-b').props.accessibilityLabel).not.toContain(I.unreadWord);
    expect(screen.getByTestId('inbox-unread')).toHaveTextContent('1 unread');
  });

  it('draws a row without a destination as text, not as a disabled button', async () => {
    api.listNotifications.mockResolvedValueOnce(page([row('a', { params: {} })]));
    await show();

    const plain = screen.getByTestId('notification-a');
    expect(plain.props.accessibilityRole).toBeUndefined();
    expect(plain.props.accessibilityState?.disabled).toBeUndefined();
  });

  it('filters the loaded rows by unread and by category, and says when nothing matches', async () => {
    api.listNotifications.mockResolvedValueOnce(
      page([
        row('a'),
        row('b', { readAt: '2026-01-01T00:00:00Z' }),
        row('c', { type: 'PAYMENT_FAILED', category: 'PAYMENTS' }),
      ]),
    );
    await show();

    const toggle = screen.getByRole('button', { name: I.unreadOnly });
    expect(toggle.props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(toggle);
    expect(screen.getByRole('button', { name: I.unreadOnly }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(rowIds()).toEqual(['a', 'c']);

    await fireEvent.press(screen.getByRole('button', { name: en.account.notifications.category.PAYMENTS }));
    expect(rowIds()).toEqual(['c']);
    expect(
      screen.getByRole('button', { name: en.account.notifications.category.PAYMENTS }).props.accessibilityState,
    ).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole('button', { name: en.account.notifications.category.SECURITY }));
    expect(screen.getByText(I.filteredTitle)).toBeTruthy();
    expect(screen.queryByText(I.emptyTitle)).toBeNull();
  });

  it('names the category row and offers All and the seven categories in order', async () => {
    api.listNotifications.mockResolvedValueOnce(page([row('a')]));
    await show();

    const filters = screen.getByTestId('inbox-filters');
    expect(filters.props.accessibilityLabel).toBe(I.filterLabel);
    expect(within(filters).getAllByRole('button').map((node) => node.props.accessibilityLabel)).toEqual([
      I.all,
      ...['PLEDGES', 'CAMPAIGN', 'PAYMENTS', 'COMMUNITY', 'REWARDS', 'DISCOVERY', 'SECURITY'].map(
        (category) => en.account.notifications.category[category as 'PLEDGES'],
      ),
    ]);
  });

  it('reads the next page by before and beforeId, once per cursor', async () => {
    api.listNotifications
      .mockResolvedValueOnce(page([row('a')], { nextCursor: '2026-10-01T10:00:00Z', nextCursorId: 'id-a' }))
      .mockResolvedValueOnce(page([row('b')]));
    await show();

    await fireEvent(screen.getByTestId('inbox'), 'endReached');
    await fireEvent(screen.getByTestId('inbox'), 'endReached');
    await settle();

    expect(api.listNotifications).toHaveBeenCalledTimes(2);
    expect(api.listNotifications).toHaveBeenNthCalledWith(
      2,
      { before: '2026-10-01T10:00:00Z', beforeId: 'id-a' },
      expect.anything(),
    );
    expect(rowIds()).toEqual(['a', 'b']);
  });

  it('shows a retry row when the next page fails, and retries the same cursor', async () => {
    api.listNotifications
      .mockResolvedValueOnce(page([row('a')], { nextCursor: 't', nextCursorId: 'i' }))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(page([row('b')]));
    await show();

    await fireEvent(screen.getByTestId('inbox'), 'endReached');
    await settle();
    expect(screen.getByTestId('inbox-next-failed')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('inbox-next-retry'));
    await settle();
    expect(api.listNotifications).toHaveBeenLastCalledWith({ before: 't', beforeId: 'i' }, expect.anything());
    expect(rowIds()).toEqual(['a', 'b']);
  });

  it('marks a row read only once the service answers, then lowers the count', async () => {
    api.listNotifications.mockResolvedValueOnce(page([row('a'), row('b')]));
    let answer: (value: InboxNotification) => void = () => {};
    api.markNotificationRead.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await show();
    expect(screen.getByTestId('inbox-unread')).toHaveTextContent('2 unread');

    await fireEvent.press(screen.getByTestId('notification-mark-a'));
    expect(api.markNotificationRead).toHaveBeenCalledWith('a');
    // Not optimistic: still unread, and the button says it is working.
    expect(screen.getByTestId('notification-a').props.accessibilityLabel).toContain(I.unreadWord);
    expect(screen.getByTestId('notification-mark-a').props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByTestId('inbox-unread')).toHaveTextContent('2 unread');

    await act(async () => answer({ ...row('a'), readAt: '2026-10-06T10:00:00Z' }));
    await settle();

    expect(screen.getByTestId('notification-a').props.accessibilityLabel).not.toContain(I.unreadWord);
    expect(screen.queryByTestId('notification-mark-a')).toBeNull();
    expect(screen.getByTestId('inbox-unread')).toHaveTextContent('1 unread');
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ACCOUNT_KEYS.unread });
  });

  it('says why a mark-read was refused and leaves the row as it was', async () => {
    api.listNotifications.mockResolvedValueOnce(page([row('a')]));
    api.markNotificationRead.mockRejectedValueOnce(new ApiError(500, { type: 'about:blank', title: '', status: 500 }));
    await show();

    await fireEvent.press(screen.getByTestId('notification-mark-a'));
    await settle();

    expect(screen.getByTestId('inbox-error')).toBeTruthy();
    expect(screen.getByText(I.errorTitle)).toBeTruthy();
    expect(screen.getByTestId('notification-a').props.accessibilityLabel).toContain(I.unreadWord);
  });

  it('opens a row’s destination and marks it read on the way', async () => {
    api.listNotifications.mockResolvedValueOnce(
      page([row('a'), row('s', { type: 'NEW_DEVICE_SIGN_IN', category: 'SECURITY', params: {} })]),
    );
    api.markNotificationRead.mockResolvedValue({ ...row('a'), readAt: '2026-10-06T10:00:00Z' });
    await show();

    await fireEvent.press(screen.getByTestId('notification-a'));
    expect(mockRouter.push).toHaveBeenCalledWith('/projects/maker/camp-a');
    expect(api.markNotificationRead).toHaveBeenCalledWith('a');

    await fireEvent.press(screen.getByTestId('notification-s'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/settings/sessions');
  });

  it('reloads from the newest page on pull to refresh', async () => {
    api.listNotifications
      .mockResolvedValueOnce(page([row('a')], { nextCursor: 't', nextCursorId: 'i' }))
      .mockResolvedValueOnce(page([row('new'), row('a')]));
    await show();

    const control = screen.getByTestId('inbox').props.refreshControl as { props: { onRefresh: () => void } };
    await act(async () => control.props.onRefresh());
    await settle();

    expect(api.listNotifications).toHaveBeenLastCalledWith(null);
    expect([...rowIds()].sort()).toEqual(['a', 'new']);
    // The pages read before were replaced by the newest one, which has no next cursor.
    await fireEvent(screen.getByTestId('inbox'), 'endReached');
    await settle();
    expect(api.listNotifications).toHaveBeenCalledTimes(2);
  });

  it('links the intro to the notification settings', async () => {
    api.listNotifications.mockResolvedValueOnce(page([row('a')]));
    await show();

    await fireEvent.press(screen.getByTestId('inbox-settings-link'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/notifications');
  });
});

describe('the states around the list', () => {
  it('shows four skeleton rows, announced, while the first page loads', async () => {
    api.listNotifications.mockReturnValue(new Promise(() => {}));
    await show();

    expect(screen.getByLabelText(I.loadingList)).toBeTruthy();
  });

  it('says there is nothing yet for an empty inbox', async () => {
    api.listNotifications.mockResolvedValueOnce(page([]));
    await show();

    expect(screen.getByText(I.emptyTitle)).toBeTruthy();
    expect(screen.getByText(I.emptyBody)).toBeTruthy();
  });

  it('offers to try again when the first page could not be read', async () => {
    api.listNotifications
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(page([row('a')]));
    await show();

    expect(screen.getByText(I.unreachable)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.common.tryAgain }));
    await settle();
    expect(rowIds()).toEqual(['a']);
  });

  it('keeps what it read when offline, says so, and waits to mark anything read', async () => {
    api.listNotifications
      .mockResolvedValueOnce(page([row('a')]))
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    await show();

    await act(async () => setOnline(false));
    const control = screen.getByTestId('inbox').props.refreshControl as { props: { onRefresh: () => void } };
    await act(async () => control.props.onRefresh());
    await settle();

    expect(screen.getByTestId('inbox-stale')).toBeTruthy();
    expect(rowIds()).toEqual(['a']);
    const mark = screen.getByTestId('notification-mark-a');
    expect(mark.props.accessibilityState).toMatchObject({ disabled: true });
    expect(mark.props.accessibilityHint).toBe(en.mobile.notifications.offline);
  });

  it('asks a signed-out reader to sign in, coming back to the inbox', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(api.listNotifications).not.toHaveBeenCalled();
    expect(screen.getByText(I.signedOut)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.actions.signIn }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/notifications' },
    });
  });
});
