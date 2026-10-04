import { AppState, type AppStateStatus } from 'react-native';
import { act, render, renderHook, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import type { TestInstance } from 'test-renderer';
import en from '@ideanest/messages/en.json';
import { realtimeUrl } from '@ideanest/campaign/realtime';
import { useAppActive } from '../../lib/app-active';
import { setLocale } from '../../lib/locale';
import { useCampaignUpdates } from '../../lib/use-campaign-updates';
import { LiveFunding } from './live-funding';

/**
 * The live counter — issue #155's realtime tests on React Native: the reconnect schedule and its
 * cap with a mocked `WebSocket`, the socket closed in the background and reopened on return, no
 * socket without an origin, and the frames added to the page's figure with `decimal.js`.
 */

class MockSocket {
  static instances: MockSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    MockSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  /** The server going away, or a connection that never opened. */
  drop() {
    this.onclose?.();
  }
}

const URL_ = 'wss://realtime.test.invalid/v1/realtime?channel=project%3Ap1';
const latest = () => MockSocket.instances[MockSocket.instances.length - 1] as MockSocket;
const frame = (amount: string, currency = 'AZN') =>
  JSON.stringify({ channel: 'project:p1', pledges: 1, amount: { amount, currency }, comments: 0 });

let original: typeof WebSocket;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  MockSocket.instances = [];
  original = global.WebSocket;
  global.WebSocket = MockSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  global.WebSocket = original;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useCampaignUpdates', () => {
  it('opens nothing without an origin', async () => {
    expect(realtimeUrl(undefined, 'project:p1')).toBeNull();
    await renderHook(() => useCampaignUpdates(null, true));
    expect(MockSocket.instances).toHaveLength(0);
  });

  it('reconnects after 1, 2, 4, 8, 16 and 32 seconds, then gives up', async () => {
    jest.useFakeTimers();
    await renderHook(() => useCampaignUpdates(URL_, true));
    expect(MockSocket.instances).toHaveLength(1);
    expect(latest().url).toBe(URL_);

    for (const wait of [1_000, 2_000, 4_000, 8_000, 16_000, 32_000]) {
      await act(async () => latest().drop());
      const before = MockSocket.instances.length;
      await act(async () => jest.advanceTimersByTime(wait - 1));
      expect(MockSocket.instances).toHaveLength(before);
      await act(async () => jest.advanceTimersByTime(1));
      expect(MockSocket.instances).toHaveLength(before + 1);
    }

    // Six attempts made: the seventh close is the last.
    await act(async () => latest().drop());
    await act(async () => jest.advanceTimersByTime(120_000));
    expect(MockSocket.instances).toHaveLength(7);
  });

  it('starts the schedule again after a successful open', async () => {
    jest.useFakeTimers();
    await renderHook(() => useCampaignUpdates(URL_, true));
    await act(async () => latest().drop());
    await act(async () => jest.advanceTimersByTime(1_000));
    await act(async () => latest().drop());
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(MockSocket.instances).toHaveLength(3);

    await act(async () => latest().onopen?.());
    await act(async () => latest().drop());
    // Back to the first step: one second, not four.
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(MockSocket.instances).toHaveLength(4);
  });

  it('keeps the frames it can read and drops the rest', async () => {
    const { result } = await renderHook(() => useCampaignUpdates(URL_, true));
    await act(async () => latest().onopen?.());
    await act(async () => latest().onmessage?.({ data: frame('10.00') }));
    await act(async () => latest().onmessage?.({ data: 'not json' }));
    await act(async () => latest().onmessage?.({ data: frame('1e3') }));
    await act(async () => latest().onmessage?.({ data: new ArrayBuffer(2) }));
    expect(result.current.connected).toBe(true);
    expect(result.current.updates.map((update) => update.amount)).toEqual([
      { amount: '10.00', currency: 'AZN' },
      null,
    ]);
  });

  it('closes when the screen is left and opens again, from the first step, on return', async () => {
    jest.useFakeTimers();
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useCampaignUpdates(URL_, active),
      { initialProps: { active: true } },
    );
    await act(async () => latest().drop());
    const pending = MockSocket.instances.length;

    await rerender({ active: false });
    // The retry that was waiting is cancelled with the socket.
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(MockSocket.instances).toHaveLength(pending);

    await rerender({ active: true });
    expect(MockSocket.instances).toHaveLength(pending + 1);
    expect(latest().closed).toBe(false);
  });

  it('drops the frames of one channel when it is given another', async () => {
    const OTHER = 'wss://realtime.test.invalid/v1/realtime?channel=project%3Ap2';
    const { result, rerender } = await renderHook(
      ({ url }: { url: string | null }) => useCampaignUpdates(url, true),
      { initialProps: { url: URL_ as string | null } },
    );
    await act(async () => latest().onmessage?.({ data: frame('10.00') }));
    expect(result.current.updates).toHaveLength(1);

    // Offline: no channel, and nothing the page reads has changed, so the frames stay.
    await rerender({ url: null });
    expect(result.current.updates).toHaveLength(1);

    // Another campaign's counter: none of the last one's frames may be added to it.
    await rerender({ url: OTHER });
    expect(result.current.updates).toHaveLength(0);
    expect(latest().url).toBe(OTHER);
  });

  it('closes the socket when the app goes to the background', async () => {
    let listener: (state: AppStateStatus) => void = () => {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });

    await renderHook(() => useCampaignUpdates(URL_, useAppActive()));
    const socket = latest();
    expect(socket.closed).toBe(false);

    await act(async () => listener('background'));
    expect(socket.closed).toBe(true);

    await act(async () => listener('active'));
    expect(MockSocket.instances).toHaveLength(2);
    expect(latest().closed).toBe(false);
  });
});

