import { useSyncExternalStore } from 'react';
import * as Network from 'expo-network';
import { onlineManager } from '@tanstack/react-query';

/**
 * Whether the phone can reach anything at all — issue #150's offline banner.
 *
 * <h2>`expo-network`, and one store in front of it</h2>
 *
 * The operating system already knows, and `expo-network` is the SDK's own way of asking:
 * versioned with Expo, no second native dependency to keep in step with the SDK the way
 * `@react-native-community/netinfo` would be. It is read in exactly one place — here — and
 * everything else reads this store: the banner, the maintenance trigger (a 503 while offline
 * is a captive portal or a proxy talking, not the service), and TanStack Query's
 * `onlineManager`. Three readers of the native module would be three opinions about the same
 * moment.
 *
 * <h2>Online until told otherwise</h2>
 *
 * The first answer is asynchronous, so the store starts at "online". The alternative start
 * would flash the banner on every launch for the length of a native round trip, and announce
 * it — the one thing the issue says must not happen on a launch that is already online. A
 * launch that really is offline shows the banner one frame later, which nobody can tell.
 *
 * <h2>What counts as offline, and how soon</h2>
 *
 * **No connection** (`isConnected: false`) is offline at once: there is nothing to doubt.
 *
 * **A connection that does not reach the internet** (`isInternetReachable: false` while
 * connected) is offline only once it has stayed that way for {@link UNREACHABLE_GRACE_MS}. On
 * iOS the field simply mirrors `isConnected`; on Android it is `NET_CAPABILITY_VALIDATED`, which
 * is right about hotel Wi-Fi before its sign-in page and wrong, briefly or for good, about some
 * VPNs, networks that block Google's connectivity check, and every Wi-Fi-to-cellular handover.
 * A banner that says the phone is offline while pages are loading is worse than one that is a
 * few seconds late, so this doubt gets a grace period and the first kind does not.
 *
 * **Online** is believed at once, and cancels a pending "unreachable". A field the platform
 * leaves out is not known, and not known is not offline.
 */

let online = true;
const listeners = new Set<() => void>();

/** How long a connected-but-unreachable network must stay that way before it counts as offline. */
export const UNREACHABLE_GRACE_MS = 5_000;

/**
 * What a reported state means: `offline` now, `unreachable` (offline if it lasts), or `online`.
 * Exported so the rule is tested where it is written.
 */
export function reachabilityOf(state: Network.NetworkState): 'offline' | 'unreachable' | 'online' {
  if (state.isConnected === false) return 'offline';
  if (state.isInternetReachable === false) return 'unreachable';
  return 'online';
}

/** Whether the phone is online right now, as far as this application knows. Synchronous. */
export function currentlyOnline(): boolean {
  return online;
}

/** Records a new answer and tells the subscribers, only when it changed. */
export function setOnline(next: boolean): void {
  if (next === online) return;
  online = next;
  for (const listener of listeners) listener();
}

/** Subscribes to connectivity changes. Returns the unsubscribe. */
export function subscribeToConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The connectivity, re-rendering when it changes. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeToConnectivity, currentlyOnline, currentlyOnline);
}

/**
 * Starts listening to the platform, and points TanStack Query at the same answer. Returns the
 * stop. Called once, by the root layout, for the life of the process.
 *
 * <h2>Why `onlineManager` is wired, and what keeps it from changing the screens</h2>
 *
 * In React Native TanStack Query has no signal of its own (it listens for the browser's
 * `online` event), so it believes the phone is always online. Telling it the truth buys
 * `refetchOnReconnect`: a list that failed in a tunnel refreshes by itself when the
 * connection comes back. The price would be that a retry *pauses* while offline instead of
 * failing, and `lib/offline.ts`'s retry rule is what declines that — see there.
 */
export function startConnectivity(): () => void {
  let live = true;
  let heard = false;
  let grace: ReturnType<typeof setTimeout> | undefined;

  const cancelGrace = () => {
    if (grace !== undefined) clearTimeout(grace);
    grace = undefined;
  };

  const apply = (state: Network.NetworkState) => {
    const reach = reachabilityOf(state);
    if (reach === 'unreachable') {
      // Started once, not restarted by every repeat of the same report.
      grace ??= setTimeout(() => {
        grace = undefined;
        setOnline(false);
      }, UNREACHABLE_GRACE_MS);
      return;
    }
    cancelGrace();
    setOnline(reach === 'online');
  };

  const subscription = Network.addNetworkStateListener((state) => {
    heard = true;
    apply(state);
  });

  void Network.getNetworkStateAsync()
    .then((state) => {
      // A change reported while this was in flight is newer than this answer.
      if (live && !heard) apply(state);
    })
    .catch(() => {
      // No answer is "not known", which the class comment says is online.
    });

  onlineManager.setEventListener((setQueryOnline) => {
    setQueryOnline(currentlyOnline());
    return subscribeToConnectivity(() => setQueryOnline(currentlyOnline()));
  });

  return () => {
    live = false;
    cancelGrace();
    subscription.remove();
    // Runs the cleanup of the listener above, which is the unsubscribe.
    onlineManager.setEventListener(() => undefined);
  };
}
