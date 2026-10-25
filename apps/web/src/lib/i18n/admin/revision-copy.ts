import type { AdminTranslator } from '../admin-copy';
import type { ConsoleChromeCopy } from './common-copy';
import type { PluralForms } from '../plurals';
import type { RevisionField, RevisionRewardChange, RevisionRewardField } from '../../admin/revisions';
import type { StoryLineKind } from '../../admin/revision-diff';

/**
 * The words of the edit review — issue #560, part of epic #557.
 *
 * Two screens, one vocabulary: the field names are said identically in the queue's tags and
 * over each comparison, so they live in one table both builders read.
 */

export type RevisionFieldNames = Readonly<Record<RevisionField, string>>;

export interface RevisionQueueCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly heading: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly changedLabel: string;
  /** Carries `{date}`. */
  readonly submitted: string;
  /** Carries `{name}`. */
  readonly by: string;
  readonly creatorGone: string;
  readonly review: string;
  /** Carries `{title}`. */
  readonly reviewLabel: string;
  readonly fields: RevisionFieldNames;
}

export interface RevisionDialogCopy {
  readonly title: string;
  /** Carries `{title}`. */
  readonly description: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  readonly confirmLabel: string;
  readonly busyLabel: string;
}

/** The words of the reward tiers a revision touches — issue #569, part of epic #557. */
export interface RevisionRewardsCopy {
  readonly heading: string;
  readonly intro: string;
  readonly untitled: string;
  /** Carries `{title}`. */
  readonly tierLabel: string;
  readonly changes: Readonly<Record<RevisionRewardChange, string>>;
  readonly changesLabel: string;
  /** Carries `{place}`, counted from one. */
  readonly placeLive: string;
  /** Carries `{place}`, counted from one. */
  readonly placeProposed: string;
  /** Carries `{live}` and `{proposed}`, counted from one. */
  readonly placeBoth: string;
  /** Carries `{price}`. */
  readonly price: string;
  readonly priceFrozen: string;
  readonly createdNote: string;
  readonly deletedNote: string;
  readonly movedOnly: string;
  readonly fields: Readonly<Record<RevisionRewardField, string>>;
  readonly yes: string;
  readonly no: string;
  readonly none: string;
  readonly unlimited: string;
  readonly noImage: string;
  /** Carries `{title}`. */
  readonly imageAlt: string;
  readonly shippingTypes: Readonly<Record<string, string>>;
  /** Carries `{name}` and `{quantity}`. */
  readonly itemLine: string;
  readonly itemGone: string;
  /** Carries `{amount}`, `{additional}` and `{perKilogram}`. */
  readonly rateLine: string;
  readonly zoneGone: string;
  readonly noItems: string;
  readonly noRates: string;
  readonly secretLinkReplaced: string;
}

export interface RevisionReviewCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly loadingReview: string;
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly backToQueue: string;
  readonly openCampaign: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;
  readonly legend: string;
  readonly liveHeading: string;
  readonly proposedHeading: string;
  readonly changesHeading: string;
  readonly noChanges: string;
  readonly fields: RevisionFieldNames;
  /** "Removed:" and "Added:", read out before a marked span; sighted readers see the mark. */
  readonly removed: string;
  readonly added: string;
  readonly empty: string;
  readonly noCategory: string;
  readonly noCover: string;
  readonly noVideo: string;
  readonly noCountries: string;
  /** Carries `{title}`. */
  readonly coverAlt: string;
  readonly openVideo: string;
  /** Carries `{title}`. */
  readonly videoLabel: string;
  readonly unchangedBlocks: PluralForms;
  readonly storyUnreadable: string;
  readonly blocks: Readonly<Record<StoryLineKind, string>>;
  readonly statusLabel: string;
  readonly status: Readonly<Record<string, string>>;
  /** Carries `{status}`. */
  readonly notPending: string;
  /** Carries `{date}`. */
  readonly submitted: string;
  /** Carries `{date}`. */
  readonly decidedOn: string;
  readonly reasonLabel: string;
  readonly decideHeading: string;
  readonly approve: string;
  readonly reject: string;
  readonly approveDialog: RevisionDialogCopy;
  readonly rejectDialog: RevisionDialogCopy;
  readonly noteRequired: string;
  /** Carries `{limit}`. */
  readonly tooLong: string;
  readonly approved: string;
  readonly rejected: string;
  readonly unavailable: string;
  readonly rewards: RevisionRewardsCopy;
}

