/**
 * Every word the two lists under `/account/saved` and `/account/following` draw — issue #83.
 *
 * <h2>One shape, twice</h2>
 *
 * The two panels are the same panel with different nouns: a paginated list with an empty
 * state, a "show more" button, a load refusal and an optimistic removal that reverts. Two
 * parallel interfaces would be two places to add the next field to and two chances to add it
 * to only one, so there is one {@link SignalListCopy} and two builders that fill it — and the
 * components differ in what they render around it rather than in the shape they are handed.
 *
 * <p>The nouns are the point of the difference and they are all in the catalogue: "Remove"
 * against "Unfollow", a campaign's title against a creator's name. Nothing here decides which
 * is which; the key path does.
 *
 * <h2>Why it is a prop rather than a hook</h2>
 *
 * Both panels are client components and have to be — the list is one account's, read in the
 * browser with a bearer token the server never sees. `lib/i18n/shell-copy.ts` carries the
 * measurement that made a `NextIntlClientProvider` the wrong answer for a surface like this
 * one, and this is the arrangement it reached: the route resolves the words, the component
 * draws them.
 *
 * <h2>Three of these words are `common`'s</h2>
 *
 * "Show more", its waiting label and "The next page did not load" are the paginator's, and
 * the paginator is not this screen's — `components/pledges` draws the same three and
 * `components/surveys` will. They live under `common.list` so that the day one of them is
 * reworded there is one place to reword it. "Browse campaigns" is `common`'s for the same
 * reason: it is the way out of every empty list on the platform.
 *
 * <p>`following.emptyAction` is not, and that asymmetry is deliberate. "Find creators" sends
 * somebody to look for people rather than for campaigns, and no other empty state on the
 * platform says it.
 *
 * <h2>What is deliberately NOT here</h2>
 *
 * `account.pledges.list` still carries its own `showMore`, `loadingMore`, `nextPageFailed`
 * and `browse`. Moving it onto `common.list` is a change to a screen this issue does not
 * touch, and #78's children are one surface each on purpose.
 */

/** A message lookup over a namespace, narrowed to what these builders need. */
export interface SignalsTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** §4.9's C-10 — one paginated list of things this account chose to keep. */
export interface SignalListCopy {
  /** The skeleton's accessible name, which says what is being waited for. */
  readonly loading: string;
  readonly failedTitle: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** The way out of the empty state: to campaigns, or to creators. */
  readonly emptyAction: string;
  /** The line under a row. Carries `{time}` and `{creator}`. */
  readonly meta: string;
  /** The row's button: "Remove", or "Unfollow". */
  readonly remove: string;
  /**
   * That button's accessible name, carrying `{name}`.
   *
   * A list of eight buttons all called "Remove" is a list a screen reader cannot tell apart
   * (docs/ui-kit.md §9.4), so the title or the creator's name goes in the name itself.
   */
  readonly removeLabel: string;
  readonly removalFailedTitle: string;
  /** Carries `{name}`, and says the row is still there rather than apologising. */
  readonly removalFailedBody: string;
  readonly showMore: string;
  readonly loadingMore: string;
  readonly nextPageFailed: string;
}

/** The three words every cursor-paginated list on the platform ends with. */
function paginator(common: SignalsTranslator): Pick<
  SignalListCopy,
  'showMore' | 'loadingMore' | 'nextPageFailed'
> {
  return {
    showMore: common('list.showMore'),
    loadingMore: common('list.loadingMore'),
    nextPageFailed: common('list.nextPageFailed'),
  };
}

/** The campaigns this account saved — `/account/saved`. */
export function savedListCopyFrom(
  t: SignalsTranslator,
  common: SignalsTranslator,
): SignalListCopy {
  return {
    loading: t('saved.loading'),
    failedTitle: t('saved.failedTitle'),
    emptyTitle: t('saved.emptyTitle'),
    emptyBody: t('saved.emptyBody'),
    emptyAction: common('browseCampaigns'),
    meta: String(t.raw('saved.meta')),
    remove: t('saved.remove'),
    removeLabel: String(t.raw('saved.removeLabel')),
    removalFailedTitle: t('saved.removalFailedTitle'),
    removalFailedBody: String(t.raw('saved.removalFailedBody')),
    ...paginator(common),
  };
}

/** The creators this account follows — `/account/following`. */
export function followingListCopyFrom(
  t: SignalsTranslator,
  common: SignalsTranslator,
): SignalListCopy {
  return {
    loading: t('following.loading'),
    failedTitle: t('following.failedTitle'),
    emptyTitle: t('following.emptyTitle'),
    emptyBody: t('following.emptyBody'),
    emptyAction: t('following.emptyAction'),
    meta: String(t.raw('following.meta')),
    remove: t('following.remove'),
    removeLabel: String(t.raw('following.removeLabel')),
    removalFailedTitle: t('following.removalFailedTitle'),
    removalFailedBody: String(t.raw('following.removalFailedBody')),
    ...paginator(common),
  };
}
