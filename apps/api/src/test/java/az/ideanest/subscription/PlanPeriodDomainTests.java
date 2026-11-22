package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.shared.money.Money;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPlan;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * One, six and twelve months, each at its own price — #655, without a database.
 *
 * <p>The money tests: a subscription copies the price of the period chosen and runs for that
 * period, and a plan's single {@code price} keeps describing its shortest period whatever the
 * console does to the others.
 */
class PlanPeriodDomainTests {

    private static final Instant NOW = Instant.parse("2026-08-31T10:00:00Z");

    @Test
    @DisplayName("six months is calendar arithmetic, and clamps the 31st like a month does")
    void sixMonthsIsCalendarArithmetic() {
        assertThat(BillingPeriod.SEMIANNUAL.endOf(Instant.parse("2026-03-15T10:00:00Z")))
                .isEqualTo(Instant.parse("2026-09-15T10:00:00Z"));
        // 31 August + 6 months is the last day of February, never 3 March.
        assertThat(BillingPeriod.SEMIANNUAL.endOf(NOW)).isEqualTo(Instant.parse("2027-02-28T10:00:00Z"));
    }

    @Test
    @DisplayName("the periods are declared shortest first, which is what 'the shortest on sale' reads")
    void periodsAreShortestFirst() {
        assertThat(BillingPeriod.values())
                .containsExactly(BillingPeriod.MONTHLY, BillingPeriod.SEMIANNUAL, BillingPeriod.YEARLY);
    }

    @Test
    @DisplayName("a plan answers each period's own price, and nothing for a period it is not sold for")
    void eachPeriodHasItsOwnPrice() {
        SubscriptionPlan plan = plan("10.00");
        plan.reprice(prices("10.00", "54.00", null), "AZN");

        assertThat(plan.priceFor(BillingPeriod.MONTHLY)).contains(Money.of(new BigDecimal("10.00"), "AZN"));
        assertThat(plan.priceFor(BillingPeriod.SEMIANNUAL)).contains(Money.of(new BigDecimal("54.00"), "AZN"));
        assertThat(plan.priceFor(BillingPeriod.YEARLY)).isEmpty();
        assertThat(plan.getPrices().keySet()).containsExactly(BillingPeriod.MONTHLY, BillingPeriod.SEMIANNUAL);
    }

    @Test
    @DisplayName("the plan's one price follows the shortest period on sale")
    void theOnePriceIsTheShortestPeriods() {
        SubscriptionPlan plan = plan("10.00");

        plan.reprice(prices(null, "60.00", "100.00"), "AZN");

        assertThat(plan.getBillingPeriod()).isEqualTo(BillingPeriod.SEMIANNUAL);
        assertThat(plan.getPrice()).isEqualTo(Money.of(new BigDecimal("60.00"), "AZN"));
    }

    @Test
    @DisplayName("changing the one price changes the shortest period's and leaves the others")
    void theLegacyPriceTouchesOnlyTheShortestPeriod() {
        SubscriptionPlan plan = plan("10.00");
        plan.reprice(prices("10.00", "60.00", "120.00"), "AZN");

        plan.price(Money.of(new BigDecimal("12.00"), "AZN"));

        assertThat(plan.priceFor(BillingPeriod.MONTHLY)).contains(Money.of(new BigDecimal("12.00"), "AZN"));
        assertThat(plan.priceFor(BillingPeriod.YEARLY)).contains(Money.of(new BigDecimal("120.00"), "AZN"));
    }

