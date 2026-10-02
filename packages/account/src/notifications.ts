import type { components } from '@ideanest/api-client';

/**
 * The notification preference table both clients draw — §4.10, #89 and #161. Moved here from
 * the web's `lib/notifications/{api,describe}.ts` unchanged, so the web's settings page and the
 * app's walk the same rows in the same order and offer the same modes.
 *
 * <p>The words for each category, channel and mode stay with each client's copy: this module is
 * imported by client bundles and cannot read a catalogue.
 */

type ContractNotification = components['schemas']['NotificationResponse'];
type ContractPreference = components['schemas']['Preference'];

export type NotificationCategory = NonNullable<ContractNotification['category']>;
export type NotificationChannel = NonNullable<ContractPreference['channel']>;
export type DeliveryMode = NonNullable<ContractPreference['mode']>;

/** One switch on the settings page, resolved through the service's own policy. */
export interface PreferenceSwitch {
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
  /** What happens today — the resolved answer, not the stored value. */
  readonly mode: DeliveryMode;
  /** Whether the account has ever said anything about this switch. */
  readonly stored: boolean;
  /** False on a mandatory category, where the control is shown disabled rather than hidden. */
  readonly changeable: boolean;
  /** Whether `DIGEST` is one of the choices here. */
  readonly digestOffered: boolean;
}

/** A switch being set. */
export interface PreferenceChange {
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
  readonly mode: DeliveryMode;
}

/**
 * The categories, in §4.10's order.
 *
 * Declared as a list rather than derived from the response so that the settings page has a
 * stable row order even before it has loaded, and so that a category the service starts
 * sending which nobody has labelled here is a type error.
 */
export const CATEGORIES: readonly NotificationCategory[] = [
  'PLEDGES',
  'CAMPAIGN',
  'PAYMENTS',
  'COMMUNITY',
  'REWARDS',
  'DISCOVERY',
  'SECURITY',
];

/** The three columns of §4.10's table. */
export const CHANNELS: readonly NotificationChannel[] = ['IN_APP', 'EMAIL', 'PUSH'];

/**
 * The modes this switch may be set to.
 *
 * Built from the response rather than from a rule restated here: `digestOffered` is the
 * service's answer to "can this channel batch", and a client that decided it independently
 * would drift from §4.10 the first time the table changed.
 */
export function modesFor(digestOffered: boolean): readonly DeliveryMode[] {
  return digestOffered ? ['IMMEDIATE', 'DIGEST', 'OFF'] : ['IMMEDIATE', 'OFF'];
}
