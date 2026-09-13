package az.ideanest.payment.application;

import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.payment.infrastructure.RefundRepository;
import az.ideanest.shared.money.Money;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What of one pledge's money could still go back — IDN-EXT-01 (#43).
 *
 * <p>What was collected, less what has been refunded or is being refunded: the same arithmetic
 * {@code RefundRecords} checks a refund against, so a dispute is only opened over money a refund could
 * return.
 */
@Service
public class PledgeFunds {

    private final PaymentTransactionRepository transactions;
    private final RefundRepository refunds;

    public PledgeFunds(PaymentTransactionRepository transactions, RefundRepository refunds) {
        this.transactions = transactions;
        this.refunds = refunds;
    }

    /** @return the refundable amount, or empty when nothing was collected or everything went back */
    @Transactional(readOnly = true)
    public Optional<Money> refundableOn(UUID pledgeId) {
        List<PaymentTransaction> charges = transactions.settledChargesOf(pledgeId);
        if (charges.isEmpty()) {
            return Optional.empty();
        }
        String currency = charges.getFirst().getAmount().currency();
        Money remaining = Money.of(transactions.collectedOn(pledgeId), currency)
                .minus(Money.of(refunds.refundedAgainst(pledgeId), currency));
        return remaining.isPositive() ? Optional.of(remaining) : Optional.empty();
    }
}
