import { useEffect } from 'react';
import {
  paymentReturnOutcome,
  raiseReturnOutcome,
  type PaymentReturnHint,
} from '@ideanest/checkout/pledge';
import type { PledgeRaise } from '@ideanest/checkout/types';
import { InlineAlert, announce } from '../../components/ui';
import { formatDateTime, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';

export function PaymentReturnNotice({ hint, state }: { readonly hint: PaymentReturnHint; readonly state: string }) {
  const t = useT('checkout.returned');
  const outcome = paymentReturnOutcome(hint, state);
  const key = outcome === 'paid' ? 'paid' : outcome === 'waiting' ? 'waiting' : 'failed';
  const title = outcome === null ? '' : t(`${key}Title`);
  const body = outcome === null ? '' : t(`${key}Body`);
  useEffect(() => {
    if (outcome !== null) announce(`${title}. ${body}`, { assertive: outcome === 'failed' });
  }, [outcome, title, body]);
  if (outcome === null) return null;
  const variant = outcome === 'paid' ? 'success' : outcome === 'waiting' ? 'info' : 'warning';
  return (
    <InlineAlert variant={variant} title={title} description={body} politeness="off" testID={`payment-${outcome}`} />
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
  const content =
    outcome === null || raise == null
      ? null
      :
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
  const words = content === null ? '' : `${content.title}. ${content.body}`;
  const assertive = content?.variant === 'warning';
  useEffect(() => {
    if (words !== '') announce(words, { assertive });
  }, [words, assertive]);
  if (content === null) return null;

  return (
    <InlineAlert
      variant={content.variant}
      title={content.title}
      description={content.body}
      politeness="off"
      testID={`raise-${outcome}`}
    />
  );
}
