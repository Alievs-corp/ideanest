package az.ideanest.subscription.application;

import az.ideanest.subscription.domain.BillingPeriod;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * What one period of a plan costs, as the console sends it — #655.
 *
 * @param billingPeriod which period
 * @param price zero or more, in the plan's currency. A {@code BigDecimal} and never a double
 * @param currency optional, and refused when it is not the plan's: every price on a plan is in one
 *     currency
 */
public record PeriodPrice(
        @NotNull BillingPeriod billingPeriod,
        @NotNull @DecimalMin("0") BigDecimal price,
        @Pattern(regexp = "^[A-Z]{3}$") String currency) {

    /**
     * The entries by period, checked.
     *
     * <p>A period named twice is refused rather than one of them winning: the console showed two
     * rows, and which of them the operator meant is not the service's to guess. So is a price in a
     * currency other than the plan's, and an empty list — a plan sold for no period is a plan
     * nobody can buy.
     *
     * @throws IllegalArgumentException for any of those, which the console is shown as
     *     {@code INVALID_PLAN}
     */
    static Map<BillingPeriod, BigDecimal> byPeriod(List<PeriodPrice> prices, String currency) {
        if (prices == null || prices.isEmpty()) {
            throw new IllegalArgumentException("A plan is sold for at least one period");
        }
        Map<BillingPeriod, BigDecimal> byPeriod = new EnumMap<>(BillingPeriod.class);
        for (PeriodPrice entry : prices) {
            if (entry == null || entry.billingPeriod() == null || entry.price() == null) {
                throw new IllegalArgumentException("Every price names its period and an amount");
            }
            if (entry.currency() != null && !entry.currency().equals(currency)) {
                throw new IllegalArgumentException("Every price on a plan is in the plan's currency, " + currency);
            }
            if (byPeriod.put(entry.billingPeriod(), entry.price()) != null) {
                throw new IllegalArgumentException(
                        "A plan has one price per period, and " + entry.billingPeriod() + " is named twice");
            }
        }
        return byPeriod;
    }
}
