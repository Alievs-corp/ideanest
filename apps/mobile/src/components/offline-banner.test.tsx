import type { ReactElement } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../lib/connectivity';
import { OfflineAnnouncer, OfflineBanner, WithOfflineBanner } from './offline-banner';

/**
 * The global offline banner — issue #150: shown while offline, gone when back, a live region,
 * and announced once per drop rather than once per render or per mounted screen.
 */

const BANNER = en.mobile.offline.banner;

function inEnglish(ui: ReactElement) {
  return render(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

let announce: jest.SpyInstance;

beforeEach(() => {
  setOnline(true);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => announce.mockRestore());

describe('the banner', () => {
  it('is not there while online', async () => {
    await inEnglish(<OfflineBanner />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('appears when the connection drops and goes when it returns', async () => {
    await inEnglish(<OfflineBanner />);

    await act(async () => setOnline(false));
    expect(screen.getByText(BANNER)).toBeOnTheScreen();

    await act(async () => setOnline(true));
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('sits in a polite live region that is there before the words are', async () => {
    // Mounted empty, so the sentence arriving is a change TalkBack reads.
    await inEnglish(<OfflineBanner />);
    expect(screen.getByTestId('offline-region').props.accessibilityLiveRegion).toBe('polite');

    await act(async () => setOnline(false));
    expect(screen.getByTestId('offline-region')).toContainElement(screen.getByText(BANNER));
  });

  it('keeps the screen underneath', async () => {
    await inEnglish(
      <WithOfflineBanner>
        <Text>the screen</Text>
      </WithOfflineBanner>,
    );
    await act(async () => setOnline(false));
    expect(screen.getByText(BANNER)).toBeOnTheScreen();
    expect(screen.getByText('the screen')).toBeOnTheScreen();
  });
});

describe('the announcement', () => {
  it('says nothing on a launch that is already online', async () => {
    await inEnglish(<OfflineAnnouncer />);
    expect(announce).not.toHaveBeenCalled();
  });

  it('says it once when the connection drops, however many banners are mounted', async () => {
    const view = await inEnglish(
      <>
        <OfflineAnnouncer />
        <OfflineBanner />
        <OfflineBanner />
      </>,
    );

    await act(async () => setOnline(false));
    await view.rerender(
      <IntlProvider locale="en" messages={en}>
        <OfflineAnnouncer />
        <OfflineBanner />
        <OfflineBanner />
      </IntlProvider>,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(BANNER);

    // Coming back is not announced; dropping again is, once more.
    await act(async () => setOnline(true));
    expect(announce).toHaveBeenCalledTimes(1);
    await act(async () => setOnline(false));
    expect(announce).toHaveBeenCalledTimes(2);
  });
});
