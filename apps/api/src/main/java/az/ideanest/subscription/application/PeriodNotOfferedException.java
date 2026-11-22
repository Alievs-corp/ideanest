package az.ideanest.subscription.application;

import az.ideanest.subscription.domain.BillingPeriod;
import java.util.UUID;

/**
 * The plan is not sold for the period the creator asked for — #655.
 *
 * <p>A 400 rather than a 409: the catalogue says which periods each plan is sold for, so a
 * request naming another is a request the client should not have built. The realistic cause is
 * an operator withdrawing a period while the pricing page was open.
 */
public class PeriodNotOfferedException extends RuntimeException {

    private final UUID planId;
    private final BillingPeriod period;

    public PeriodNotOfferedException(UUID planId, BillingPeriod period) {
        super("Plan " + planId + " is not sold for " + period);
        this.planId = planId;
        this.period = period;
    }

    public UUID planId() {
        return planId;
    }

    public BillingPeriod period() {
        return period;
    }
}
