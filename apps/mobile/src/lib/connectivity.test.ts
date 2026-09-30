import * as Network from 'expo-network';
import { onlineManager } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react-native';
import {
  UNREACHABLE_GRACE_MS,
  currentlyOnline,
  reachabilityOf,
  setOnline,
  startConnectivity,
  subscribeToConnectivity,
} from './connectivity';

/**
 * Connectivity — issue #150. What counts as offline and how soon, and that the store,
 * TanStack Query and the platform agree.
 */

const network = Network as unknown as {
  __setNetworkState: (state: Network.NetworkState) => void;
  __reset: () => void;
};

const OFFLINE: Network.NetworkState = { isConnected: false, isInternetReachable: false };
const ONLINE: Network.NetworkState = { isConnected: true, isInternetReachable: true };
/** Android's VALIDATED capability missing: a VPN, a blocked connectivity check, a handover. */
const UNREACHABLE: Network.NetworkState = { isConnected: true, isInternetReachable: false };

let stop: (() => void) | null = null;

function start(): void {
  stop = startConnectivity();
}

beforeEach(() => {
  network.__reset();
  setOnline(true);
});

afterEach(() => {
  stop?.();
  stop = null;
  jest.useRealTimers();
});

describe('what a reported state means', () => {
  it('no connection is offline; connected but not reaching the internet is only doubtful', () => {
    expect(reachabilityOf(OFFLINE)).toBe('offline');
    expect(reachabilityOf({ isConnected: false })).toBe('offline');
    expect(reachabilityOf(UNREACHABLE)).toBe('unreachable');
    expect(reachabilityOf(ONLINE)).toBe('online');
  });

  it('not known is not offline', () => {
    expect(reachabilityOf({})).toBe('online');
    expect(reachabilityOf({ isConnected: true })).toBe('online');
  });
});

describe('the store', () => {
  it('tells subscribers only when the answer changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToConnectivity(listener);

    setOnline(true);
    expect(listener).not.toHaveBeenCalled();

    setOnline(false);
    setOnline(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setOnline(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('startConnectivity', () => {
  it('follows the platform, and TanStack Query follows the store', () => {
    start();

    network.__setNetworkState(OFFLINE);
    expect(currentlyOnline()).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);

    network.__setNetworkState(ONLINE);
    expect(currentlyOnline()).toBe(true);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('stops listening when stopped', () => {
    start();
    stop?.();
    stop = null;

    network.__setNetworkState(OFFLINE);
    expect(currentlyOnline()).toBe(true);
  });

  it('reads the state at launch, so a phone that starts offline shows it', async () => {
    network.__setNetworkState(OFFLINE);
    start();
    await waitFor(() => expect(currentlyOnline()).toBe(false));
  });

  describe('connected but unreachable', () => {
    beforeEach(() => jest.useFakeTimers());

    it(`is offline only once it has lasted ${UNREACHABLE_GRACE_MS} ms`, () => {
      start();
      network.__setNetworkState(UNREACHABLE);

      jest.advanceTimersByTime(UNREACHABLE_GRACE_MS - 1);
      expect(currentlyOnline()).toBe(true);
      // Repeats of the same report do not restart the clock.
      network.__setNetworkState(UNREACHABLE);

      jest.advanceTimersByTime(1);
      expect(currentlyOnline()).toBe(false);
    });

    it('a blip — a handover, a VPN reconnecting — never shows as offline', () => {
      start();
      network.__setNetworkState(UNREACHABLE);
      jest.advanceTimersByTime(UNREACHABLE_GRACE_MS / 2);
      network.__setNetworkState(ONLINE);

      jest.advanceTimersByTime(UNREACHABLE_GRACE_MS * 2);
      expect(currentlyOnline()).toBe(true);
    });

    it('losing the connection outright does not wait, and coming back does not either', () => {
      start();
      network.__setNetworkState(UNREACHABLE);
      network.__setNetworkState(OFFLINE);
      expect(currentlyOnline()).toBe(false);

      network.__setNetworkState(ONLINE);
      expect(currentlyOnline()).toBe(true);
      // The grace timer from the unreachable report was cancelled with it.
      jest.advanceTimersByTime(UNREACHABLE_GRACE_MS * 2);
      expect(currentlyOnline()).toBe(true);
    });

    it('stopping cancels a pending grace period', () => {
      start();
      network.__setNetworkState(UNREACHABLE);
      stop?.();
      stop = null;

      jest.advanceTimersByTime(UNREACHABLE_GRACE_MS * 2);
      expect(currentlyOnline()).toBe(true);
    });
  });
});
