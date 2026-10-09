import type { ReactElement } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import {
  RECHECK_AFTER_MS,
  isQuietRoute,
  resetUpdateChecksForTests,
  shouldRecheck,
} from '../lib/app-update';
import { UpdatePrompt } from './update-prompt';

/**
 * The over-the-air update offer: shown once an update is downloaded, put off by "Later" for that
 * update only, held on screens where a restart would lose work, and a foreground check that
 * respects the server's rate limit.
 */

const mockUpdates = {
  isEnabled: true,
  state: {
    isUpdatePending: false,
    downloadedUpdate: undefined as unknown,
    isStartupProcedureRunning: false,
    isChecking: false,
    isDownloading: false,
  },
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
};

jest.mock('expo-updates', () => ({
  UpdateInfoType: { NEW: 'new', ROLLBACK: 'rollback' },
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  useUpdates: () => mockUpdates.state,
  checkForUpdateAsync: () => mockUpdates.checkForUpdateAsync(),
  fetchUpdateAsync: () => mockUpdates.fetchUpdateAsync(),
  reloadAsync: () => mockUpdates.reloadAsync(),
}));

let mockPathname = '/';
jest.mock('expo-router', () => ({ usePathname: () => mockPathname }));

const copy = en.mobile.update;

function pending(updateId = 'update-1') {
  mockUpdates.state = {
    ...mockUpdates.state,
    isUpdatePending: true,
    downloadedUpdate: { type: 'new', updateId, createdAt: new Date(0), manifest: {} },
  };
}

function inEnglish(ui: ReactElement) {
  return render(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  );
}

let appStateListener: ((state: AppStateStatus) => void) | undefined;

beforeEach(() => {
  mockUpdates.isEnabled = true;
  mockUpdates.state = {
    isUpdatePending: false,
    downloadedUpdate: undefined,
    isStartupProcedureRunning: false,
    isChecking: false,
    isDownloading: false,
  };
  mockUpdates.checkForUpdateAsync.mockReset().mockResolvedValue({ isAvailable: false });
  mockUpdates.fetchUpdateAsync.mockReset().mockResolvedValue({ isNew: true });
  mockUpdates.reloadAsync.mockReset().mockResolvedValue(undefined);
  mockPathname = '/';
  resetUpdateChecksForTests(0);
  appStateListener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => jest.restoreAllMocks());

describe('the offer', () => {
  it('is not there while nothing is downloaded', async () => {
    await inEnglish(<UpdatePrompt />);
    expect(screen.queryByText(copy.title)).toBeNull();
  });

  it('appears once an update is downloaded', async () => {
    pending();
    await inEnglish(<UpdatePrompt />);
    expect(screen.getByText(copy.title)).toBeOnTheScreen();
    expect(screen.getByText(copy.description)).toBeOnTheScreen();
  });

  it('restarts into the update', async () => {
    pending();
    await inEnglish(<UpdatePrompt />);
    await act(async () => fireEvent.press(screen.getByTestId('update-restart')));
    expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('says so at once when the restart is refused', async () => {
    pending();
    mockUpdates.reloadAsync.mockRejectedValue(new Error('no runtime'));
    await inEnglish(<UpdatePrompt />);
    await act(async () => fireEvent.press(screen.getByTestId('update-restart')));
    expect(screen.getByText(copy.failed)).toBeOnTheScreen();
  });

  it('is put off by "Later" for that update, and offered again for the next one', async () => {
    pending('update-1');
    const view = await inEnglish(<UpdatePrompt />);
    await act(async () => fireEvent.press(screen.getByTestId('update-later')));
    expect(screen.queryByTestId('update-restart')).toBeNull();
    expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();

    pending('update-2');
    await view.rerender(
      <IntlProvider locale="en" messages={en}>
        <UpdatePrompt />
      </IntlProvider>,
    );
    expect(screen.getByTestId('update-restart')).toBeOnTheScreen();
  });

  it('waits on a screen where a restart would lose work', async () => {
    pending();
    mockPathname = '/campaigns/42/back';
    await inEnglish(<UpdatePrompt />);
    expect(screen.queryByText(copy.title)).toBeNull();
  });

  it('never appears in a build without updates', async () => {
    pending();
    mockUpdates.isEnabled = false;
    await inEnglish(<UpdatePrompt />);
    expect(screen.queryByText(copy.title)).toBeNull();
  });
});

describe('the foreground check', () => {
  it('checks and downloads on return once the interval has passed', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    jest.spyOn(Date, 'now').mockReturnValue(RECHECK_AFTER_MS);
    await inEnglish(<UpdatePrompt />);
    await act(async () => appStateListener?.('active'));
    expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(mockUpdates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  });

  it('does not download when there is nothing new', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(RECHECK_AFTER_MS);
    await inEnglish(<UpdatePrompt />);
    await act(async () => appStateListener?.('active'));
    expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(mockUpdates.fetchUpdateAsync).not.toHaveBeenCalled();
  });

  it('does not ask the server again inside the interval', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(RECHECK_AFTER_MS - 1);
    await inEnglish(<UpdatePrompt />);
    await act(async () => appStateListener?.('active'));
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('does not check while an update is already waiting', async () => {
    pending();
    jest.spyOn(Date, 'now').mockReturnValue(RECHECK_AFTER_MS);
    await inEnglish(<UpdatePrompt />);
    await act(async () => appStateListener?.('active'));
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('survives an offline check', async () => {
    mockUpdates.checkForUpdateAsync.mockRejectedValue(new Error('offline'));
    jest.spyOn(Date, 'now').mockReturnValue(RECHECK_AFTER_MS);
    await inEnglish(<UpdatePrompt />);
    await act(async () => appStateListener?.('active'));
    expect(mockUpdates.fetchUpdateAsync).not.toHaveBeenCalled();
  });
});

describe('isQuietRoute', () => {
  it.each(['/campaigns/42/back', '/campaigns/new', '/campaigns/42/edit', '/campaigns/42/edit/story', '/pledges/7/address'])(
    'holds the offer on %s',
    (pathname) => expect(isQuietRoute(pathname)).toBe(true),
  );

  it.each(['/', '/campaigns/42/dashboard', '/pledges/7', '/projects/a/b', '/campaigns/newer'])(
    'allows it on %s',
    (pathname) => expect(isQuietRoute(pathname)).toBe(false),
  );
});

describe('shouldRecheck', () => {
  it('waits the whole interval', () => {
    expect(shouldRecheck(0, RECHECK_AFTER_MS - 1)).toBe(false);
    expect(shouldRecheck(0, RECHECK_AFTER_MS)).toBe(true);
  });
});
