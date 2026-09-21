/**
 * Every word the panels below `/pledges` draw — issue #81, under epic #78.
 *
 * <h2>Why it is a prop, like the rest</h2>
 *
 * All three panels are client components and have to be: every row is somebody's own money,
 * read with a bearer token only the browser holds, and the service answers it `no-store`.
 * `lib/i18n/shell-copy.ts` carries the measurement that made a `NextIntlClientProvider` the
 * wrong answer for a surface like this one, and the answer it reached is the one here.
 *
 * <h2>What is deliberately NOT here</h2>
 *
 * The editor is the checkout's form over a pledge that already exists: it renders
 * `RewardChoice`, `AddonChoice`, `DestinationField` and `PledgeSummary`, and it is handed
 * `checkoutCopy()` for them. Its field label, its two hints and its four quote refusals are
 * the checkout's words too — `checkout.contribution` and `checkout.errors` already say them
 * in four languages, and `components/checkout/refusals.ts` is the one function that turns a
 * refusal into one of them. Adding pledge-specific keys that said the same thing would be
 * two spellings of "This reward costs {price}" on two screens that are visibly the same form.
 *
 * <p>The editor's anonymity checkbox is labelled from `checkout.anonymous.label` for the same
 * reason. Only its longer description is here, because PL-12's promise is stated at more
 * length on a pledge somebody already made than on one they are still making — and so is the
 * `Anonymous` tag, which the list draws without any checkout copy to read it from.
 *
 * <h2>The twelve states are one group, read by both screens</h2>
 *
 * `lib/pledges/backer.ts` held them as a module-level constant, which is evaluated before any
 * request exists and cannot read a catalogue — the shape `lib/moderation/describe.ts` is in.
 * The list and the manager draw the same twelve words, so a second copy would be two tables
 * that agree until one is edited.
 */

/** A message lookup over `account.pledges`, narrowed to what these builders need. */
export interface PledgesTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/**
 * §6.2's twelve states as words a backer can read.
 *
 * The wording is the backer's rather than the schema's: `CANCELED_BY_PROJECT` is not a thing
 * anybody did to themselves, and "Cancelled by the creator" is what actually happened. A state
 * this build has never heard of still reads as itself — see `pledgeStateLabel`.
 */
export type PledgeStatesCopy = Readonly<Record<string, string>>;

const STATE_KEYS = [
  'DRAFT',
  'CONFIRMED',
  'EXPIRED',
  'CANCELED_BY_BACKER',
  'CANCELED_BY_PROJECT',
  'CHARGE_PENDING',
  'CHARGE_FAILED',
  'COLLECTED',
  'DROPPED',
  'REFUNDED',
  'CHARGEBACK',
  'FULFILLED',
] as const;

function statesFrom(t: PledgesTranslator): PledgeStatesCopy {
  return Object.fromEntries(STATE_KEYS.map((key) => [key, t(`states.${key}`)]));
}

/** §4.5's PL-09 and PL-10: every pledge this account has made. */
export interface PledgeListCopy {
  readonly loading: string;
  readonly failedTitle: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly browse: string;
  /** PL-02: a pledge with no reward is a choice, and is named as one. */
  readonly noReward: string;
  /** Carries `{creator}`. */
  readonly byCreator: string;
  /** Carries `{time}`. */
  readonly cancelledAt: string;
  /** Carries `{time}`. */
  readonly confirmedAt: string;
  /** Not "paid": §9.2 moves no money at confirmation, and collection is epic #59's. */
  readonly collected: string;
  readonly toBeCollected: string;
  readonly loadingMore: string;
  readonly showMore: string;
  readonly nextPageFailed: string;
  readonly latePledge: string;
  readonly anonymous: string;
  readonly states: PledgeStatesCopy;
}

export function pledgeListCopyFrom(t: PledgesTranslator): PledgeListCopy {
  return {
    loading: t('list.loading'),
    failedTitle: t('list.failedTitle'),
    emptyTitle: t('list.emptyTitle'),
    emptyBody: t('list.emptyBody'),
    browse: t('list.browse'),
    noReward: t('list.noReward'),
    byCreator: String(t.raw('list.byCreator')),
    cancelledAt: String(t.raw('list.cancelledAt')),
    confirmedAt: String(t.raw('list.confirmedAt')),
    collected: t('list.collected'),
    toBeCollected: t('list.toBeCollected'),
    loadingMore: t('list.loadingMore'),
    showMore: t('list.showMore'),
    nextPageFailed: t('list.nextPageFailed'),
    latePledge: t('latePledge'),
    anonymous: t('anonymous'),
    states: statesFrom(t),
  };
}

/** The editor's own words. Everything else on it is the checkout's — see the file note. */
export interface PledgeEditorCopy {
  readonly loadingRewards: string;
  readonly heading: string;
  readonly intro: string;
  readonly anonymousHint: string;
  readonly saving: string;
  readonly save: string;
  readonly noChanges: string;
  readonly savedTitle: string;
  readonly savedBody: string;
}

function editorCopyFrom(t: PledgesTranslator): PledgeEditorCopy {
  return {
    loadingRewards: t('editor.loadingRewards'),
    heading: t('editor.heading'),
    intro: t('editor.intro'),
    anonymousHint: t('editor.anonymousHint'),
    saving: t('editor.saving'),
    save: t('editor.save'),
    noChanges: t('editor.noChanges'),
    savedTitle: t('editor.savedTitle'),
    savedBody: t('editor.savedBody'),
  };
}

/** One of the caller's own pledges, with §4.5's PL-09 edit under it. */
export interface PledgeManagerCopy {
  readonly loading: string;
  readonly unreadableTitle: string;
  readonly unreadableBody: string;
  readonly allPledges: string;
  readonly campaignUnnamed: string;
  /** Carries `{time}`. */
  readonly confirmedAt: string;
  /** Carries `{time}`. */
  readonly withdrawnAt: string;
  readonly whereGoing: string;
  readonly supplementsHeading: string;
  readonly upgrade: string;
  readonly extraAddons: string;
  readonly supplementsNote: string;
  readonly lockedTitle: string;
  /** Carries `{state}`, which is one of {@link PledgeStatesCopy} in the reader's language. */
  readonly lockedBody: string;
  readonly latePledge: string;
  readonly anonymous: string;
  readonly states: PledgeStatesCopy;
  readonly editor: PledgeEditorCopy;
}

export function pledgeManagerCopyFrom(t: PledgesTranslator): PledgeManagerCopy {
  return {
    loading: t('manager.loading'),
    unreadableTitle: t('manager.unreadableTitle'),
    unreadableBody: t('manager.unreadableBody'),
    allPledges: t('manager.allPledges'),
    campaignUnnamed: t('manager.campaignUnnamed'),
    confirmedAt: String(t.raw('manager.confirmedAt')),
    withdrawnAt: String(t.raw('manager.withdrawnAt')),
    whereGoing: t('manager.whereGoing'),
    supplementsHeading: t('manager.supplementsHeading'),
    upgrade: t('manager.upgrade'),
    extraAddons: t('manager.extraAddons'),
    supplementsNote: t('manager.supplementsNote'),
    lockedTitle: t('manager.lockedTitle'),
    lockedBody: String(t.raw('manager.lockedBody')),
    latePledge: t('latePledge'),
    anonymous: t('anonymous'),
    states: statesFrom(t),
    editor: editorCopyFrom(t),
  };
}
