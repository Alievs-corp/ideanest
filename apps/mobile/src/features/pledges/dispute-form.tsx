import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError } from '@ideanest/api-client';
import {
  Body,
  CharacterCount,
  Field,
  InlineAlert,
  Pill,
  Subheading,
  Textarea,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import { colors, radius, size, spacing } from '../../theme';
import { openBackerDispute } from './api';

export const DISPUTE_REASON_MAX = 2000;

export interface DisputeFormProps {
  readonly pledgeId: string;
  readonly disabled: boolean;
}

export function DisputeForm({ pledgeId, disabled }: DisputeFormProps) {
  const t = useT('checkout.dispute');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

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

  if (opened) {
    return (
      <InlineAlert
        variant="info"
        title={t('heading')}
        description={t('opened')}
        politeness="polite"
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
      </View>
    );
  }

  return (
    <View style={styles.card} testID="dispute-form">
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
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: size.cardPaddingSmall,
    gap: spacing[4],
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
});
