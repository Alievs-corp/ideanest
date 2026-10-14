import { useMemo, useState, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../../icons';
import { CAMPAIGN_THREAD_PARAM, campaignCursorFrom } from '@ideanest/campaign/tabs';
import { useBlockedIds, withoutBlocked } from '../../../lib/blocks';
import { conversationOf, threadsOf, useCommentThreads } from '../../../lib/comments';
import { useT } from '../../../lib/i18n';
import { useSession } from '../../../lib/use-session';
import { font, fontSize, lineHeight, spacing, tracking } from '../../../theme';
import { Icon, Pill, TONES, announce, useSurface } from '../../ui';
import { CommentCard } from './comments/comment-card';
import { CommentComposer } from './comments/comment-composer';
import { CommentThreadBlock, QuietLink, ReplyRow } from './comments/comment-thread';
import {
  INACTIVE_TAB,
  type CampaignTabBody,
  type CampaignTabContext,
  type CampaignTabRow,
} from './contract';

/**
 * The Comments tab (#155) — `useCommentsTab`, the web's `CampaignComments`, `CommentComposer` and
 * `CommentControls`, by the contract in `./contract.ts`.
 *
 * <h2>Rows</h2>
 *
 * The heading; the composer (or, signed out, the card that offers sign-in) above the list, where a
 * reader who wants to write can reach it without scrolling past a hundred comments; then one row
 * per conversation, newest first as the service pages them. Each later page is appended as more
 * rows — `onEndReached`, and the "Older comments" pill in the footer as the path a screen reader
 * can take — never replacing what is already shown (`lib/comments.ts` says how a cursor is never
 * asked for twice). A failed first read says the comments could not be loaded, which is a fact
 * about the service; none at all says nobody has commented, which is a fact about the campaign.
 *
 * <h2>The single-thread view</h2>
 *
 * "Show more replies" sets `?thread={rootId}` (so a link and state restoration see it) and brings
 * the tab to the top: the conversation alone — "← All comments" above it and **no composer**,
 * because a new conversation started from inside somebody else's would be easy to mistake for a
 * reply — its root, then its replies a row each, oldest first, paged with that thread's cursor.
 * "All comments" clears the parameter and returns to the top of the tab.
 *
 * <h2>Reading, refreshing, and what survives</h2>
 *
 * Nothing is read while the tab is not on screen. The query is under the `comments` root, which is
 * never persisted: a withdrawn or moderated comment must not outlive its withdrawal in a stranger's
 * offline cache. Pull to refresh and a new conversation re-read the first page alone (the new one
 * is at its top); a reply or a withdrawal re-reads every page shown, so the change appears where
 * the reader is.
 *
 * <p>Offline, every write is disabled and says why; what is already in memory is still shown. The
 * sentence is the composer's own notice where there is a composer; in the single-thread view and
 * for a signed-out reader there is none, so it stands once under the heading instead.
 *
 * <h2>What the reader blocked is left out — #324</h2>
 *
 * The read is made as nobody, so the service cannot leave out this reader's blocks; `useBlockedIds`
 * reads them through the session and the rows are built without them — a conversation a blocked
 * account started, whole, and each reply it wrote, which is what the service does for a read that
 * carries a token. A block made under a comment hides that account's comments at once, and a line
 * under the heading says so, where the card that was pressed used to be; it is announced too.
 */
export function useCommentsTab(context: CampaignTabContext): CampaignTabBody {
  const { campaign, active, offline, params, setParam, scrollToTabs } = context;
  const thread = campaignCursorFrom(params[CAMPAIGN_THREAD_PARAM]);

  // Every hook before the early return: all five tabs' hooks run on every render.
  const { signedIn } = useSession();
  const tAll = useT();
  const blocked = useBlockedIds();
  const [blockNotice, setBlockNotice] = useState<string | null>(null);
  const { query, loadMore, refreshFirstPage, refreshAll } = useCommentThreads(
    campaign.id,
    thread,
    active,
  );
  const pages = query.data?.pages;
  const threads = useMemo(
    () => (pages === undefined ? [] : withoutBlocked(threadsOf(pages), blocked.ids)),
    [pages, blocked.ids],
  );
  const conversation = useMemo(() => {
    const whole = pages === undefined ? null : conversationOf(pages);
    if (whole === null) return null;
    const [kept] = withoutBlocked([{ root: whole.root, replies: whole.replies, nextReplyCursor: null }], blocked.ids);
    return kept === undefined ? { blocked: true as const } : { ...whole, replies: kept.replies, blocked: false as const };
  }, [pages, blocked.ids]);

  if (!active) return INACTIVE_TAB;

  const openThread = (rootId: string) => {
    setParam(CAMPAIGN_THREAD_PARAM, rootId);
    scrollToTabs();
  };
  const leaveThread = () => {
    setParam(CAMPAIGN_THREAD_PARAM, null);
    scrollToTabs();
  };
  const refresh = () => refreshFirstPage().catch(() => undefined);
  const changed = () => refreshAll().catch(() => undefined);
  const onBlocked = (authorId: string) => {
    blocked.add(authorId);
    const said = tAll('blocking.blocked');
    setBlockNotice(said);
    announce(said);
  };

  // Offline with nothing in memory, the read waits for a connection; that is a failure to show,
  // not a placeholder to hold.
  const waiting = query.isPending && query.fetchStatus === 'fetching';
  if (waiting) {
    return { rows: [], footer: null, onEndReached: null, refresh, loading: true };
  }
  const failed = pages === undefined;

  const rows: CampaignTabRow[] = [{ key: 'heading', render: () => spaced(<CommentsHeading />, 8) }];
  if (offline && (thread !== null || !signedIn)) {
    rows.push({ key: 'offline', render: () => spaced(<OfflineNote />, 3) });
  }
  if (blockNotice !== null) {
    rows.push({ key: 'blocked', render: () => spaced(<BlockedNote text={blockNotice} />, 4) });
  }

  if (thread === null) {
    rows.push({
      key: 'composer',
      render: () =>
        spaced(
          <TabComposer projectId={campaign.id} offline={offline} onPosted={refresh} />,
          6,
        ),
    });
    if (failed) {
      rows.push({ key: 'failed', render: () => spaced(<Note kind="failed" />, 6) });
    } else if (threads.length === 0) {
      rows.push({ key: 'empty', render: () => spaced(<Note kind="empty" />, 6) });
    } else {
      for (const item of threads) {
        rows.push({
          key: `thread:${item.root.id}`,
          render: () =>
            spaced(
              <CommentThreadBlock
                thread={item}
                campaignTitle={campaign.title}
                offline={offline}
                onChanged={changed}
                onBlocked={onBlocked}
                onShowMore={() => openThread(item.root.id)}
              />,
              6,
            ),
        });
      }
    }
  } else {
    rows.push({ key: 'all', render: () => spaced(<AllComments onPress={leaveThread} />, 4) });
    if (failed || conversation === null) {
      rows.push({ key: 'failed', render: () => spaced(<Note kind="failed" />, 6) });
    } else if (conversation.blocked) {
      // A conversation a blocked account started, opened by its address: not there for this
      // reader, as the tab does not show it. "All comments" above is the way back.
    } else {
      const { root, replies } = conversation;
      rows.push({
        key: `root:${root.id}`,
        render: () =>
          spaced(
            <CommentCard
              comment={root}
              campaignTitle={campaign.title}
              offline={offline}
              onChanged={changed}
              onBlocked={onBlocked}
            />,
            6,
          ),
      });
      for (const reply of replies) {
        rows.push({
          key: `reply:${reply.id}`,
          render: () => (
            <ReplyRow>
              <CommentCard
                comment={reply}
                campaignTitle={campaign.title}
                offline={offline}
                onChanged={changed}
                onBlocked={onBlocked}
              />
            </ReplyRow>
          ),
        });
      }
    }
  }

  const footer = query.isFetchNextPageError ? (
    <OlderFailed onRetry={loadMore} />
  ) : query.hasNextPage ? (
    <MorePill single={thread !== null} busy={query.isFetchingNextPage} onPress={loadMore} />
  ) : null;

  return {
    rows,
    footer,
    onEndReached: query.hasNextPage && !query.isFetchNextPageError ? loadMore : null,
    refresh,
    loading: false,
  };
}

function CommentsHeading() {
  const t = useT('campaign.comments');
  const tone = TONES[useSurface()];
  return (
    <Text
      accessibilityRole="header"
      style={[styles.heading, { color: tone.primary }]}
      testID="comments-heading"
    >
      {t('heading')}
    </Text>
  );
}

function TabComposer({
  projectId,
  offline,
  onPosted,
}: {
  readonly projectId: string;
  readonly offline: boolean;
  readonly onPosted: () => Promise<unknown>;
}) {
  const t = useT('campaign.comments');
  return (
    <CommentComposer
      target={{ kind: 'campaign', projectId }}
      label={t('composerLabel')}
      submitLabel={t('postComment')}
      offline={offline}
      onPosted={onPosted}
      testID="comment-composer"
    />
  );
}

function AllComments({ onPress }: { readonly onPress: () => void }) {
  const t = useT('campaign.comments');
  const tone = TONES[useSurface()];
  return (
    <QuietLink
      label={t('all')}
      onPress={onPress}
      leading={<Icon icon={Glyphs.ArrowLeft} size={16} color={tone.primary} />}
      testID="comments-all"
    />
  );
}

/** Why the writes under the comments are disabled, where no composer is there to say it. */
function OfflineNote() {
  const t = useT();
  const tone = TONES[useSurface()];
  return (
    <Text style={[styles.note, { color: tone.secondary }]} testID="comments-offline">
      {t('mobile.campaign.comments.offline')}
    </Text>
  );
}

/** What was just blocked, where the pressed card used to be (#324). Polite, and drawn as well as said. */
function BlockedNote({ text }: { readonly text: string }) {
  const tone = TONES[useSurface()];
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.note, { color: tone.secondary }]}
      testID="comments-blocked"
    >
      {text}
    </Text>
  );
}

