package az.ideanest.payment.application;

import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.Posting;
import az.ideanest.payment.ProviderFeeProperties;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The provider's commission on a settled charge, posted beside the charge — #401.
 *
 * <p>The provider takes its fee before the money reaches the platform: Payriff paid 4.85 on a 5.00
 * charge. Escrow was debited with the whole charge all the same, so it said the platform held money it
 * never received. The fee now leaves escrow for {@link LedgerAccount#PSP_FEE} in the charge's own posting,
 * which is that account's meaning, and the ledger reconciliation already adds {@code psp_fee} back to
 * escrow, so the books still agree with the transactions.
 *
 * <p><strong>A refund does not reverse it.</strong> The provider keeps its commission on a refunded charge
 * (#387), and the owner accepted that as the platform's cost; the fee stays posted.
 *
 * <p>The figure is the provider's published rate applied to the charge. The provider's settlement report
 * is the authority, and a comparison against it, when one is written, is where a difference shows.
 */
@Component
public class ProviderFees {

    private final ProviderFeeProperties properties;

    public ProviderFees(ProviderFeeProperties properties) {
        this.properties = properties;
    }

    /** What the provider keeps of this charge; zero for a provider with no configured rate. */
    public Money on(ProviderName provider, Money charged) {
        BigDecimal rate = properties.rates().get(provider);
        return rate == null ? Money.zero(charged.currency()) : charged.times(rate);
    }

    /** The charge's posting, escrow against the creator, with the provider's fee taken out of escrow. */
    public Posting chargePosting(
            UUID transactionId, UUID projectId, LedgerAccount creator, ProviderName provider, Money charged) {
        Posting.Builder posting = Posting.of(transactionId, projectId)
                .debit(LedgerAccount.ESCROW, charged)
                .credit(creator, charged);
        Money fee = on(provider, charged);
        if (fee.isPositive()) {
            posting.debit(LedgerAccount.PSP_FEE, fee).credit(LedgerAccount.ESCROW, fee);
        }
        return posting.build();
    }
}
