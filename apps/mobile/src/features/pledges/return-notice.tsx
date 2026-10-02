import {
  paymentReturnOutcome,
  raiseReturnOutcome,
  type PaymentReturnHint,
} from '@ideanest/checkout/pledge';
import type { PledgeRaise } from '@ideanest/checkout/types';
import { InlineAlert } from '../../components/ui';
import { formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';

export function PaymentReturnNotice({ hint, state }: { readonly hint: PaymentReturnHint; readonly state: string }) {
  const t = useT('checkout.returned');
  const outcome = paymentReturnOutcome(hint, state);
  if (outcome === null) return null;
  const variant = outcome === 'paid' ? 'success' : outcome === 'waiting' ? 'info' : 'warning';
  const key = outcome === 'paid' ? 'paid' : outcome === 'waiting' ? 'waiting' : 'failed';
  return (
    <InlineAlert
      variant={variant}
      title={t(`${key}Title`)}
      description={t(`${key}Body`)}
      politeness="polite"
      testID={`payment-${outcome}`}
    />
  );
}

export function RaiseReturnNotice({
  hint,
  raise,
  now = Date.now(),
}: {
  readonly hint: PaymentReturnHint;
  readonly raise: PledgeRaise | null | undefined;
  readonly now?: number;
}) {
  const t = useT('account.pledges.manager.raiseReturned');
  const tReturned = useT('checkout.returned');
  const locale = useLocale();
  const outcome = raiseReturnOutcome(hint, raise, now);
  if (outcome === null || raise == null) return null;

  const content =
    outcome === 'raised'
      ? { variant: 'success' as const, title: t('raisedTitle'), body: t('raisedBody') }
      : outcome === 'unapplied'
        ? { variant: 'warning' as const, title: t('unappliedTitle'), body: t('unappliedBody') }
        : outcome === 'waiting'
          ? { variant: 'info' as const, title: tReturned('waitingTitle'), body: tReturned('waitingBody') }
          : outcome === 'held'
            ? {
                variant: 'warning' as const,
                title: t('failedTitle'),
                body: t('heldBody', { time: formatDateTime(raise.holdExpiresAt, locale) }),
              }
            : { variant: 'warning' as const, title: t('failedTitle'), body: t('failedBody') };

  return (
    <InlineAlert
      variant={content.variant}
      title={content.title}
      description={content.body}
      politeness="polite"
      testID={`raise-${outcome}`}
    />
  );
}
