import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import type { CheckoutFailure } from '@ideanest/checkout/failure';
import type { PublicReward } from '@ideanest/checkout/types';
import { InlineAlert, Meta, Pill } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';

export interface FailureNoticeProps {
  readonly failure: CheckoutFailure;
  readonly rewards: readonly PublicReward[];
  readonly stale: boolean;
  readonly onChoose: (rewardId: string) => void;
  readonly onRetry: () => void;
  readonly onReserveAgain: () => void;
  readonly onSignIn: () => void;
  readonly onOpenPledge: (pledgeId: string) => void;
  readonly existingPledgeId: string | null;
}

export function FailureNotice({
  failure,
  rewards,
  stale,
  onChoose,
  onRetry,
  onReserveAgain,
  onSignIn,
  onOpenPledge,
  existingPledgeId,
}: FailureNoticeProps) {
  const t = useT();
  const alternatives = failure.alternatives
    .map((id) => rewards.find((reward) => reward.id === id))
    .filter((reward): reward is PublicReward => reward !== undefined);

  let action = null;
  if (failure.status === 401) {
    action = <Pill size="sm" variant="ghost" label={t('mobile.checkout.signIn')} onPress={onSignIn} testID="failure-sign-in" />;
  } else if (failure.code === 'PLEDGE_ALREADY_EXISTS' || failure.code === 'PLEDGE_NOT_DRAFT') {
    action =
      existingPledgeId === null ? null : (
        <Pill
          size="sm"
          variant="ghost"
          label={t('mobile.checkout.openPledge')}
          onPress={() => onOpenPledge(existingPledgeId)}
          testID="failure-open-pledge"
        />
      );
  } else if (failure.recovery === 'redraft') {
    action = <Pill size="sm" variant="ghost" label={t('checkout.reserveAgain')} onPress={onReserveAgain} testID="failure-reserve-again" />;
  } else if (failure.recovery === 'retry' && !failure.clientBug) {
    action = <Pill size="sm" variant="ghost" label={t('checkout.tryAgain')} onPress={onRetry} testID="failure-try-again" />;
  }

  return (
    <InlineAlert
      variant="danger"
      title={failure.title}
      description={stale ? `${failure.detail} ${t('checkout.risk.stale')}` : failure.detail}
      politeness="assertive"
      testID="checkout-failure"
      action={
        alternatives.length === 0 && action === null ? undefined : (
          <View style={styles.actions}>
            {alternatives.length === 0 ? null : (
              <Meta tone="primary">{t('checkout.stillAvailable')}</Meta>
            )}
            {alternatives.map((reward) => (
              <Pill
                key={reward.id}
                size="sm"
                variant="ghost"
                label={`${reward.title} · ${formatMoney(reward.price)}`}
                onPress={() => onChoose(reward.id)}
                testID={`alternative-${reward.id}`}
              />
            ))}
            {action}
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing[2], alignItems: 'flex-start' },
});
