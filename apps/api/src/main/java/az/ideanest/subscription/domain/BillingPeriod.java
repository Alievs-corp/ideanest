package az.ideanest.subscription.domain;

import java.time.Instant;
import java.time.Period;
import java.time.ZoneOffset;

/**
 * How long a subscription runs before it has to be bought again.
 *
 * <p><strong>Three values, and adding a fourth is a product decision rather than an
 * omission.</strong> Weekly billing on a platform where a campaign runs for up to sixty
 * days would mean a creator buying the right to publish eight times during one campaign,
 * and a lifetime plan is a promise the platform cannot price against a fee schedule that
 * moves. Six months arrived with #655, when every plan became sellable for one, six or
 * twelve months at a price of its own ({@code SubscriptionPlan#priceFor}).
 *
 * <p><strong>Declared shortest first, and the order is used.</strong> A plan's
 * {@code price} and {@code billing_period} columns describe the shortest period it is sold
 * for, and "shortest" is this enum's natural order.
 *
 * <p><strong>The arithmetic is calendar arithmetic, not {@code Duration}.</strong> A month
 * is not thirty days. A subscription bought on 31 January runs to 28 February, and a
 * duration of thirty days would end it on 2 March — three days of entitlement nobody sold
 * and, worse, a renewal date that walks backwards through the calendar a little further
 * every month. {@link Period} does what a person means by "a month later", including
 * clamping 31 January to the last day of February.
 *
 * <p>UTC, deliberately, because {@link Instant} has no zone and the alternative is
 * choosing one. The consequence is that a period bought at 23:30 local time in Baku ends
 * on what a creator would call the previous day; that is four hours on a month, and the
 * alternative — storing the creator's zone and renewing in it — makes the renewal instant
 * depend on a profile field they can change.
 */
public enum BillingPeriod {

    MONTHLY(Period.ofMonths(1)),

    SEMIANNUAL(Period.ofMonths(6)),

    YEARLY(Period.ofYears(1));

    private final Period length;

    BillingPeriod(Period length) {
        this.length = length;
    }

    /**
     * When a period starting here ends.
     *
     * @param start when the subscription became active
     * @return the instant the entitlement stops, exclusive — see {@code Subscription} on
     *     which side of it counts
     */
    public Instant endOf(Instant start) {
        return start.atOffset(ZoneOffset.UTC).plus(length).toInstant();
    }

    /** How long one period is, as calendar months and years. */
    public Period length() {
        return length;
    }
}