export function revisionQueueCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): RevisionQueueCopy {
  const at = (key: string) => `screens.revisionQueue.${key}`;

  return {
    ...chrome,
    subject: t(at('subject')),
    heading: t(at('heading')),
    loadingList: t(at('loadingList')),
    emptyTitle: t(at('emptyTitle')),
    emptyBody: t(at('emptyBody')),
    changedLabel: t(at('changedLabel')),
    submitted: String(t.raw(at('submitted'))),
    by: String(t.raw(at('by'))),
    creatorGone: t(at('creatorGone')),
    review: t(at('review')),
    reviewLabel: String(t.raw(at('reviewLabel'))),
    fields: t.raw('screens.revisionReview.fields') as RevisionFieldNames,
  };
}

export function revisionReviewCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): RevisionReviewCopy {
  const at = (key: string) => `screens.revisionReview.${key}`;
  const dialog = (key: string): RevisionDialogCopy => ({
    title: t(at(`${key}.title`)),
    description: String(t.raw(at(`${key}.description`))),
    noteLabel: t(at(`${key}.noteLabel`)),
    noteHint: t(at(`${key}.noteHint`)),
    confirmLabel: t(at(`${key}.confirmLabel`)),
    busyLabel: t(at(`${key}.busyLabel`)),
  });

  return {
    ...chrome,
    subject: t(at('subject')),
    loadingReview: t(at('loadingReview')),
    notFoundTitle: t(at('notFoundTitle')),
    notFoundBody: t(at('notFoundBody')),
    backToQueue: t(at('backToQueue')),
    openCampaign: t(at('openCampaign')),
    noticeTitle: t(at('noticeTitle')),
    noticeBody: t(at('noticeBody')),
    legend: t(at('legend')),
    liveHeading: t(at('liveHeading')),
    proposedHeading: t(at('proposedHeading')),
    changesHeading: t(at('changesHeading')),
    noChanges: t(at('noChanges')),
    fields: t.raw(at('fields')) as RevisionFieldNames,
    removed: t(at('removed')),
    added: t(at('added')),
    empty: t(at('empty')),
    noCategory: t(at('noCategory')),
    noCover: t(at('noCover')),
    noVideo: t(at('noVideo')),
    noCountries: t(at('noCountries')),
    coverAlt: String(t.raw(at('coverAlt'))),
    openVideo: t(at('openVideo')),
    videoLabel: String(t.raw(at('videoLabel'))),
    unchangedBlocks: t.raw(at('unchangedBlocks')) as PluralForms,
    storyUnreadable: t(at('storyUnreadable')),
    blocks: t.raw(at('blocks')) as Readonly<Record<StoryLineKind, string>>,
    statusLabel: t(at('statusLabel')),
    status: t.raw(at('status')) as Readonly<Record<string, string>>,
    notPending: String(t.raw(at('notPending'))),
    submitted: String(t.raw(at('submitted'))),
    decidedOn: String(t.raw(at('decidedOn'))),
    reasonLabel: t(at('reasonLabel')),
    decideHeading: t(at('decideHeading')),
    approve: t(at('approve')),
    reject: t(at('reject')),
    approveDialog: dialog('approveDialog'),
    rejectDialog: dialog('rejectDialog'),
    noteRequired: t(at('noteRequired')),
    tooLong: String(t.raw(at('tooLong'))),
    approved: t(at('approved')),
    rejected: t(at('rejected')),
    unavailable: t(at('unavailable')),
    rewards: rewardsCopyFrom(t),
  };
}

function rewardsCopyFrom(t: AdminTranslator): RevisionRewardsCopy {
  const at = (key: string) => `screens.revisionReview.rewards.${key}`;
  const text = (key: string) => String(t.raw(at(key)));

  return {
    heading: t(at('heading')),
    intro: t(at('intro')),
    untitled: t(at('untitled')),
    tierLabel: text('tierLabel'),
    changes: t.raw(at('changes')) as RevisionRewardsCopy['changes'],
    changesLabel: t(at('changesLabel')),
    placeLive: text('placeLive'),
    placeProposed: text('placeProposed'),
    placeBoth: text('placeBoth'),
    price: text('price'),
    priceFrozen: t(at('priceFrozen')),
    createdNote: t(at('createdNote')),
    deletedNote: t(at('deletedNote')),
    movedOnly: t(at('movedOnly')),
    fields: t.raw(at('fields')) as RevisionRewardsCopy['fields'],
    yes: t(at('yes')),
    no: t(at('no')),
    none: t(at('none')),
    unlimited: t(at('unlimited')),
    noImage: t(at('noImage')),
    imageAlt: text('imageAlt'),
    shippingTypes: t.raw(at('shippingTypes')) as RevisionRewardsCopy['shippingTypes'],
    itemLine: text('itemLine'),
    itemGone: t(at('itemGone')),
    rateLine: text('rateLine'),
    zoneGone: t(at('zoneGone')),
    noItems: t(at('noItems')),
    noRates: t(at('noRates')),
    secretLinkReplaced: t(at('secretLinkReplaced')),
  };
}
