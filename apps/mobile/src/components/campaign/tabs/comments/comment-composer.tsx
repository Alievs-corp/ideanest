import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isSubmittableComment } from '@ideanest/campaign/comments';
import { postComment, postFailureOf, replyToComment, type PostFailure } from '../../../../lib/comments';
import { pluralCategory, useT } from '../../../../lib/i18n';
import { useLocale } from '../../../../lib/locale';
import { useSession } from '../../../../lib/use-session';
import { font, fontSize, lineHeight, radius, size, spacing } from '../../../../theme';
import {
  Field,
  InlineAlert,
  Pill,
  SurfaceProvider,
  TONES,
  Textarea,
  announce,
  useSurface,
} from '../../../ui';
import { BLOCK, blockSurface } from '../../../ui/surface';

/**
 * Writing a comment, and answering one — the web's `CommentComposer` (§4.9's C-01 and C-03, #155).
 *
 * <h2>One component for both, because they are one form</h2>
 *
 * A new conversation and a reply differ by the endpoint they post to and by nothing a reader can
 * see: the same field, the same signed-out card, the same rate-limit sentence, the same re-read
 * afterwards. Two components would be two places for the 429 wording to drift.
 *
 * <h2>It does not build the new comment; it asks for the list again</h2>
 *
 * On success the field is cleared, `onPosted` re-reads the list, and then "Posted." is said — the first
 * page for a new conversation, which arrives at its top; every page shown for a reply, so the
 * reader stays where they are. Splicing the comment in locally would mean this component deciding
 * where a reply nests and whether its author speaks for the campaign, and §4.9 settles both on the
 * server precisely because a client cannot be trusted with them.
 *
 * <h2>What it checks, and what it leaves to the service</h2>
 *
 * Only "something was typed" (`isSubmittableComment`): §10.2 publishes no length bound, so a
 * maximum invented here would refuse a comment the platform would have accepted. Every other
 * refusal is the service's, in its own words where it sends them, and the catalogue's otherwise —
 * an expired session, a rate limit with its minutes declined in the reader's plural, no answer.
 *
 * <h2>Signed out is a card, never a form</h2>
 *
 * The write needs a bearer. A box that collects somebody's paragraph and then loses it at the last
 * step is worse than a card that says why first and opens sign-in, which closes back to this page.
 *
 * <p>Offline, Post is disabled and the line under it says why; the field still takes a draft.
 *
 * <p>Drawn in the campaign page's white content sheet, the field and the pills follow the surface
 * themselves; the signed-out card is a raised block of that surface (`whiteMuted` there).
 */
export type CommentTarget =
  | { readonly kind: 'campaign'; readonly projectId: string }
  | { readonly kind: 'reply'; readonly commentId: string };

export interface CommentComposerProps {
  readonly target: CommentTarget;
  /** The field's label — "Add a comment" or "Your reply" — so the two are told apart. */
  readonly label: string;
  readonly submitLabel: string;
  readonly offline: boolean;
  /** Re-read the list. Awaited before "Posted." is said, so the comment is there when it is. */
  readonly onPosted: () => Promise<unknown>;
  /** The reply form's Cancel, which also closes it after a post. Absent on the tab's composer. */
  readonly onCancel?: () => void;
  readonly testID?: string;
}

