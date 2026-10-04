import { forwardRef, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../../../icons';
import type { CampaignComment } from '@ideanest/campaign/comments';
import { useMe } from '../../../../lib/account';
import { withdrawComment, withdrawFailureOf } from '../../../../lib/comments';
import { formatInstant, useT } from '../../../../lib/i18n';
import { useLocale } from '../../../../lib/locale';
import { useSession } from '../../../../lib/use-session';
import {
  colors,
  font,
  fontSize,
  lineHeight,
  radius,
  readingMeasure,
  size,
  spacing,
  tint,
} from '../../../../theme';
import { Icon, Pill, Tag, announce, useFocusRing, type IconComponent } from '../../../ui';
import { FOCUS_DELAY_MS, focusOn } from '../../../ui/overlay';
import { ReportTrigger } from '../../report-link';
import { CommentComposer } from './comment-composer';

/**
 * One comment — the web's `CommentEntry` and `CommentControls` (#155).
 *
 * <h2>The creator's answer is a word, a rule and a surface — never a colour alone</h2>
 *
 * `byCreator` is settled by the server at write time. It is drawn three ways at once: the tag
 * "From the campaign", a 2pt white/40 rule down the left, and the lighter `surface-3`. Not lime:
 * a creator's reply is authoritative, not urgent.
 *
 * <h2>A withdrawn comment is a tombstone, and the row stays</h2>
 *
 * The service serves `body: null, authorId: null, deleted: true`, and this draws it as a grey line
 * in place — never a gap, never with the withdrawal attributed to anybody — and offers nothing
 * under it: nothing to answer, nothing to withdraw twice, nothing left for a moderator to read.
 *
 * <h2>Nobody is named</h2>
 *
 * The comment carries an account id and no public name, so there is no byline — as on the web,
 * which says why in `CampaignComments.tsx` and calls it a gap rather than a design. Nothing is
 * invented to fill it.
 *
 * <h2>The controls</h2>
 *
 * - **Reply**, where the service says the row accepts one (`acceptsReplies`, read, never
 *   recomputed from the depth): an inline composer under the comment.
 * - **Withdraw**, only to its author — the signed-in account's id (`GET /v1/me`) equal to the
 *   comment's `authorId`; the server decides again regardless. Asked in place, not in a dialog:
 *   the warning says the row and its replies stay and nothing can be restored, then "Withdraw it"
 *   or "Keep it". Afterwards the list is re-read, so the tombstone is the server's.
 * - **Report this comment**, opening the report sheet about "a comment on {title}".
 *
 * Offline, Withdraw and Report are disabled and say why; Reply still opens, and its Post says why.
 *
 * <p>Screen-reader focus follows the panel that opens in place: to the warning when Withdraw is
 * pressed, and back to Withdraw on "Keep it"; back to Reply when its form closes — cancelled or
 * posted — so a reader is never left on a control that has just been removed.
 */
export interface CommentCardProps {
  readonly comment: CampaignComment;
  readonly campaignTitle: string;
  readonly offline: boolean;
  /** Re-read the comments after a reply or a withdrawal, keeping the pages already shown. */
  readonly onChanged: () => Promise<unknown>;
}

export function CommentCard({ comment, campaignTitle, offline, onChanged }: CommentCardProps) {
  const t = useT('campaign.comments');
  const locale = useLocale();

  if (comment.deleted) {
    return (
      <View style={styles.tombstone} testID={`comment-${comment.id}`}>
        <Icon icon={Glyphs.MessageRemove} size={16} color={colors.textTertiary} />
        <Text style={styles.tombstoneText}>{t('withdrawn')}</Text>
      </View>
    );
  }

  const posted = formatInstant(comment.createdAt, locale);

  return (
    <View
      style={[styles.card, comment.byCreator && styles.byCreator]}
      testID={`comment-${comment.id}`}
    >
      {comment.byCreator || posted !== null ? (
        <View style={styles.meta}>
          {comment.byCreator ? <Tag label={t('fromCreator')} /> : null}
          {posted === null ? null : <Text style={styles.date}>{posted}</Text>}
        </View>
      ) : null}

      <Text style={styles.body}>{comment.body}</Text>

      <CommentControls
        comment={comment}
        campaignTitle={campaignTitle}
        offline={offline}
        onChanged={onChanged}
      />
    </View>
  );
}

function CommentControls({ comment, campaignTitle, offline, onChanged }: CommentCardProps) {
  const t = useT('campaign.comments');
  const tAll = useT();
  const { signedIn } = useSession();
  const me = useMe();

  const [replying, setReplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replyButton = useRef<View>(null);
  const withdrawButton = useRef<View>(null);
  const warning = useRef<Text>(null);
  /** Where screen-reader focus goes once the next render has drawn it. */
  const [focusNext, setFocusNext] = useState<'warning' | 'withdraw' | 'reply' | null>(null);

  useEffect(() => {
    if (focusNext === null) return undefined;
    const target = { warning, withdraw: withdrawButton, reply: replyButton }[focusNext];
    // After the frame that mounts it: a focus event sent to a view drawn in the same frame is lost.
    const timer = setTimeout(() => {
      focusOn(target.current);
      setFocusNext(null);
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusNext]);

  const closeReply = () => {
    setReplying(false);
    setFocusNext('reply');
  };

  const viewerId = signedIn ? (me.data?.id ?? null) : null;
  const isAuthor = viewerId !== null && comment.authorId !== null && viewerId === comment.authorId;
  const offlineReason = tAll('mobile.campaign.comments.offline');

  const withdraw = async () => {
    if (busy || offline) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawComment(comment.id);
      setConfirming(false);
      await onChanged();
    } catch (cause) {
      const failure = withdrawFailureOf(cause);
      const message =
        failure.kind === 'detail'
          ? failure.text
          : failure.kind === 'notWithdrawn'
            ? t('failures.notWithdrawn')
            : t('failures.withdrawUnreachable');
      setError(message);
      // Android reads the alert's live region below; iOS has none, so it is said here.
      if (Platform.OS === 'ios') announce(message, { assertive: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.controls}>
      <View style={styles.controlRow}>
        {comment.acceptsReplies ? (
          <TextButton
            ref={replyButton}
            icon={Glyphs.Back}
            label={t('reply')}
            expanded={replying}
            onPress={() => setReplying((open) => !open)}
            testID={`reply-${comment.id}`}
          />
        ) : null}
        {isAuthor && !confirming ? (
          <TextButton
            ref={withdrawButton}
            icon={Glyphs.Trash}
            label={t('withdraw')}
            disabled={offline}
            hint={offline ? offlineReason : undefined}
            onPress={() => {
              setConfirming(true);
              setFocusNext('warning');
            }}
            testID={`withdraw-${comment.id}`}
          />
        ) : null}
        <ReportTrigger
          target={{ kind: 'comment', id: comment.id }}
          name={tAll('moderation.report.commentOn', { title: campaignTitle })}
          offline={offline}
          showsOfflineReason={false}
        />
      </View>

      {confirming ? (
        <View style={styles.confirm} testID={`withdraw-confirm-${comment.id}`}>
          <Text ref={warning} style={styles.warning} testID={`withdraw-warning-${comment.id}`}>
            {t('withdrawWarning')}
          </Text>
          <View style={styles.confirmActions}>
            <Pill
              label={busy ? t('withdrawing') : t('withdrawConfirm')}
              variant="danger"
              size="sm"
              busy={busy}
              disabled={offline}
              accessibilityHint={offline ? offlineReason : undefined}
              onPress={() => void withdraw()}
              testID={`withdraw-it-${comment.id}`}
            />
            <Pill
              label={t('keep')}
              variant="ghost"
              size="sm"
              onPress={() => {
                setConfirming(false);
                setError(null);
                setFocusNext('withdraw');
              }}
            />
          </View>
        </View>
      ) : null}

      {error === null ? null : (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.error}
          testID={`withdraw-error-${comment.id}`}
        >
          {error}
        </Text>
      )}

      {replying ? (
        <CommentComposer
          target={{ kind: 'reply', commentId: comment.id }}
          label={t('replyLabel')}
          submitLabel={t('postReply')}
          offline={offline}
          onPosted={onChanged}
          onCancel={closeReply}
          testID={`reply-composer-${comment.id}`}
        />
      ) : null}
    </View>
  );
}

/** Hit slop above and below a line of small text, so its target is 44pt and its row is not. */
const REACH = Math.max(0, (size.touchTarget - lineHeight.small) / 2);

/** A small, quiet control under a comment: an icon and a word, a 44pt target. */
const TextButton = forwardRef<
  View,
  {
    readonly icon: IconComponent;
    readonly label: string;
    readonly onPress: () => void;
    readonly disabled?: boolean;
    readonly hint?: string | undefined;
    readonly expanded?: boolean;
    readonly testID?: string;
  }
>(function TextButton({ icon, label, onPress, disabled = false, hint, expanded, testID }, ref) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      hitSlop={{ top: REACH, bottom: REACH }}
      style={[styles.textButton, disabled && styles.disabled, ring]}
      testID={testID}
    >
      <Icon icon={icon} size={14} color={colors.textSecondary} />
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  // The campaign's own answer: a lighter surface and a 2pt white/40 rule, beside its tag.
  byCreator: {
    backgroundColor: colors.surface3,
    borderLeftWidth: 2,
    borderLeftColor: tint(colors.textPrimary, 0.4),
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  date: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textTertiary,
  },
  body: {
    ...font.regular,
    maxWidth: readingMeasure,
    fontSize: fontSize.row,
    lineHeight: lineHeight.body,
    color: colors.textReading,
  },
  tombstone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  tombstoneText: {
    ...font.regular,
    flexShrink: 1,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textTertiary,
  },
  controls: { gap: spacing[3] },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing[4] },
  textButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    borderRadius: radius.sm,
  },
  disabled: { opacity: 0.4 },
  textButtonLabel: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  confirm: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface3,
  },
  warning: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textReading,
  },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  error: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.danger,
  },
});