    @Test
    @DisplayName("refuses a plan sold for no period, and a negative price for any period")
    void repricingIsChecked() {
        SubscriptionPlan plan = plan("10.00");

        assertThatThrownBy(() -> plan.reprice(Map.of(), "AZN")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> plan.reprice(prices("10.00", "-1.00", null), "AZN"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> plan.reprice(prices("10.001", null, null), "AZN"))
                .isInstanceOf(IllegalArgumentException.class);
        // Nothing changed.
        assertThat(plan.getPrices().keySet()).containsExactly(BillingPeriod.MONTHLY);
    }

    @Test
    @DisplayName("a subscription copies the chosen period's price and runs for that period")
    void aSubscriptionCopiesTheChosenPeriod() {
        SubscriptionPlan plan = plan("10.00");
        plan.reprice(prices("10.00", "60.00", "120.00"), "AZN");

        Subscription bought =
                Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, BillingPeriod.YEARLY, NOW);
        assertThat(bought.getPrice()).isEqualTo(Money.of(new BigDecimal("120.00"), "AZN"));
        assertThat(bought.getBillingPeriod()).isEqualTo(BillingPeriod.YEARLY);

        // Activated against a plan whose shortest period is a month: a year was paid for.
        bought.activatePaid(plan, NOW);
        assertThat(bought.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2027-08-31T10:00:00Z"));

        bought.renew(bought.getCurrentPeriodEnd().minusSeconds(60));
        assertThat(bought.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2028-08-31T10:00:00Z"));
    }

    @Test
    @DisplayName("a staff-recorded transfer opens the subscription's own period too")
    void aRecordedTransferOpensTheChosenPeriod() {
        SubscriptionPlan plan = plan("10.00");
        plan.reprice(prices("10.00", "60.00", null), "AZN");

        Subscription bought =
                Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, BillingPeriod.SEMIANNUAL, NOW);
        bought.activate(plan, UUID.randomUUID(), "transfer", NOW);

        assertThat(bought.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2027-02-28T10:00:00Z"));
    }

    @Test
    @DisplayName("a free period activates on the spot for its own length")
    void aFreePeriodActivatesForItsLength() {
        SubscriptionPlan plan = plan("0.00");
        plan.reprice(prices("0.00", null, "0.00"), "AZN");

        Subscription held = Subscription.activeFrom(UUID.randomUUID(), UUID.randomUUID(), plan, BillingPeriod.YEARLY, NOW);

        assertThat(held.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2027-08-31T10:00:00Z"));
    }

    @Test
    @DisplayName("a period the plan is not sold for cannot be bought, even by a caller that skipped the check")
    void anUnsoldPeriodIsRefused() {
        SubscriptionPlan plan = plan("10.00");

        assertThatThrownBy(() -> Subscription.awaitingPayment(
                        UUID.randomUUID(), UUID.randomUUID(), plan, BillingPeriod.YEARLY, NOW))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a plan is open to everybody unless it is restricted to students")
    void studentOnlyIsAFlag() {
        SubscriptionPlan plan = plan("10.00");
        assertThat(plan.isStudentOnly()).isFalse();

        Subscription before = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);
        plan.restrictToStudents(true);
        Subscription after = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);

        assertThat(plan.isStudentOnly()).isTrue();
        // Copied at purchase, like the price: the flag reaches new buyers only.
        assertThat(before.isStudentRate()).isFalse();
        assertThat(after.isStudentRate()).isTrue();
    }

    private static Map<BillingPeriod, BigDecimal> prices(String monthly, String semiannual, String yearly) {
        Map<BillingPeriod, BigDecimal> prices = new LinkedHashMap<>();
        if (monthly != null) {
            prices.put(BillingPeriod.MONTHLY, new BigDecimal(monthly));
        }
        if (semiannual != null) {
            prices.put(BillingPeriod.SEMIANNUAL, new BigDecimal(semiannual));
        }
        if (yearly != null) {
            prices.put(BillingPeriod.YEARLY, new BigDecimal(yearly));
        }
        return prices;
    }

    private static SubscriptionPlan plan(String monthly) {
        return SubscriptionPlan.create(
                UUID.randomUUID(),
                "PERIODS",
                "A plan",
                null,
                Map.of(),
                Money.of(new BigDecimal(monthly), "AZN"),
                BillingPeriod.MONTHLY,
                1,
                null,
                10,
                NOW,
                UUID.randomUUID());
    }
}
