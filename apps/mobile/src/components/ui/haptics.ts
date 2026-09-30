import {
  ImpactFeedbackStyle,
  impactAsync,
  NotificationFeedbackType,
  notificationAsync,
  selectionAsync,
} from 'expo-haptics';

/**
 * Haptics — exactly `docs/motion-system.md` §7's table, and nothing else.
 *
 * <h2>Why a closed list</h2>
 *
 * A buzz is motion you feel, and it has the same failure mode as motion you see: it is cheap to
 * add, each one seems harmless, and a screen that vibrates on every tap has told the hand nothing.
 * The five events below are the ones that mean something — a thing was kept, a choice was made,
 * money moved or did not, a list refreshed. Every haptic in the application goes through this
 * object, so a sixth is a change to this file and to the table, not a call somebody slipped into
 * a screen.
 *
 * <p>Failures are swallowed: a phone without a vibration motor, or with system haptics turned off,
 * is not an error the person holding it can do anything about.
 */
function quietly(feedback: () => Promise<void>): () => void {
  return () => {
    void feedback().catch(() => undefined);
  };
}

export const haptics = {
  /** Save a project. */
  save: quietly(() => impactAsync(ImpactFeedbackStyle.Light)),
  /** Select a reward. */
  selectReward: quietly(() => selectionAsync()),
  /** The pledge is confirmed. */
  pledgeConfirmed: quietly(() => notificationAsync(NotificationFeedbackType.Success)),
  /** The payment failed. */
  paymentFailed: quietly(() => notificationAsync(NotificationFeedbackType.Error)),
  /** Pull to refresh. */
  refresh: quietly(() => impactAsync(ImpactFeedbackStyle.Medium)),
} as const;

export type HapticEvent = keyof typeof haptics;
