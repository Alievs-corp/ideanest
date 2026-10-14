import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import {
  Body,
  CharacterCount,
  Field,
  InlineAlert,
  Pill,
  Subheading,
  Textarea,
  announce,
} from '../../components/ui';
import { queryKeys } from '../../api/queries';
import { formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { spacing } from '../../theme';
import { openBackerDispute, readDisputeWindow } from './api';

export const DISPUTE_REASON_MAX = 2000;

export interface DisputeFormProps {
  readonly pledgeId: string;
  readonly disabled: boolean;
}

/**
 * A backer disputing their payment while the creator's payout is held (#43). The window is asked first
 * (#480), so the form is offered only when a dispute can be opened; a window that cannot be read falls
 * back to offering it, and the refusal is still worded.
 */
export function DisputeForm({ pledgeId, disabled }: DisputeFormProps) {
  const t = useT('checkout.dispute');
  const locale = useLocale();
  const disputeWindow = useQuery({
    queryKey: queryKeys.disputeWindow(pledgeId),
    queryFn: ({ signal }) => readDisputeWindow(pledgeId, signal),
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (opened) announce(t('opened'));
  }, [opened, t]);

  async function submit() {
    const trimmed = reason.trim();
    if (busy || disabled || trimmed === '') return;
    setBusy(true);
    setError(null);
    try {
      await openBackerDispute(pledgeId, trimmed);
      setOpened(true);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.problem?.code : undefined;
      setError(
        code === 'DISPUTE_WINDOW_CLOSED'
          ? t('windowClosed')
          : code === 'NOTHING_TO_DISPUTE'
            ? t('nothing')
            : t('failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (disputeWindow.isPending) return null;
  const status = disputeWindow.data?.status;
  if (status === 'CLOSED' || status === 'NOTHING_LEFT') return null;
  if (status === 'NOT_YET') {
    return (
      <Body tone="secondary" testID="dispute-not-yet">
        {t('notYet')}
      </Body>
    );
  }
  const until = status === 'OPEN' ? (disputeWindow.data?.until ?? null) : null;

  if (opened || (disputeWindow.data?.dispute ?? null) !== null) {
    return (
      <InlineAlert
        variant="info"
        title={t('heading')}
        description={t('opened')}
        politeness="off"
        testID="dispute-opened"
      />
    );
  }

  if (!open) {
    return (
      <View style={styles.start}>
        <Pill
          variant="ghost"
          label={t('heading')}
          disabled={disabled}
          onPress={() => setOpen(true)}
          testID="dispute-open"
        />
        {until === null ? null : (
          <Body tone="secondary" testID="dispute-until">
            {t('until', { date: formatDateTime(until, locale) })}
          </Body>
        )}
      </View>
    );
  }

  return (
    <View style={styles.section} testID="dispute-form">
      <Subheading accessibilityRole="header">{t('heading')}</Subheading>
      <Body>{t('intro')}</Body>
      <Field label={t('reasonLabel')} hint={t('reasonHint')} required>
        <Textarea
          value={reason}
          maxLength={DISPUTE_REASON_MAX}
          disabled={busy}
          onChangeText={(next) => {
            setReason(next);
            setError(null);
          }}
          testID="dispute-reason"
        />
        <CharacterCount count={reason.length} limit={DISPUTE_REASON_MAX} />
      </Field>
      {error === null ? null : (
        <InlineAlert variant="danger" description={error} politeness="assertive" testID="dispute-error" />
      )}
      <View style={styles.actions}>
        <Pill
          variant="outline"
          label={busy ? t('sending') : t('submit')}
          busy={busy}
          disabled={disabled || reason.trim() === ''}
          onPress={() => void submit()}
          testID="dispute-submit"
        />
        <Pill variant="ghost" label={t('cancel')} disabled={busy} onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  start: { alignItems: 'flex-start' },
  // A section of the pledge page's white sheet; the kit's fields draw themselves for white.
  section: { gap: spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
});
