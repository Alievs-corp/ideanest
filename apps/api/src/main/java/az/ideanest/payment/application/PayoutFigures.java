package az.ideanest.payment.application;

import az.ideanest.shared.money.Money;
import java.util.Objects;

/**
 * What a payout settles, split the way the ledger posts it — #401.
 *
 * <p>The creator's account was credited with every charge as it was collected, so a payout that debits
 * it with the net alone leaves the fees, the refunds and the withheld debt standing there as a claim the
 * creator does not have. The payout closes it: the gross leaves the creator's account and each part goes
 * where it belongs.
 *
 * @param gross what the creator's account was credited with: the campaign's collected charges, as priced
 * @param fees the platform fee and the processing fee, the platform's revenue
 * @param tax what was withheld for a tax authority. Zero while #78 is blocked
 * @param borne what went back to backers and the creator bears: the refunds and the chargeback debts
 *     the payout withheld. It comes off {@code refunds}, which then holds only what no creator has borne
 * @param net what leaves escrow for the creator
 */
public record PayoutFigures(Money gross, Money fees, Money tax, Money borne, Money net) {

    public PayoutFigures {
        Objects.requireNonNull(gross, "gross");
        Objects.requireNonNull(fees, "fees");
        Objects.requireNonNull(tax, "tax");
        Objects.requireNonNull(borne, "borne");
        Objects.requireNonNull(net, "net");
        if (!gross.equals(fees.plus(tax).plus(borne).plus(net))) {
            throw new IllegalArgumentException("A payout of " + gross + " does not split into fees " + fees
                    + ", tax " + tax + ", borne " + borne + " and net " + net);
        }
    }
}
