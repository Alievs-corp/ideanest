import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatMoney, type Money } from '@ideanest/money';
import { WhatsAppSheet } from '../../components/whatsapp-sheet';
import { InlineAlert, Meta, Pill } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';

/**
 * A refund waiting to be paid by bank transfer — #400, the app's half of the web's
 * `RefundPendingNotice`.
 *
 * The provider could no longer send the money back to the card, so it goes by bank transfer and
 * support needs the account it should go to. A backer cannot raise a ticket from the app, so the
 * way to reach support is the WhatsApp sheet the app already has, opened here with the pledge
 * quoted in the message. The pledge is printed as well, selectable, for whoever gets in touch
 * another way: it is what support finds the refund by.
 *
 * <p>Polite rather than assertive: it is on the screen from the first paint, and interrupting
 * whatever a screen reader was saying on arrival would not make it any more true. Errors and
 * results elsewhere on this screen keep their own politeness.
 */
export function RefundPendingNotice({
  pledgeId,
  amount,
}: {
  readonly pledgeId: string;
  readonly amount: Money;
}) {
  const t = useT('account.pledges.manager.refundPending');
  const [contacting, setContacting] = useState(false);

  return (
    <>
      <InlineAlert
        variant="warning"
        title={t('title')}
        description={`${t('body', { amount: formatMoney(amount) })} ${t('already')}`}
        politeness="polite"
        action={
          <View style={styles.action}>
            <Meta selectable tone="secondary" testID="refund-pending-reference">
              {t('reference', { reference: pledgeId })}
            </Meta>
            <Pill size="sm" label={t('contact')} onPress={() => setContacting(true)} testID="refund-pending-contact" />
          </View>
        }
        testID="refund-pending"
      />
      <WhatsAppSheet
        visible={contacting}
        onClose={() => setContacting(false)}
        draft={t('message', { reference: pledgeId })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  action: { gap: spacing[3], alignItems: 'flex-start' },
});