describe('LiveFunding', () => {
  /** What a reader gets: a moving figure (#278) is read by its final value, not its frames. */
  function textOf(node: TestInstance | string): string {
    if (typeof node === 'string') return node;
    if (node.props.accessibilityRole === 'text' && typeof node.props.accessibilityLabel === 'string') {
      return node.props.accessibilityLabel;
    }
    return node.children.map(textOf).join('');
  }

  async function show(pledged: string) {
    return render(
      <IntlProvider locale="en" messages={en}>
        <LiveFunding
          goal={{ amount: '100.00', currency: 'AZN' }}
          pledged={{ amount: pledged, currency: 'AZN' }}
          backersCount={2}
          socketUrl={URL_}
          active
        />
      </IntlProvider>,
    );
  }

  it('adds each frame with decimal arithmetic, and ignores another currency', async () => {
    await show('99.90');
    await act(async () => latest().onopen?.());
    for (let i = 0; i < 10; i += 1) await act(async () => latest().onmessage?.({ data: frame('0.01') }));
    await act(async () => latest().onmessage?.({ data: frame('500.00', 'USD') }));

    expect(textOf(screen.getByTestId('funding-pledged'))).toContain('100.00');
    expect(textOf(screen.getByTestId('funding-percent'))).toContain('100%');
    expect(textOf(screen.getByTestId('funding-percent'))).toContain(en.campaign.funding.funded);
    // The backers are not live, as on the web.
    expect(textOf(screen.getByTestId('funding-backers'))).toContain('2');
  });

  it('counts frames from a refreshed figure only once', async () => {
    const view = await show('10.00');
    await act(async () => latest().onmessage?.({ data: frame('5.00') }));
    expect(textOf(screen.getByTestId('funding-pledged'))).toContain('15.00');

    // A pull to refresh reads 15.00, which already contains that frame.
    await view.rerender(
      <IntlProvider locale="en" messages={en}>
        <LiveFunding
          goal={{ amount: '100.00', currency: 'AZN' }}
          pledged={{ amount: '15.00', currency: 'AZN' }}
          backersCount={2}
          socketUrl={URL_}
          active
        />
      </IntlProvider>,
    );
    expect(textOf(screen.getByTestId('funding-pledged'))).toContain('15.00');
    expect(textOf(screen.getByTestId('funding-pledged'))).not.toContain('20.00');
  });

  it('rounds the percent down, so 99.5% is never "100%"', async () => {
    await show('99.50');
    expect(textOf(screen.getByTestId('funding-percent'))).toContain('99%');
    expect(textOf(screen.getByTestId('funding-percent'))).toContain(en.campaign.funding.ofGoal);
    const bar = screen.getByRole('progressbar');
    expect(bar.props.accessibilityLabel).toBe(
      en.campaign.funding.progressLabel.replace('{percent}', '99'),
    );
    expect(bar.props.accessibilityValue.text).not.toContain('100');
  });

  it('labels the bar with the funded percent', async () => {
    await show('42.00');
    expect(
      screen.getByRole('progressbar', {
        name: en.campaign.funding.progressLabel.replace('{percent}', '42'),
      }),
    ).toBeTruthy();
  });
});
