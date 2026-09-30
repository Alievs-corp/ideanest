import * as Network from 'expo-network';
import { onlineManager } from '@tanstack/react-query';
import {
  currentlyOnline,
  isOfflineState,
  setOnline,
  startConnectivity,
  subscribeToConnectivity,
} from './connectivity';

/**
 * Connectivity — issue #150. What counts as offline, and that the store, TanStack Query and
 * the platform agree.
 */

const network = Network as unknown as {
  __setNetworkState: (state: Network.NetworkState) => void;
  __reset: () => void;
};

const OFFLINE: Network.NetworkState = { isConnected: false, isInternetReachable: false };
const ONLINE: Network.NetworkState = { isConnected: true, isInternetReachable: true };

beforeEach(() => {
  network.__reset();
  setOnline(true);
});

describe('what counts as offline', () => {
  it('no connection, or a connection that does not reach the internet', () => {
    expect(isOfflineState(OFFLINE)).toBe(true);
    // Hotel Wi-Fi before its sign-in page: connected, going nowhere.
    expect(isOfflineState({ isConnected: true, isInternetReachable: false })).toBe(true);
    expect(isOfflineState(ONLINE)).toBe(false);
  });

  it('not known is not offline', () => {
    // A banner claiming the phone is offline when it is not is worse than a late one.
    expect(isOfflineState({})).toBe(false);
    expect(isOfflineState({ isConnected: true })).toBe(false);
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
  it('follows the platform, and TanStack Query follows the store', async () => {
    const stop = startConnectivity();
    await Promise.resolve();
    expect(currentlyOnline()).toBe(true);

    network.__setNetworkState(OFFLINE);
    expect(currentlyOnline()).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);

    network.__setNetworkState(ONLINE);
    expect(currentlyOnline()).toBe(true);
    expect(onlineManager.isOnline()).toBe(true);

    stop();
    network.__setNetworkState(OFFLINE);
    // Stopped: nothing is listening any more.
    expect(currentlyOnline()).toBe(true);
  });

  it('reads the state at launch, so a phone that starts offline shows it', async () => {
    network.__setNetworkState(OFFLINE);
    const stop = startConnectivity();
    await Promise.resolve();
    await Promise.resolve();
    expect(currentlyOnline()).toBe(false);
    stop();
  });
});
