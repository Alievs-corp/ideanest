import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { useT } from '../../lib/i18n';
import {
  looksLikeAnAddress,
  prelaunchFailure,
  remindersClosed,
  remindMe,
  type PrelaunchFailure,
} from '../../lib/prelaunch';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../theme';
import { Body, CardTitle } from '../text';
import { announce, Field, Icon, Pill, TextInput } from '../ui';

/**
 * The card that asks to be told when the campaign opens — the form half of the web's
 * `PrelaunchView`, issue #155.
 *
 * <h2>No session is required, and that is the feature</h2>
 *
 * The people a pre-launch page exists to collect have often never heard of the platform, so a
 * guest types an address and the service stores it. A signed-in reader is not shown the field at
 * all: the reminder is registered against the account, which is exactly what the request will do
 * with the bearer on it, so the form shows what is about to happen rather than offering a field
 * the server would ignore.
 *
 * <h2>The one lime control on the screen</h2>
 *
 * "Remind me" is the page's urgent action and its only one (docs/ui-kit.md §7.2): an accent pill,
 * near-black words on lime. It reads "Adding you" while the request is out, a word rather than a
 * spinner standing in for one, as on the web.
 *
 * <h2>Outside the FadeUp</h2>
 *
 * The screen animates only the block above this card. Motion decreases as the reader gets closer
 * to acting (docs/motion-system.md §5), and the signup is the action.
 *
 * <h2>Offline</h2>
 *
 * The request could only fail, so the field and the pill are disabled and the card says why, in
 * the same sentence a failed request would have used. Nothing is announced for it: the offline
 * banner has already said the connection went.
 */
export interface PrelaunchFormProps {
  readonly projectId: string;
  readonly signedIn: boolean;
  /** No connection: the form is drawn disabled, with the unreachable sentence. */
  readonly offline: boolean;
  /** The count the service answered after this reader joined. */
  readonly onFollowerCount: (count: number) => void;
  /** `REMINDERS_CLOSED`: the campaign opened while the page was on screen. */
  readonly onClosed: () => void;
}

export function PrelaunchForm({
  projectId,
  signedIn,
  offline,
  onFollowerCount,
  onClosed,
}: PrelaunchFormProps) {
  const t = useT('campaign.prelaunch');
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [following, setFollowing] = useState(false);

  const describe = (reason: PrelaunchFailure): string =>
    reason.key === 'rateLimitedIn'
      ? t('errors.rateLimitedIn', { minutes: String(reason.minutes) })
      : t(`errors.${reason.key}`);

  async function submit(): Promise<void> {
    if (offline || submitting) return;
    setFailure(null);

    if (!signedIn && !looksLikeAnAddress(email)) {
      // `Field` draws it under the input and announces it assertively.
      setFieldError(t('emailInvalid'));
      return;
    }
    setFieldError(null);
    setSubmitting(true);

    try {
      const result = await remindMe(projectId, signedIn ? null : email.trim());
      if (result.followerCount !== null) onFollowerCount(result.followerCount);
      setFollowing(true);
      // Polite: an outcome the reader asked for, not an interruption — the web's `role="status"`.
      announce(t('onListAnnouncement'));
    } catch (cause) {
      if (remindersClosed(cause)) {
        /*
         * The reader left the page open until the campaign opened. Telling them the signup failed
         * would be true and useless; what changed is that there is a campaign to look at now.
         */
        onClosed();
        return;
      }
      const message = describe(prelaunchFailure(cause));
      setFailure(message);
      // The web's `role="alert"`: somebody who pressed the button and heard nothing believes it worked.
      announce(message, { assertive: true });
    } finally {
      setSubmitting(false);
    }
  }

  if (following) {
    /*
     * Replaces the form rather than sitting under it. Leaving the button on screen invites a
     * second press and the question of whether the reader is now on the list twice.
     */
    return (
      <View style={styles.card} testID="prelaunch-following">
        <View style={styles.success}>
          <View style={styles.successIcon}>
            <Icon icon={CircleCheck} size={20} color={colors.success} />
          </View>
          <View style={styles.words}>
            <CardTitle accessibilityRole="header" style={styles.cardHeading}>
              {t('onListTitle')}
            </CardTitle>
            <Body style={styles.small}>{signedIn ? t('onListSignedIn') : t('onListGuest')}</Body>
          </View>
        </View>
      </View>
    );
  }

  // Offline outranks an earlier failure: it is the reason the next press cannot work either.
  const errorLine = offline ? t('errors.unreachable') : failure;

  return (
    <View style={styles.card} testID="prelaunch-form">
      <View style={styles.words}>
        <CardTitle accessibilityRole="header" style={styles.cardHeading}>
          {t('formTitle')}
        </CardTitle>
        <Body style={styles.small}>{t('formIntro')}</Body>
      </View>

      {errorLine === null ? null : (
        // An icon and words, never the colour alone (docs/ui-kit.md §9.2).
        <View style={styles.error} accessible accessibilityLabel={errorLine} testID="prelaunch-error">
          <View style={styles.errorIcon}>
            <Icon icon={CircleAlert} size={14} color={colors.danger} />
          </View>
          <Text style={styles.errorText}>{errorLine}</Text>
        </View>
      )}

      {signedIn ? (
        <Body style={styles.small}>{t('accountAddress')}</Body>
      ) : (
        <Field label={t('emailLabel')} required error={fieldError}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t('emailPlaceholder')}
            keyboardType="email-address"
            inputMode="email"
            autoComplete="email"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            disabled={offline || submitting}
            testID="prelaunch-email"
          />
        </Field>
      )}

      <View>
        <Pill
          label={submitting ? t('submitting') : t('submit')}
          variant="accent"
          size="lg"
          disabled={offline || submitting}
          onPress={() => void submit()}
          testID="prelaunch-submit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing[6],
    gap: spacing[4],
  },
  words: { flex: 1, minWidth: 0, gap: spacing[1] },
  // The web's `text-base font-semibold`: a card heading, not a section one.
  cardHeading: { ...font.semibold, fontSize: fontSize.base, lineHeight: lineHeight.body },
  small: { fontSize: fontSize.sm, lineHeight: lineHeight.small },
  success: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  // Centres the 20pt glyph on the heading's first line.
  successIcon: { height: lineHeight.body, justifyContent: 'center' },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  errorIcon: { height: lineHeight.small, justifyContent: 'center' },
  errorText: {
    ...font.regular,
    flex: 1,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
    color: colors.danger,
  },
});
