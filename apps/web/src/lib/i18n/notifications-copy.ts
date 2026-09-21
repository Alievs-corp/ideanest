/**
 * Every word the notifications inbox and its settings draw — issue #324, §4.10.
 *
 * <h2>Two headline tables rather than one with a stand-in</h2>
 *
 * A notification's headline names the campaign when the document carries a title and says
 * "a campaign" when it does not — a row written before the title was stored, or one whose
 * campaign has since been deleted. The old code built one sentence and capitalised whichever
 * of the two landed at the front of it.
 *
 * That does not survive translation. English puts the campaign first in half these sentences
 * and Azerbaijani does not, so capitalising the value is right in one language and wrong in
 * the other — and a stand-in that has to be capitalised at the start of a sentence and not in
 * the middle cannot be one string. So there are two tables, keyed by the same
 * `NotificationType`, exactly as `messages.properties` splits a key from its `.named` twin
 * and for the same reason.
 *
 * <h2>The amount fallbacks are copy, not defaults</h2>
 *
 * "Your pledge of your chosen amount is confirmed" is what a row with no money in its
 * document reads as, and it is a sentence somebody receives. It is in the catalogue with the
 * rest.
 */
export interface NotificationsTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

export interface NotificationsCopy {
  /** Keyed by `NotificationType`. Carries `{campaign}` and, where the type has one, `{amount}`. */
  readonly headline: Readonly<Record<string, string>>;
  /** The same types, for a row whose document carries no campaign title. */
  readonly unnamed: Readonly<Record<string, string>>;
  /** What stands in for a figure the document does not carry. */
  readonly amount: Readonly<Record<string, string>>;
  readonly category: Readonly<Record<string, string>>;
  readonly categoryDescription: Readonly<Record<string, string>>;
  readonly channel: Readonly<Record<string, string>>;
  readonly mode: Readonly<Record<string, string>>;
  readonly mandatorySecurity: string;
  readonly mandatoryOther: string;
}

export interface InboxCopy extends NotificationsCopy {
  readonly heading: string;
  /** Carries `{count}`. */
  readonly unread: string;
  readonly unreadOnly: string;
  readonly filterLabel: string;
  readonly all: string;
  readonly signedOut: string;
  readonly signedOutBody: string;
  readonly loadingList: string;
  /** The title over a load refusal. `refused` and `unreachable` are its body — #86. */
  readonly errorTitle: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
  readonly loadMore: string;
  readonly loading: string;
  readonly unreadWord: string;
  readonly markRead: string;
  readonly marking: string;
  readonly refused: string;
  readonly unreachable: string;
}

export interface PreferencesCopy extends NotificationsCopy {
  readonly signedOut: string;
  readonly signedOutBody: string;
  readonly defaults: string;
  readonly saveFailedTitle: string;
  readonly loading: string;
  readonly default: string;
  readonly tryAgain: string;
  readonly tooManyChanges: string;
  readonly conflict: string;
  readonly refused: string;
  readonly unreachable: string;
  /** Carries `{category}`, `{channel}` and `{mode}`. What a saved switch announces. */
  readonly saved: string;
}

function sharedFrom(t: NotificationsTranslator): NotificationsCopy {
  const record = (key: string) => t.raw(key) as Readonly<Record<string, string>>;

  return {
    headline: record('headline'),
    unnamed: record('unnamed'),
    amount: record('amount'),
    category: record('category'),
    categoryDescription: record('categoryDescription'),
    channel: record('channel'),
    mode: record('mode'),
    mandatorySecurity: t('mandatorySecurity'),
    mandatoryOther: t('mandatoryOther'),
  };
}

export function inboxCopyFrom(t: NotificationsTranslator): InboxCopy {
  return {
    ...sharedFrom(t),
    heading: t('inbox.heading'),
    unread: String(t.raw('inbox.unread')),
    unreadOnly: t('inbox.unreadOnly'),
    filterLabel: t('inbox.filterLabel'),
    all: t('inbox.all'),
    signedOut: t('inbox.signedOut'),
    signedOutBody: t('inbox.signedOutBody'),
    loadingList: t('inbox.loadingList'),
    errorTitle: t('inbox.errorTitle'),
    emptyTitle: t('inbox.emptyTitle'),
    emptyBody: t('inbox.emptyBody'),
    filteredTitle: t('inbox.filteredTitle'),
    filteredBody: t('inbox.filteredBody'),
    loadMore: t('inbox.loadMore'),
    loading: t('inbox.loading'),
    unreadWord: t('inbox.unreadWord'),
    markRead: t('inbox.markRead'),
    marking: t('inbox.marking'),
    refused: t('inbox.refused'),
    unreachable: t('inbox.unreachable'),
  };
}

export function preferencesCopyFrom(t: NotificationsTranslator): PreferencesCopy {
  return {
    ...sharedFrom(t),
    signedOut: t('preferences.signedOut'),
    signedOutBody: t('preferences.signedOutBody'),
    defaults: t('preferences.defaults'),
    saveFailedTitle: t('preferences.saveFailedTitle'),
    loading: t('preferences.loading'),
    default: t('preferences.default'),
    tryAgain: t('preferences.tryAgain'),
    tooManyChanges: t('preferences.tooManyChanges'),
    conflict: t('preferences.conflict'),
    refused: t('preferences.refused'),
    unreachable: t('preferences.unreachable'),
    saved: String(t.raw('preferences.saved')),
  };
}
