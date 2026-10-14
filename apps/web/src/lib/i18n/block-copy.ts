/**
 * Every word blocking draws on the web — §4.9's C-08, issue #324.
 *
 * <h2>One namespace for three surfaces</h2>
 *
 * The control under a comment, the control on a profile and the list in privacy settings all
 * describe the same act, and the sentence that says what a block does must not drift between
 * them: somebody who reads "they are not told" under a comment and something weaker on a
 * profile would be right to wonder which is true. So `blocking` is one namespace, shared with
 * the app, and these builders only choose which of its words each surface needs.
 *
 * <h2>Nothing names the person in the confirmation</h2>
 *
 * A comment carries its author's id and no name (`CampaignComments` explains the gap), so the
 * comment control cannot say whom it blocks, and the profile's says "this account" to match
 * it. One sentence for both is the point of the paragraph above.
 *
 * <h2>Why props rather than a hook</h2>
 *
 * Every surface here is a client island — a block is read and written in the browser with the
 * reader's token — and `lib/i18n/shell-copy.ts` carries why those are handed their words by
 * the route rather than through a client-side catalogue.
 */

/** A message lookup over a namespace, narrowed to what these builders need. */
export interface BlockTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** The control under a comment and on a profile, and what each says afterwards. */
export interface BlockControlCopy {
  /** "Block this account" — the trigger, under a comment and on a profile. */
  readonly trigger: string;
  /** What a block does and does not do, read before confirming. */
  readonly warning: string;
  readonly confirm: string;
  /** The confirm button while the request is in flight. */
  readonly blocking: string;
  readonly cancel: string;
  /** The profile's line once this reader has blocked the account. */
  readonly blockedState: string;
  readonly unblock: string;
  readonly unblocking: string;
  /** Announced after a block. Says where to undo it. */
  readonly blocked: string;
  /** Announced after an unblock. */
  readonly unblocked: string;
  readonly failures: BlockFailureCopy;
}

export interface BlockFailureCopy {
  readonly refused: string;
  readonly unreachable: string;
  /** `CANNOT_BLOCK_STAFF`, in the reader's language rather than the service's English. */
  readonly staff: string;
  /** `CANNOT_BLOCK_YOURSELF`. The controls are not offered to the author, so rarely seen. */
  readonly self: string;
}

/** `/settings/privacy`'s list of blocked accounts. */
export interface BlockedListCopy {
  readonly title: string;
  readonly intro: string;
  /** The skeleton's accessible name. */
  readonly loading: string;
  readonly failedTitle: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** The line under a row. Carries `{time}`. */
  readonly meta: string;
  readonly unblock: string;
  /** The button's accessible name, carrying `{name}`, so a list of them can be told apart. */
  readonly unblockLabel: string;
  readonly unblockFailedTitle: string;
  /** Carries `{name}`, and says the block is still in place. */
  readonly unblockFailedBody: string;
  readonly showMore: string;
  readonly loadingMore: string;
  readonly nextPageFailed: string;
}

/** From `blocking`. */
export function blockControlCopyFrom(t: BlockTranslator): BlockControlCopy {
  return {
    trigger: t('trigger'),
    warning: t('warning'),
    confirm: t('confirm'),
    blocking: t('blocking'),
    cancel: t('cancel'),
    blockedState: t('blockedState'),
    unblock: t('unblock'),
    unblocking: t('unblocking'),
    blocked: t('blocked'),
    unblocked: t('unblocked'),
    failures: {
      refused: t('failures.refused'),
      unreachable: t('failures.unreachable'),
      staff: t('failures.staff'),
      self: t('failures.self'),
    },
  };
}

/** From `blocking.list`, with the paginator's three words from `common.list`. */
export function blockedListCopyFrom(t: BlockTranslator, common: BlockTranslator): BlockedListCopy {
  return {
    title: t('list.title'),
    intro: t('list.intro'),
    loading: t('list.loading'),
    failedTitle: t('list.failedTitle'),
    emptyTitle: t('list.emptyTitle'),
    emptyBody: t('list.emptyBody'),
    meta: String(t.raw('list.meta')),
    unblock: t('list.unblock'),
    unblockLabel: String(t.raw('list.unblockLabel')),
    unblockFailedTitle: t('list.unblockFailedTitle'),
    unblockFailedBody: String(t.raw('list.unblockFailedBody')),
    showMore: common('list.showMore'),
    loadingMore: common('list.loadingMore'),
    nextPageFailed: common('list.nextPageFailed'),
  };
}
