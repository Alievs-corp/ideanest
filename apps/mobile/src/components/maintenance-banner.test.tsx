import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { fillPlaceholders } from '@ideanest/messages';
import { formatDate, formatDateTime, formatTime } from '../lib/i18n';
import { colors } from '../theme';
import { currentLocale } from '../lib/locale';
import { memoryStore } from '../lib/storage';
import {
  REFRESH_EVERY_MS,
  refreshUpcoming,
  setUpcoming,
  useUpcomingStore,
  visibleUpcoming,
  watchUpcoming,
} from '../lib/upcoming-maintenance';
import { UpcomingMaintenanceBanner } from './maintenance-banner';
import { WithOfflineBanner } from './offline-banner';

/**
 * The planned-maintenance banner — issue #214: shown under the header while a window is
 * announced, in the reader's language and time zone, closed for that window only and across
 * launches, gone once the window starts; and learned from `/v1/status` on launch and on return
 * to the foreground, no more often than every ten minutes.
 */

const copy = en.shell.maintenance;
const WINDOW = { startsAt: '2026-10-04T22:00:00Z', endsAt: '2026-10-04T22:30:00Z' };
const NEXT = { startsAt: '2026-10-11T22:00:00Z', endsAt: null };
const NOW = Date.parse('2026-10-03T12:00:00Z');

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit | undefined]>();
const status = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });

/** The banner's sentence, filled the way the screen fills it, in the formatter's language. */
function expected(window: { startsAt: string; endsAt: string | null }): string {
  const locale = currentLocale();
  const date = formatDate(window.startsAt, locale);
  const start = formatTime(window.startsAt, locale);
  if (window.endsAt === null) return fillPlaceholders(copy.upcomingOpenEnded, { date, start });
  const end =
    formatDate(window.endsAt, locale) === date
      ? formatTime(window.endsAt, locale)
      : formatDateTime(window.endsAt, locale);
  return fillPlaceholders(copy.upcoming, { date, start, end });
}

async function renderBanner() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <UpcomingMaintenanceBanner />
    </IntlProvider>,
  );
}

let store = memoryStore();

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  store = memoryStore();
  useUpcomingStore(store);
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => jest.useRealTimers());

describe('the banner', () => {
  it('is not there with nothing announced', async () => {
    await renderBanner();
    expect(screen.queryByTestId('maintenance-upcoming')).toBeNull();
  });

  it('says when, with a start and an end, in the reader’s language and time zone', async () => {
    setUpcoming(WINDOW);
    await renderBanner();
    expect(screen.getByText(expected(WINDOW))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: copy.dismiss })).toBeOnTheScreen();
  });

  it('says when it starts, and that no end is announced, when none is', async () => {
    setUpcoming(NEXT);
    await renderBanner();
    expect(screen.getByText(expected(NEXT))).toBeOnTheScreen();
  });

  it('shows the Bulk calendar glyph in the info tone beside the sentence', async () => {
    setUpcoming(WINDOW);
    await renderBanner();
    const glyph = screen.getByTestId('icon-Calendar', { includeHiddenElements: true });
    expect(glyph.props.color).toBe(colors.info);
    expect(screen.getByText(expected(WINDOW))).toBeOnTheScreen();
  });

  it('is information, not an alarm', async () => {
    setUpcoming(WINDOW);
    await renderBanner();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sits under the header with the offline banner, above the screen', async () => {
    setUpcoming(WINDOW);
    await render(
      <IntlProvider locale="en" messages={en}>
        <WithOfflineBanner>
          <></>
        </WithOfflineBanner>
      </IntlProvider>,
    );
    expect(screen.getByText(expected(WINDOW))).toBeOnTheScreen();
  });

  it('closes for that window, and stays closed across a relaunch', async () => {
    setUpcoming(WINDOW);
    await renderBanner();

    await fireEvent.press(screen.getByRole('button', { name: copy.dismiss }));
    expect(screen.queryByTestId('maintenance-upcoming')).toBeNull();

    // A relaunch: memory is gone, the device store is not.
    await act(async () => {
      useUpcomingStore(store);
      setUpcoming(WINDOW);
    });
    expect(screen.queryByTestId('maintenance-upcoming')).toBeNull();
    expect(visibleUpcoming()).toBeNull();
  });

  it('comes back for a different window', async () => {
    setUpcoming(WINDOW);
    await renderBanner();
    await fireEvent.press(screen.getByRole('button', { name: copy.dismiss }));

    await act(async () => setUpcoming(NEXT));
    expect(screen.getByText(expected(NEXT))).toBeOnTheScreen();
  });

  it('is gone once the window has started', () => {
    setUpcoming(WINDOW);
    expect(visibleUpcoming(Date.parse(WINDOW.startsAt) - 1)).toEqual(WINDOW);
    expect(visibleUpcoming(Date.parse(WINDOW.startsAt))).toBeNull();
  });
});

describe('where it comes from', () => {
  it('/v1/status, with no session and not from a cache', async () => {
    fetchMock.mockResolvedValueOnce(status({ state: 'operational', maintenance: null, upcoming: WINDOW }));

    await refreshUpcoming(NOW);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test.invalid/v1/status');
    expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(visibleUpcoming(NOW)).toEqual(WINDOW);
  });

  it('asks at most once every ten minutes', async () => {
    fetchMock.mockResolvedValue(status({ state: 'operational', maintenance: null, upcoming: null }));

    await refreshUpcoming(NOW);
    await refreshUpcoming(NOW + REFRESH_EVERY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await refreshUpcoming(NOW + REFRESH_EVERY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears when the window is withdrawn or has begun, and keeps it with no answer', async () => {
    setUpcoming(WINDOW);
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await refreshUpcoming(NOW);
    expect(visibleUpcoming(NOW)).toEqual(WINDOW);

    fetchMock.mockResolvedValueOnce(
      status({ state: 'maintenance', maintenance: { startsAt: WINDOW.startsAt, endsAt: null }, upcoming: null }),
    );
    await refreshUpcoming(NOW + REFRESH_EVERY_MS);
    expect(visibleUpcoming(NOW)).toBeNull();

    setUpcoming(WINDOW);
    fetchMock.mockResolvedValueOnce(status({ state: 'operational', maintenance: null, upcoming: null }));
    await refreshUpcoming(NOW + 2 * REFRESH_EVERY_MS);
    expect(visibleUpcoming(NOW)).toBeNull();
  });

  it('is asked on launch and on each return to the foreground', async () => {
    const listeners: ((state: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementationOnce((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: jest.fn() } as never;
    });
    fetchMock.mockResolvedValue(status({ state: 'operational', maintenance: null, upcoming: WINDOW }));

    const stop = watchUpcoming();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Back from the background after the throttle: asked again. The app switcher is not a return.
    jest.setSystemTime(NOW + REFRESH_EVERY_MS);
    await act(async () => {
      listeners.forEach((listener) => listener('inactive'));
      listeners.forEach((listener) => listener('active'));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });
});
