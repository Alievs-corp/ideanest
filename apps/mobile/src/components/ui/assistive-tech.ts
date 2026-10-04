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
 * <p>One module-level subscription however many controls ask, as `useReducedMotion` does: the
 * first subscriber reads the platform and listens, the last one to leave closes the listener. A
 * service has no change event of its own, so it is read again whenever the screen reader changes.
 */
let assistedNow = false;
const listeners = new Set<() => void>();
let platform: { remove: () => void } | null = null;

function publish(value: boolean): void {
  if (value === assistedNow) return;
  assistedNow = value;
  for (const listener of listeners) listener();
}

async function read(screenReader?: boolean): Promise<void> {
  const reader = screenReader ?? (await AccessibilityInfo.isScreenReaderEnabled().catch(() => false));
  const service =
    Platform.OS === 'android'
      ? await AccessibilityInfo.isAccessibilityServiceEnabled().catch(() => false)
      : false;
  publish(reader === true || service === true);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (platform === null) {
    platform = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => void read(enabled));
    void read();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && platform !== null) {
      platform.remove();
      platform = null;
    }
  };
}

export function useAssistiveTechnology(): boolean {
  return useSyncExternalStore(subscribe, () => assistedNow);
}
