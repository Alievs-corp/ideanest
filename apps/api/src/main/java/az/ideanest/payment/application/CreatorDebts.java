package az.ideanest.payment.application;

import az.ideanest.payment.domain.CreatorDebt;
import az.ideanest.payment.infrastructure.CreatorDebtRepository;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A creator's debts from chargebacks lost after payout, and their recovery — IDN-EXT-01 (#43), §9.8.
 *
 * <p>For the payout module, which withholds what is outstanding from a creator's next payouts: what is
 * owed is asked here, and what a payout actually withheld is applied here, oldest debt first.
 */
@Service
public class CreatorDebts {

    private static final Logger log = LoggerFactory.getLogger(CreatorDebts.class);

    private final CreatorDebtRepository debts;

    public CreatorDebts(CreatorDebtRepository debts) {
        this.debts = debts;
    }

    /** What a creator still owes in a currency; zero when nothing. */
    @Transactional(readOnly = true)
    public Money outstandingFor(UUID creatorId, String currency) {
        Money total = Money.zero(currency);
        for (CreatorDebt debt : debts.outstandingFor(creatorId, currency)) {
            total = total.plus(debt.outstanding());
        }
        return total;
    }

    /** Records a debt for a lost dispute. Idempotent on the dispute. */
    @Transactional
    void record(UUID creatorId, UUID projectId, UUID disputeId, Money amount, Instant at) {
        if (debts.existsByDisputeId(disputeId)) {
            return;
        }
        debts.save(CreatorDebt.owed(creatorId, projectId, disputeId, amount, at));
        log.info("Creator {} owes {} after dispute {} was lost on campaign {}.", creatorId, amount, disputeId, projectId);
    }

    /**
     * Applies an amount a payout withheld to the creator's debts, oldest first.
     *
     * @return what was left unapplied, zero when all of it went towards debts
     */
    @Transactional
    public Money recover(UUID creatorId, Money withheld, Instant at) {
        Money left = withheld;
        for (CreatorDebt debt : debts.outstandingFor(creatorId, withheld.currency())) {
            if (!left.isPositive()) {
                break;
            }
            left = left.minus(debt.recover(left, at));
            debts.save(debt);
        }
        log.info("Recovered {} from creator {}; {} left unapplied.", withheld.minus(left), creatorId, left);
        return left;
    }
}