function Note({ kind }: { readonly kind: 'failed' | 'empty' }) {
  const t = useT('campaign.comments');
  const tone = TONES[useSurface()];
  return (
    <Text style={[styles.note, { color: tone.secondary }]} testID={`comments-${kind}`}>
      {t(kind)}
    </Text>
  );
}

/**
 * The accessible way to the next page. In the tab it is "Older comments" — the list is newest
 * first; in one conversation the replies run oldest first, so the next page is "Show more replies".
 */
function MorePill({
  single,
  busy,
  onPress,
}: {
  readonly single: boolean;
  readonly busy: boolean;
  readonly onPress: () => void;
}) {
  const t = useT('campaign.comments');
  return (
    <View style={styles.footer}>
      <Pill
        label={single ? t('showReplies') : t('older')}
        variant="outline"
        size="sm"
        busy={busy}
        onPress={onPress}
        testID="comments-more"
      />
    </View>
  );
}

function OlderFailed({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();
  const tone = TONES[useSurface()];
  return (
    <View style={[styles.footer, styles.failedFooter]} testID="comments-older-failed">
      <Text style={[styles.note, { color: tone.secondary }]}>
        {t('mobile.campaign.comments.olderFailed')}
      </Text>
      <Pill label={t('common.tryAgain')} variant="outline" size="sm" onPress={onRetry} />
    </View>
  );
}

/** The space above a row: the web's `gap-8` before the tab's heading, `gap-6` between threads. */
function spaced(block: ReactElement, above: 3 | 4 | 6 | 8): ReactElement {
  return <View style={{ paddingTop: spacing[above] }}>{block}</View>;
}

const styles = StyleSheet.create({
  heading: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
  },
  note: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
  footer: { paddingTop: spacing[6], alignItems: 'flex-start' },
  failedFooter: { gap: spacing[3] },
});
