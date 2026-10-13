package az.ideanest.payment.application;

import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.Posting;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.PayoutResult;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.shared.money.Money;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The database half of sending a payout, in one commit — issue #69.
 *
 * <p>A separate bean for {@code RefundRecords}' reason, which is worth repeating because
 * it is the kind of defect that passes every test: {@code @Transactional} is applied by a
 * proxy, so a {@code @Transactional} method called from another method of the same class
 * runs with no transaction at all and reports nothing. {@link PayoutGateway} calls across
 * a bean boundary so that the annotation is in the path.
 */
@Service
public class PayoutPostings {

    private static final Logger log = LoggerFactory.getLogger(PayoutPostings.class);

    private final PaymentTransactionRepository transactions;
    private final Ledger ledger;

    public PayoutPostings(PaymentTransactionRepository transactions, Ledger ledger) {
        this.transactions = transactions;
        this.ledger = ledger;
    }

    /**
     * The transaction row and, when money moved, the ledger posting.
     *
     * <p>A declined payout gets a {@code FAILED} transaction row and <strong>no
     * posting</strong>: nothing moved. The row exists because a provider that refused is a
     * fact worth keeping — a reconciliation against the provider's statement needs it, and
     * so does the creator asking why they have not been paid.
     *
     * <p>The posting is the counterpart of the collection's, and closes the campaign (#401). A
     * collection debits escrow and credits the creator's account with the whole charge; this
     * debits the creator's account with the gross and credits escrow with the net, the
     * platform's fees to {@code platform_fee}, any tax to {@code tax_payable}, and what the
     * creator bore — refunds and withheld debt — to {@code refunds}. The creator's account ends
     * at zero, and escrow keeps the fees. A bank's charge for the transfer is the platform's
     * cost and leaves escrow for {@code platform_expense}.
     *
     * @param bankFee what the bank charged for the transfer, or zero
     */
    @Transactional
    PayoutGateway.Sent record(
            UUID payoutId,
            UUID projectId,
            UUID creatorId,
            PayoutFigures figures,
            Money bankFee,
            ProviderName provider,
            PayoutResult result,
            String idempotencyKey) {

        Money amount = figures.net();
        PaymentTransaction recorded =
                transactions.save(PaymentTransaction.payout(projectId, amount, provider, result, idempotencyKey));

        if (result.outcome() == ProviderOutcome.DECLINED) {
            log.warn("Payout {} declined by {}: {}", payoutId, provider, result.failureCode());
            return new PayoutGateway.Sent(
                    false, recorded.getId(), result.failureCode(), result.failureMessage());
        }

        ledger.post(Posting.of(recorded.getId(), projectId)
                .debit(LedgerAccount.creator(creatorId), figures.gross())
                .creditIfAny(LedgerAccount.ESCROW, amount)
                .creditIfAny(LedgerAccount.PLATFORM_FEE, figures.fees())
                .creditIfAny(LedgerAccount.TAX_PAYABLE, figures.tax())
                .creditIfAny(LedgerAccount.REFUNDS, figures.borne())
                .debitIfAny(LedgerAccount.PLATFORM_EXPENSE, bankFee)
                .creditIfAny(LedgerAccount.ESCROW, bankFee)
                .build());

        log.info("Payout {} of {} sent for campaign {}", payoutId, amount, projectId);
        return new PayoutGateway.Sent(true, recorded.getId(), null, null);
    }
}