export function CommentComposer({
  target,
  label,
  submitLabel,
  offline,
  onPosted,
  onCancel,
  testID,
}: CommentComposerProps) {
  const t = useT('campaign.comments');
  const tAll = useT();
  const locale = useLocale();
  const router = useRouter();
  const { signedIn } = useSession();
  const surface = useSurface();
  const block = blockSurface(surface);

  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const messageFor = (failure: PostFailure): string => {
    switch (failure.kind) {
      case 'sessionExpired':
        return t('failures.sessionExpired');
      case 'rateLimited':
        return t('failures.rateLimited');
      case 'rateLimitedFor':
        return t(`failures.rateLimitedFor.${pluralCategory(locale, failure.minutes)}`, {
          count: String(failure.minutes),
        });
      case 'detail':
        return failure.text;
      case 'notPosted':
        return t('failures.notPosted');
      case 'unreachable':
        return t('failures.unreachable');
    }
  };

  if (!signedIn) {
    return (
      <View
        style={[styles.card, { backgroundColor: BLOCK[block].rest }]}
        testID={testID === undefined ? undefined : `${testID}-signed-out`}
      >
        <SurfaceProvider surface={block}>
          {/*
            A post refused with a 401 whose refresh was refused too ends the session, and the form
            turns into this card — so the reason it was not posted is kept above it, and what was
            typed is still in the field once the reader has signed in again.
          */}
          {error === null ? null : (
            <InlineAlert variant="danger" title={t('notPosted')} description={error} />
          )}
          <Text style={[styles.cardText, { color: TONES[block].secondary }]}>{t('signedOut')}</Text>
          <View style={styles.actions}>
            <Pill label={t('signIn')} size="sm" onPress={() => router.push('/sign-in')} />
            {onCancel === undefined ? null : (
              <Pill label={t('cancel')} variant="outline" size="sm" onPress={onCancel} />
            )}
          </View>
        </SurfaceProvider>
      </View>
    );
  }

  const submit = async () => {
    if (busy || offline) return;
    if (!isSubmittableComment(body)) {
      setError(t('failures.emptyBody'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'campaign') await postComment(target.projectId, body);
      else await replyToComment(target.commentId, body);
    } catch (cause) {
      setError(messageFor(postFailureOf(cause)));
      setBusy(false);
      return;
    }
    // Posted: the pill is free again at once, and the field is empty for the next one.
    setBusy(false);
    setBody('');
    /*
     * "Posted." once the list has been re-read, so it is said when the comment is there to be
     * found — on both platforms at the same moment. The tab's composer fills its live region
     * (Android reads it) and says it outright on iOS, which has none; a reply's form closes after
     * posting, taking its region with it, so it is said outright everywhere. The re-read never
     * rejects (`onPosted` settles either way).
     */
    await onPosted();
    setPosted(true);
    if (onCancel !== undefined || Platform.OS === 'ios') announce(t('posted'));
    onCancel?.();
  };

  const offlineReason = tAll('mobile.campaign.comments.offline');

  return (
    <View style={styles.form} testID={testID}>
      {error === null ? null : (
        <InlineAlert
          variant="danger"
          title={t('notPosted')}
          description={error}
          testID={testID === undefined ? undefined : `${testID}-error`}
        />
      )}

      <Field label={label}>
        <Textarea
          value={body}
          numberOfLines={3}
          onChangeText={(next) => {
            setBody(next);
            setError(null);
            setPosted(false);
          }}
          testID={testID === undefined ? undefined : `${testID}-field`}
        />
      </Field>

      <View style={styles.actions}>
        <Pill
          label={busy ? t('posting') : submitLabel}
          size="sm"
          busy={busy}
          disabled={offline}
          accessibilityHint={offline ? offlineReason : undefined}
          onPress={() => void submit()}
          testID={testID === undefined ? undefined : `${testID}-submit`}
        />
        {onCancel === undefined ? null : (
          <Pill label={t('cancel')} variant="outline" size="sm" onPress={onCancel} />
        )}
      </View>

      {/*
        Always mounted, so Android's live region exists before it has anything to say. Offline, the
        reason Post is disabled stands here until something else is said.
      */}
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.notice, { color: TONES[surface].secondary }]}
        testID={testID === undefined ? undefined : `${testID}-notice`}
      >
        {posted ? t('posted') : offline ? offlineReason : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing[3] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[3] },
  notice: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    minHeight: lineHeight.small,
  },
  card: {
    gap: spacing[3],
    padding: size.cardPaddingSmall,
    borderRadius: radius.xl,
  },
  cardText: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
});
