import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CampaignCommentThread } from '@ideanest/campaign/comments';
import { useT } from '../../../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, size, spacing } from '../../../../theme';
import { useFocusRing } from '../../../ui';
import { CommentCard } from './comment-card';

/**
 * One conversation on the Comments tab (#155): the root, its preview of replies indented under a
 * left rule, and "Show more replies" when the service holds more than the preview carried
 * (`nextReplyCursor`). That control opens the single-thread view — the conversation alone, its
 * replies paged in full — rather than unfolding here, as the web's link does.
 *
 * <p>The order is the service's. Nothing is sorted: the replies are a keyset page oldest first,
 * and re-sorting would reorder a page relative to the cursor that produced it.
 */
export function CommentThreadBlock({
  thread,
  campaignTitle,
  offline,
  onChanged,
  onShowMore,
}: {
  readonly thread: CampaignCommentThread;
  readonly campaignTitle: string;
  readonly offline: boolean;
  readonly onChanged: () => Promise<unknown>;
  readonly onShowMore: () => void;
}) {
  const t = useT('campaign.comments');
  const hasMore = thread.nextReplyCursor !== null;

  return (
    <View testID={`thread-${thread.root.id}`}>
      <CommentCard
        comment={thread.root}
        campaignTitle={campaignTitle}
        offline={offline}
        onChanged={onChanged}
      />
      {thread.replies.length > 0 || hasMore ? (
        <View style={styles.replies}>
          {thread.replies.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              campaignTitle={campaignTitle}
              offline={offline}
              onChanged={onChanged}
            />
          ))}
          {hasMore ? (
            <QuietLink
              label={t('showReplies')}
              onPress={onShowMore}
              testID={`show-replies-${thread.root.id}`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A reply in the single-thread view: the same card, under the same rule as in the tab. */
export function ReplyRow({ children }: { readonly children: ReactNode }) {
  return <View style={[styles.replies, styles.replyRow]}>{children}</View>;
}

/** Hit slop above and below a line of small text, so its target is 44pt and its row is not. */
const REACH = Math.max(0, (size.touchTarget - lineHeight.small) / 2);

/** A line of white text that moves the reader within the tab — "Show more replies", "All comments". */
export function QuietLink({
  label,
  onPress,
  leading,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  /** A decorative glyph before the words — the arrow of "← All comments". */
  readonly leading?: ReactNode;
  readonly testID?: string;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      hitSlop={{ top: REACH, bottom: REACH }}
      style={[styles.link, ring]}
      testID={testID}
    >
      {leading}
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  replies: {
    marginTop: spacing[3],
    gap: spacing[3],
    paddingLeft: spacing[4],
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  replyRow: { marginTop: 0, paddingTop: spacing[3] },
  link: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    borderRadius: radius.sm,
  },
  linkText: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
  },
});
