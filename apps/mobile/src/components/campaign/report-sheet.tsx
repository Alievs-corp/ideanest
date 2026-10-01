import { useRef, useState, type RefObject } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  DETAIL_MAX_LENGTH,
  REPORT_REASONS,
  requiresDetail,
  type ReportReason,
  type ReportTarget,
} from '@ideanest/campaign/report';
import { useT } from '../../lib/i18n';
import { reportFailureOf, submitReport } from '../../lib/report';
import { useSession } from '../../lib/use-session';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { Field, InlineAlert, Pill, Radio, RadioGroup, Sheet, Textarea } from '../ui';

/**
 * The report sheet — the web's `ReportControl` dialog (`components/moderation/ReportControl.tsx`)
 * as a modal sheet, for a campaign (block 14) and for a comment (#155).
 *
 * <h2>The kit's `Sheet`, not a route</h2>
 *
 * A report is filed and gone: nobody navigates back to it, and the web gives it no address
 * either. That is exactly what the kit's `Sheet` is for (the WhatsApp enquiry is the other form in
 * one), and using it brings every way out #155 lists — dragging the header down, Cancel, the X,
 * the scrim, Android's back button, iOS's escape scrub — with focus moved to the title as it opens
 * and back to the control that opened it (`returnFocusTo`) as it closes. It rises from the bottom
 * on both platforms; under Reduce Motion it simply appears.
 *
 * <h2>Signed out is an invitation, never a form</h2>
 *
 * All three report endpoints need a bearer, and the duplicate suppression the feature is built on
 * "is unstateable without an identity to compare". So a guest is told why and offered sign-in,
 * never a form that collects a complaint and then loses it at the last step. Sign-in is pushed
 * once the sheet has gone: iOS presents one modal at a time, and a route pushed while this one is
 * still leaving would not appear.
 *
 * <h2>The form</h2>
 *
 * The nine reasons in `@ideanest/campaign/report`'s order, each named as the moderation console
 * names it (`admin.moderation.reason.*`) with the sentence a stranger needs under it
 * (`moderation.report.descriptions.*`). The detail is capped at `DETAIL_MAX_LENGTH` by the field
 * itself, and required only for `OTHER` — said under the field, and announced, when it is empty.
 * Send stays disabled until a reason is chosen. A refusal is the service's own sentence where it
 * sends one. Success replaces the form with an acknowledgement that claims nothing happened to the
 * target — a report is a request for a person to look, not a vote.
 *
 * <p>Offline, Send is disabled and the sheet says why, as the page's other writes do.
 */
export interface ReportSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly target: ReportTarget;
  /** What is reported, for the title "Report {name}": a campaign's title, "a comment on {title}". */
  readonly name: string;
  readonly offline: boolean;
  /** The control that opened the sheet, which gets focus back when it closes. */
  readonly returnFocusTo?: RefObject<unknown>;
}

export function ReportSheet({
  visible,
  onClose,
  target,
  name,
  offline,
  returnFocusTo,
}: ReportSheetProps) {
  const t = useT('moderation.report');
  const tAll = useT();
  const router = useRouter();
  const { signedIn } = useSession();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [detailError, setDetailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState(false);
  /** Sign-in was asked for: push it once the sheet has actually gone (iOS) or at once. */
  const signInNext = useRef(false);

  /*
   * What closing clears: the refusals, which answered a press and are not true next time. The
   * reason and the detail stay — the scrim is one stray tap from the detail box — unless the
   * report was filed, when the next opening is a new report.
   */
  function close(): void {
    setError(null);
    setDetailError(null);
    if (filed) {
      setFiled(false);
      setReason(null);
      setDetail('');
    }
    onClose();
  }

  function signIn(): void {
    if (Platform.OS === 'ios') {
      signInNext.current = true;
      close();
      return;
    }
    close();
    router.push('/sign-in');
  }

  async function submit(): Promise<void> {
    if (busy || reason === null || offline) return;
    if (requiresDetail(reason) && detail.trim() === '') {
      setDetailError(t('detailRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitReport(target, reason, detail);
      setFiled(true);
    } catch (cause) {
      const failure = reportFailureOf(cause);
      setError(
        failure.kind === 'detail'
          ? failure.text
          : failure.kind === 'refused'
            ? t('refused')
            : t('unreachable'),
      );
    } finally {
      setBusy(false);
    }
  }

  const offlineReason = tAll('mobile.campaign.report.offline');

  const footer = !signedIn ? (
    <>
      <Pill label={t('signIn')} size="lg" fullWidth onPress={signIn} testID="report-sign-in" />
      <Pill label={tAll('common.cancel')} variant="ghost" size="lg" fullWidth onPress={close} />
    </>
  ) : filed ? (
    <Pill label={t('close')} size="lg" fullWidth onPress={close} testID="report-close" />
  ) : (
    <>
      <Pill
        label={busy ? t('sending') : t('submit')}
        size="lg"
        fullWidth
        disabled={reason === null || offline}
        busy={busy}
        accessibilityHint={offline ? offlineReason : undefined}
        onPress={() => void submit()}
        testID="report-submit"
      />
      <Pill label={tAll('common.cancel')} variant="ghost" size="lg" fullWidth onPress={close} />
    </>
  );

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={t('dialogLabel', { name })}
      footer={footer}
      returnFocusTo={returnFocusTo}
      onDismiss={() => {
        if (!signInNext.current) return;
        signInNext.current = false;
        router.push('/sign-in');
      }}
      testID="report-sheet"
    >
      {!signedIn ? (
        <Text style={styles.body}>{t('signedOutBody')}</Text>
      ) : filed ? (
        <InlineAlert
          variant="success"
          title={t('filedTitle')}
          description={t(`filedBody.${target.kind}`)}
          testID="report-filed"
        />
      ) : (
        <View style={styles.form} testID="report-form">
          {error === null ? null : (
            <InlineAlert
              variant="danger"
              title={t('errorTitle')}
              description={error}
              testID="report-error"
            />
          )}

          <Field label={t('reasonLabel')} required grouped>
            <RadioGroup
              value={reason}
              onChange={(next) => {
                setReason(next as ReportReason);
                setError(null);
                setDetailError(null);
              }}
            >
              {REPORT_REASONS.map((option) => (
                <Radio
                  key={option}
                  value={option}
                  label={tAll(`admin.moderation.reason.${option}`)}
                  description={t(`descriptions.${option}`)}
                  testID={`report-reason-${option}`}
                />
              ))}
            </RadioGroup>
          </Field>

          <Field
            label={t('detailLabel')}
            hint={t('detailHint')}
            required={reason !== null && requiresDetail(reason)}
            error={detailError}
          >
            <Textarea
              value={detail}
              maxLength={DETAIL_MAX_LENGTH}
              onChangeText={(next) => {
                setDetail(next);
                setDetailError(null);
              }}
              testID="report-detail"
            />
          </Field>

          {offline ? <Text style={styles.offline}>{offlineReason}</Text> : null}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing[5] },
  body: {
    ...font.regular,
    fontSize: fontSize.row,
    lineHeight: lineHeight.body,
    color: colors.textSecondary,
  },
  offline: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
});
