/**
 * The words the campaign page's three client controls draw — issue #324.
 *
 * <h2>Why only three</h2>
 *
 * Ten of the thirteen components on this page are server components and read the catalogue
 * directly; there is nothing between them and the request, so a prop would be ceremony.
 * These three cannot: `CampaignActions` holds save and reminder state, and the two comment
 * controls own a composer and a confirmation. Their server parents resolve the words and
 * hand them over, which is the pattern `lib/i18n/shell-copy.ts` measured a provider against.
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

export type CampaignTranslator = (key: string) => string;

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
