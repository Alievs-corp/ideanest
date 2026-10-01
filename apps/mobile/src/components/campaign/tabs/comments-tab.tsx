import { interimTabBody } from './interim-tab-body';
import { INACTIVE_TAB, type CampaignTabBody, type CampaignTabContext } from './contract';

/**
 * The Comments tab (#155) — `useCommentsTab`, consumed by `campaign-screen.tsx` as the body of
 * the page's list when `?tab=comments`. The contract is `./contract.ts`.
 *
 * <p>What the tab is to become — the web's `CampaignComments`, `CommentComposer` and
 * `CommentControls`, appending rather than replacing: the heading, the composer (or the signed-out
 * card), the threads with their replies, the tombstone for a withdrawn comment, Reply, Withdraw
 * for the author only, and "Report this comment". Pages of ten (`COMMENT_PAGE_SIZE`,
 * `readCommentPage`) by opaque cursor under `queryKeys.comments` — the `comments` root, which is
 * never persisted. `context.params.thread` is the single-thread view (no composer, "All comments"
 * at the top); `context.setParam('thread', id | null)` enters and leaves it, and
 * `context.scrollToTabs()` brings the reader back to the top of the tab when it does.
 *
 * <p>Until then the body is the interim card: this tab on the campaign's web page.
 */
export function useCommentsTab(context: CampaignTabContext): CampaignTabBody {
  if (!context.active) return INACTIVE_TAB;
  return interimTabBody(context.campaign, 'comments');
}
