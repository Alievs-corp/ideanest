import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Say something to a screen-reader user without moving their focus — the native `aria-live`.
 *
 * <p>The web tells a screen reader "saved", "copied" and "12 characters remaining" through live
 * regions, and it has no toasts outside the admin console (issue #151). This is the same channel
 * on a phone: an announcement and nothing drawn, so a sighted user sees the state change itself
 * and a VoiceOver or TalkBack user hears it.
 *
 * <p>`assertive` interrupts whatever is being read — errors and warnings, the web's
 * `role="alert"`. Everything else is polite: on iOS it queues behind the current utterance
 * instead of cutting it off, which is what `aria-live="polite"` does. Android's API has no queue
 * option; TalkBack reads announcements in order already.
 */
export function announce(
  message: string,
  { assertive = false }: { assertive?: boolean } = {},
): void {
  if (message === '') return;

  if (Platform.OS === 'ios') {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, {
      queue: !assertive,
    });
  } else {
    AccessibilityInfo.announceForAccessibility(message);
  }
}
