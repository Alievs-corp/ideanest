import { forwardRef, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
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
import { toneColor } from '../../../text';
import {
  Icon,
  Pill,
  SurfaceProvider,
  TONES,
  Tag,
  announce,
  useFocusRing,
  usePressScale,
  useSurface,
  type IconComponent,
} from '../../../ui';
import { errorTextColor } from '../../../ui/field';
import { FOCUS_DELAY_MS, focusOn } from '../../../ui/overlay';
import { BLOCK, blockSurface, type BlockSurface } from '../../../ui/surface';
import { ReportTrigger } from '../../report-link';
import { CommentComposer } from './comment-composer';

/**
 * One comment — the web's `CommentEntry` and `CommentControls` (#155).
 *
 * <h2>The creator's answer is a word, a rule and a surface — never a colour alone</h2>
 *
 * `byCreator` is settled by the server at write time. It is drawn three ways at once: the tag
 * "From the campaign", a 2pt rule down the left in the surface's ink at 40%, and a deeper block
 * (`surface-3` on the canvas, a black/8 layer inside the white content sheet). Not lime: a
 * creator's reply is authoritative, not urgent.
 *
 * <p>The card is a raised block of the surface it is drawn on (`mobile-design` skill §2) —
 * `whiteMuted` inside the campaign page's white sheet — and gives its own surface to what is in
 * it. It is not a control (nothing opens a comment), so it does not press; the controls under it
 * do.
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
  const block = blockSurface(useSurface());
  const tone = TONES[block];

  if (comment.deleted) {
    return (
      <View
        style={[styles.tombstone, { backgroundColor: BLOCK[block].rest }]}
        testID={`comment-${comment.id}`}
      >
        <Icon icon={Glyphs.MessageRemove} size={16} color={tone.secondary} />
        <Text style={[styles.tombstoneText, { color: tone.secondary }]}>{t('withdrawn')}</Text>
      </View>
    );
  }

  const posted = formatInstant(comment.createdAt, locale);

  return (
    <View
      style={[
        styles.card,
        comment.byCreator ? creatorSkin(block) : { backgroundColor: BLOCK[block].rest },
      ]}
      testID={`comment-${comment.id}`}
    >
      <SurfaceProvider surface={block}>
        {comment.byCreator || posted !== null ? (
          <View style={styles.meta}>
            {comment.byCreator ? <Tag label={t('fromCreator')} /> : null}
            {posted === null ? null : (
              <Text style={[styles.date, { color: tone.secondary }]}>{posted}</Text>
            )}
          </View>
        ) : null}

        <Text style={[styles.body, { color: toneColor('reading', block) }]}>{comment.body}</Text>

        <CommentControls
          comment={comment}
          campaignTitle={campaignTitle}
          offline={offline}
          onChanged={onChanged}
        />
      </SurfaceProvider>
    </View>
  );
}

/** The campaign's own answer: a deeper block and a rule in the surface's ink, beside its tag. */
function creatorSkin(block: BlockSurface) {
  return block === 'white'
    ? {
        backgroundColor: BLOCK.white.pressed,
        borderLeftWidth: 2,
        borderLeftColor: tint(colors.textOnWhite, 0.4),
      }
    : {
        backgroundColor: colors.surface3,
        borderLeftWidth: 2,
        borderLeftColor: tint(colors.textPrimary, 0.4),
      };
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

  const surface = useSurface();
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
        <View
          style={[
            styles.confirm,
            { backgroundColor: surface === 'white' ? colors.whiteSurface : colors.surface3 },
          ]}
          testID={`withdraw-confirm-${comment.id}`}
        >
          <Text
            ref={warning}
            style={[styles.warning, { color: toneColor('reading', surface) }]}
            testID={`withdraw-warning-${comment.id}`}
          >
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
              variant="outline"
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
        // An icon and words, never the colour alone; on white the words take the surface's ink.
        <View style={styles.errorRow}>
          <Icon icon={Glyphs.Warning2} size={14} color={colors.danger} />
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={[styles.error, { color: errorTextColor(surface) }]}
            testID={`withdraw-error-${comment.id}`}
          >
            {error}
          </Text>
        </View>
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

/**
 * A small, quiet control under a comment: an icon and a word, a 44pt target, the press scale. The
 * scale is on a wrapper so the ref stays on the `Pressable` the focus moves back to.
 */
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
  const press = usePressScale();
  const tone = TONES[useSurface()];
  return (
    <Animated.View style={press.style}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={{ top: REACH, bottom: REACH }}
        style={[styles.textButton, disabled && styles.disabled, ring]}
        testID={testID}
      >
        <Icon icon={icon} size={14} color={tone.secondary} />
        <Text style={[styles.textButtonLabel, { color: tone.secondary }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radius.lg,
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  date: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
  },
  body: {
    ...font.regular,
    maxWidth: readingMeasure,
    fontSize: fontSize.row,
    lineHeight: lineHeight.body,
  },
  tombstone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
  },
  tombstoneText: {
    ...font.regular,
    flexShrink: 1,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
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
  },
  // A block nested in the card: one step off the card's own fill, never a border-only box.
  confirm: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.lg,
  },
  warning: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
  },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  error: {
    ...font.regular,
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
  },
});
