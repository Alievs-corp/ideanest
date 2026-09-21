import type { PluralForms } from './plurals';

/**
 * The words the campaign page's four client controls draw — issue #324.
 *
 * <h2>Why only four</h2>
 *
 * Nine of the thirteen components on this page are server components and read the catalogue
 * directly; there is nothing between them and the request, so a prop would be ceremony.
 * These four cannot: `CampaignActions` holds save and reminder state, the two comment
 * controls own a composer and a confirmation, and `LiveFunding` folds §12.1's deltas into a
 * total that does not exist until after hydration. Their server parents resolve the words
 * and hand them over, which is the pattern `lib/i18n/shell-copy.ts` measured a provider
 * against.
 */
export interface CampaignActionsCopy {
  readonly save: string;
  readonly share: string;
  readonly remind: string;
}

export interface CommentCopy {
  readonly composerLabel: string;
  readonly signedOut: string;
  readonly signIn: string;
  readonly cancel: string;
  readonly notPosted: string;
  readonly reply: string;
  readonly replyLabel: string;
  /** The composer's submit button: one word for a comment, one for a reply. */
  readonly postComment: string;
  readonly postReply: string;
  /** What the button says while the request is in flight. */
  readonly posting: string;
  readonly withdraw: string;
  readonly withdrawWarning: string;
  readonly keep: string;
}

/**
 * The funding block's five words — issue #99.
 *
 * <h2>Why these are not `common.card`'s, which say the same things</h2>
 *
 * `common.card` already carries a progress bar's accessible name, a completion figure, a goal
 * and a backer count, and both campaign cards read them. The obvious move is to make this the
 * third reader, and it is wrong: those four sentences carry their number INSIDE them —
 * "{percent}% funded", "of {amount} goal", "{count} backers" — and this block does not.
 * `StatBlock` draws the figure large and the word under it, so the word has to stand alone;
 * filling `common.card.backers` here would print the count twice.
 *
 * <p>The accessible name is the one that could have been shared and is not. This bar has been
 * announced as "Funding: 42 percent of the goal" since #119 and the card's as "42 percent of
 * the goal". `lib/i18n/wording.test.ts` exists because moving a sentence into the catalogue is
 * exactly where it quietly becomes a different sentence, so the prefix survives the move and
 * dropping it stays a decision somebody makes on purpose.
 *
 * <h2>`backers` is a plural group rather than a ternary</h2>
 *
 * `backer` against `backers` is the whole of English and none of Russian, which picks between
 * three forms by the last digit — #99 found the ternary that had been choosing for all four
 * languages. `lib/i18n/plurals.ts` carries the rest of the argument. `pluralForm` is the half
 * to call rather than `pluralise`, because the number is the `StatBlock`'s value and not a
 * placeholder inside the word.
 */
export interface LiveFundingCopy {
  /** Carries `{percent}`. The accessible name of the progress bar. */
  readonly progressLabel: string;
  /** Under the amount raised. */
  readonly pledged: string;
  /** Under the completion figure, once the goal is reached. */
  readonly funded: string;
  /** Under the completion figure, before it is. */
  readonly ofGoal: string;
  /** Under the backer count, which `pluralForm` declines against it. */
  readonly backers: PluralForms;
}

export type CampaignTranslator = (key: string) => string;

/**
 * `campaign`'s translator, plus the `raw` the funding block needs.
 *
 * A plural group and a message with a placeholder in it are both read unformatted: `t()` would
 * ask next-intl to format `{percent}` against values this side does not have, and a group is
 * not a message at all.
 */
export interface FundingTranslator extends CampaignTranslator {
  raw(key: string): unknown;
}

export function campaignActionsCopyFrom(t: CampaignTranslator): CampaignActionsCopy {
  return { save: t('save'), share: t('share'), remind: t('remind') };
}

export function commentCopyFrom(t: CampaignTranslator): CommentCopy {
  return {
    composerLabel: t('composerLabel'),
    signedOut: t('signedOut'),
    signIn: t('signIn'),
    cancel: t('cancel'),
    notPosted: t('notPosted'),
    reply: t('reply'),
    replyLabel: t('replyLabel'),
    postComment: t('postComment'),
    postReply: t('postReply'),
    posting: t('posting'),
    withdraw: t('withdraw'),
    withdrawWarning: t('withdrawWarning'),
    keep: t('keep'),
  };
}

export function liveFundingCopyFrom(t: FundingTranslator): LiveFundingCopy {
  return {
    progressLabel: String(t.raw('funding.progressLabel')),
    pledged: t('funding.pledged'),
    funded: t('funding.funded'),
    ofGoal: t('funding.ofGoal'),
    backers: t.raw('funding.backers') as PluralForms,
  };
}
