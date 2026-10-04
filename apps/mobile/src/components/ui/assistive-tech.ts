import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Whether the person is driving the phone through assistive technology rather than by touch: a
 * screen reader (VoiceOver, TalkBack), or on Android any accessibility service, which is how
 * Switch Access and other switch and voice controls announce themselves.
 *
 * <p>A control whose only input is a gesture — `SwipeToConfirm` — asks this, and draws an ordinary
 * button when the answer is yes (`mobile-design` skill §6.4). iOS has no public signal for Switch
 * Control, so there the control relies on its `activate` accessibility action, which Switch
 * Control's "tap" performs.
 *
 * <p>The Android signal is broad: `isAccessibilityServiceEnabled` is also true while a password
 * manager's autofill, an automation tool or any other accessibility service runs, and such a
 * person gets the button too. That is the trade chosen — a button is a little less theatre for
 * somebody who could have swiped, while a swipe-only control is a wall for somebody who cannot.
 *
 * <p>One module-level subscription however many controls ask, as `useReducedMotion` does: the
 * first subscriber reads the platform and listens — to `screenReaderChanged`, and on Android to
 * `accessibilityServiceChanged` — and the last one to leave closes the listeners. Reads are
 * numbered, so when two overlap only the newest one publishes.
 */
let assistedNow = false;
const listeners = new Set<() => void>();
let platform: { remove: () => void }[] | null = null;
let sequence = 0;

function publish(value: boolean): void {
  if (value === assistedNow) return;
  assistedNow = value;
  for (const listener of listeners) listener();
}

async function read(): Promise<void> {
  const mine = ++sequence;
  const [reader, service] = await Promise.all([
    AccessibilityInfo.isScreenReaderEnabled().catch(() => false),
    Platform.OS === 'android' ? AccessibilityInfo.isAccessibilityServiceEnabled().catch(() => false) : false,
  ]);
  if (mine !== sequence) return;
  publish(reader === true || service === true);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (platform === null) {
    platform = [AccessibilityInfo.addEventListener('screenReaderChanged', () => void read())];
    if (Platform.OS === 'android') {
      // Missing from React Native's type list, present in its Android event table.
      platform.push(
        AccessibilityInfo.addEventListener('accessibilityServiceChanged' as 'screenReaderChanged', () => void read()),
      );
    }
    void read();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && platform !== null) {
      for (const subscription of platform) subscription.remove();
      platform = null;
    }
  };
}

export function useAssistiveTechnology(): boolean {
  return useSyncExternalStore(subscribe, () => assistedNow);
}
