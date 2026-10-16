package az.ideanest.payment.application;

import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.shared.money.Money;
import org.springframework.stereotype.Component;

/**
 * What a failed campaign's refund keeps back — issue #436.
 *
 * <p>The owner's decision of 2026-10-13: when a campaign ends below 80%, is suspended or is cancelled,
 * the backer is refunded the charge less the payment provider's fee, because the provider keeps its
 * commission on a refunded charge (#387) and refunding it in full pays that commission out of the
 * platform's own account. The platform's own fee is never deducted.
 *
 * <p>The rule follows the reason, not who issues the refund: a member of staff refunding under
 * {@code CAMPAIGN_FAILED} or {@code CAMPAIGN_HALTED} keeps the same fee back as the platform's own sweep
 * ({@code RefundRecords#record}), so a backer's refund does not depend on who triggered it. Every other
 * reason — a backer's request, a duplicate charge, a dispute upheld or conceded — returns the whole amount.
 *
 * <h2>The cut-over follows the words, not a date</h2>
 *
 * <p>Only a backer who was told before paying gets the net refund. So the rule is recorded on the
 * charge when it is taken ({@link PaymentTransaction#isProviderFeeWithheldOnRefund()}), from
 * {@code ideanest.payment.refunds.withhold-provider-fee}, and a refund later reads the charge — never
 * the setting. Switching the setting changes no charge already taken.
 *
 * <h2>The fee is the one posted with the charge</h2>
 *
 * <p>Not today's rate applied again: what was debited to {@code psp_fee} in the charge's own posting
 * ({@link ProviderFees}, #427), so what goes back is exactly what reached the platform and a rate
 * changed since cannot move it. A charge with no fee posted — a provider with no configured rate — is
 * refunded in full. The ledger then balances on its own: the charge left the fee out of escrow, the
 * refund takes the rest, and escrow ends at zero for that charge.
 */
@Component
public class RefundTerms {

    private final Ledger ledger;

    /** Not final, so a test can take charges under either rule; nothing in the application writes it. */
    private boolean withholdProviderFee;

    public RefundTerms(PaymentProperties properties, Ledger ledger) {
        this.ledger = ledger;
        this.withholdProviderFee = properties.refunds().withholdProviderFee();
    }

    /**
     * Whether a charge recorded now is taken under the rule — what every place that opens a payment
     * page records on its charge.
     */
    public boolean withholdsProviderFeeOnNewCharges() {
        return withholdProviderFee;
    }

    /**
     * What a refund of this charge for this reason keeps back: the provider's fee posted with the charge,
     * when the charge was taken under the rule and the refund is a campaign's outcome; zero otherwise.
     */
    public Money withheldOn(PaymentTransaction charge, RefundReason reason) {
        String currency = charge.getAmount().currency();
        if (!charge.isProviderFeeWithheldOnRefund() || !Refund.withholdsProviderFee(reason)) {
            return Money.zero(currency);
        }
        return ledger.debitedTo(charge.getId(), LedgerAccount.PSP_FEE, currency);
    }
}
