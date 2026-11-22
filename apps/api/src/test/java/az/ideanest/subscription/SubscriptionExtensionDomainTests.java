package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.shared.money.Money;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPlan;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.Period;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Extending a running subscription — #660, without a database.
 *
 * <p>The owner's rule: a subscription may be extended once its last calendar month begins, by its
 * own period at the price it was bought at or by another period the plan is sold for at today's
 * price. The money tests are the window's calendar arithmetic, that an extension cannot be stacked,
 * and that what the row holds afterwards is what was paid.
 */
class SubscriptionExtensionDomainTests {

    private static final Period WINDOW = Period.ofMonths(1);

    @Nested
    @DisplayName("the renewal window")
    class Window {

        @Test
        @DisplayName("opens exactly one calendar month before the end")
        void opensOneCalendarMonthBefore() {
            Subscription held = held(BillingPeriod.MONTHLY, "10.00", Instant.parse("2026-05-15T10:00:00Z"));

            assertThat(held.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2026-06-15T10:00:00Z"));
            assertThat(held.renewalOpensAt(WINDOW)).isEqualTo(Instant.parse("2026-05-15T10:00:00Z"));
        }

        @Test
        @DisplayName("a period ending on 31 March opens on 28 February, and on 29 February in a leap year")
        void clampsToTheEndOfFebruary() {
            Subscription common = heldUntil(Instant.parse("2027-03-31T08:00:00Z"));
            Subscription leap = heldUntil(Instant.parse("2028-03-31T08:00:00Z"));

            assertThat(common.renewalOpensAt(WINDOW)).isEqualTo(Instant.parse("2027-02-28T08:00:00Z"));
            assertThat(leap.renewalOpensAt(WINDOW)).isEqualTo(Instant.parse("2028-02-29T08:00:00Z"));
        }

        @Test
        @DisplayName("a period ending on 30 April opens on 30 March, not thirty days earlier")
        void isNotThirtyDays() {
            Subscription held = heldUntil(Instant.parse("2027-04-30T08:00:00Z"));

            assertThat(held.renewalOpensAt(WINDOW)).isEqualTo(Instant.parse("2027-03-30T08:00:00Z"));
        }

        @Test
        @DisplayName("opens at its first instant, inclusive, and is shut a millisecond before")
        void isInclusiveAtTheStart() {
            Subscription held = heldUntil(Instant.parse("2027-03-31T08:00:00Z"));
            Instant opens = Instant.parse("2027-02-28T08:00:00Z");

            assertThat(held.paymentDueAt(opens.minusMillis(1), WINDOW)).isEmpty();
            assertThat(held.paymentDueAt(opens, WINDOW)).contains(Subscription.DuePayment.RENEWAL);
        }

        @Test
        @DisplayName("a monthly subscription can be extended as soon as it is bought, once, and then the window shuts")
        void aMonthCanBeExtendedOnce() {
            Instant bought = Instant.parse("2026-05-15T10:00:00Z");
            Subscription held = held(BillingPeriod.MONTHLY, "10.00", bought);
            assertThat(held.paymentDueAt(bought, WINDOW)).contains(Subscription.DuePayment.RENEWAL);

            held.extend(BillingPeriod.MONTHLY, money("10.00"), bought.plusSeconds(60));

            assertThat(held.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2026-07-15T10:00:00Z"));
            assertThat(held.renewalOpensAt(WINDOW)).isEqualTo(Instant.parse("2026-06-15T10:00:00Z"));
            assertThat(held.paymentDueAt(bought.plusSeconds(120), WINDOW)).isEmpty();
        }

        @Test
        @DisplayName("a yearly subscription is not renewable before its last month, and is during it")
        void aYearOnlyInItsLastMonth() {
            Instant bought = Instant.parse("2026-01-10T10:00:00Z");
            Subscription held = held(BillingPeriod.YEARLY, "100.00", bought);

            assertThat(held.paymentDueAt(bought, WINDOW)).isEmpty();
            assertThat(held.paymentDueAt(Instant.parse("2026-12-10T09:59:59Z"), WINDOW)).isEmpty();
            assertThat(held.paymentDueAt(Instant.parse("2026-12-10T10:00:00Z"), WINDOW))
                    .contains(Subscription.DuePayment.RENEWAL);
        }

        @Test
        @DisplayName("a six-month subscription opens in its sixth month")
        void sixMonthsInItsLastMonth() {
            Subscription held = held(BillingPeriod.SEMIANNUAL, "54.00", Instant.parse("2026-08-31T10:00:00Z"));

            assertThat(held.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2027-02-28T10:00:00Z"));
            assertThat(held.renewalOpensAt(WINDOW)).isEqualTo(Instant.parse("2027-01-28T10:00:00Z"));
        }

        @Test
        @DisplayName("refuses a window of nothing, or a negative one")
        void theWindowIsPositive() {
            assertThat(new SubscriptionProperties(null).renewalWindow()).isEqualTo(Period.ofMonths(1));
            assertThat(new SubscriptionProperties(Period.ofDays(7)).renewalWindow()).isEqualTo(Period.ofDays(7));
            assertThatThrownBy(() -> new SubscriptionProperties(Period.ZERO)).isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> new SubscriptionProperties(Period.ofMonths(-1)))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> new SubscriptionProperties(Period.of(0, 1, -3)))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Nested
    @DisplayName("what an extension costs")
    class Prices {

        @Test
        @DisplayName("its own period keeps the price it was bought at, whatever the plan costs today")
        void theHeldPeriodIsLocked() {
            SubscriptionPlan plan = plan("10.00", "54.00", "100.00");
            Subscription held = held(plan, BillingPeriod.MONTHLY, Instant.parse("2026-05-15T10:00:00Z"));

            plan.reprice(prices("15.00", "80.00", "150.00"), "AZN");

            assertThat(held.extensionPriceFor(BillingPeriod.MONTHLY, plan)).contains(money("10.00"));
        }

        @Test
        @DisplayName("another period is the plan's current price for it")
        void anotherPeriodIsTodaysPrice() {
            SubscriptionPlan plan = plan("10.00", "54.00", "100.00");
            Subscription held = held(plan, BillingPeriod.MONTHLY, Instant.parse("2026-05-15T10:00:00Z"));

            plan.reprice(prices("15.00", "80.00", "150.00"), "AZN");

            assertThat(held.extensionPriceFor(BillingPeriod.YEARLY, plan)).contains(money("150.00"));
            assertThat(held.extensionPriceFor(BillingPeriod.SEMIANNUAL, plan)).contains(money("80.00"));
        }

        @Test
        @DisplayName("a period the plan is not sold for, or sells for nothing, is not offered")
        void anUnsoldPeriodIsNotOffered() {
            SubscriptionPlan plan = plan("10.00", null, "100.00");
            Subscription held = held(plan, BillingPeriod.MONTHLY, Instant.parse("2026-05-15T10:00:00Z"));
            assertThat(held.extensionPriceFor(BillingPeriod.SEMIANNUAL, plan)).isEmpty();

            plan.reprice(prices("10.00", null, "0.00"), "AZN");
            assertThat(held.extensionPriceFor(BillingPeriod.YEARLY, plan)).isEmpty();
            assertThat(held.extensionPrices(plan)).containsOnlyKeys(BillingPeriod.MONTHLY);
        }

        @Test
        @DisplayName("its own period stays on offer at its own price after the plan stops selling it")
        void theHeldPeriodOutlivesTheCatalogue() {
            SubscriptionPlan plan = plan("10.00", "54.00", "100.00");
            Subscription held = held(plan, BillingPeriod.MONTHLY, Instant.parse("2026-05-15T10:00:00Z"));

            plan.reprice(prices(null, "54.00", "100.00"), "AZN");

            assertThat(held.extensionPriceFor(BillingPeriod.MONTHLY, plan)).contains(money("10.00"));
        }

        @Test
        @DisplayName("lists every choice shortest first, its own at its own price")
        void listsEveryChoiceShortestFirst() {
            SubscriptionPlan plan = plan("10.00", "54.00", "100.00");
            Subscription held = held(plan, BillingPeriod.YEARLY, Instant.parse("2026-05-15T10:00:00Z"));
            plan.reprice(prices("12.00", "60.00", "120.00"), "AZN");

            assertThat(held.extensionPrices(plan))
                    .containsExactly(
                            Map.entry(BillingPeriod.MONTHLY, money("12.00")),
                            Map.entry(BillingPeriod.SEMIANNUAL, money("60.00")),
                            Map.entry(BillingPeriod.YEARLY, money("100.00")));
        }
    }

    @Nested
    @DisplayName("an extension")
    class Extending {

        @Test
        @DisplayName("runs from the old end by the period paid for, and the row then holds that period and price")
        void extendsByThePaidPeriod() {
            Subscription held = held(BillingPeriod.MONTHLY, "10.00", Instant.parse("2026-05-15T10:00:00Z"));
            held.cancelAtPeriodEnd(Instant.parse("2026-05-20T10:00:00Z"));

            held.extend(BillingPeriod.YEARLY, money("100.00"), Instant.parse("2026-05-20T11:00:00Z"));

            assertThat(held.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2027-06-15T10:00:00Z"));
            assertThat(held.getBillingPeriod()).isEqualTo(BillingPeriod.YEARLY);
            assertThat(held.getPrice()).isEqualTo(money("100.00"));
            assertThat(held.isCancelAtPeriodEnd()).isFalse();
            // The window shuts again until the new end is a month away.
            assertThat(held.renewalOpensAt(WINDOW)).isEqualTo(Instant.parse("2027-05-15T10:00:00Z"));
        }

        @Test
        @DisplayName("paid after the end, runs from the payment")
        void aLateExtensionRunsFromNow() {
            Subscription held = held(BillingPeriod.MONTHLY, "10.00", Instant.parse("2026-05-15T10:00:00Z"));
            Instant late = Instant.parse("2026-06-20T10:00:00Z");

            held.extend(BillingPeriod.SEMIANNUAL, money("54.00"), late);

            assertThat(held.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2026-12-20T10:00:00Z"));
        }

        @Test
        @DisplayName("renewing is extending by its own period at its own price")
        void renewingIsExtendingByItsOwn() {
            Subscription held = held(BillingPeriod.SEMIANNUAL, "54.00", Instant.parse("2026-05-15T10:00:00Z"));

            held.renew(Instant.parse("2026-11-01T10:00:00Z"));

            assertThat(held.getCurrentPeriodEnd()).isEqualTo(Instant.parse("2027-05-15T10:00:00Z"));
            assertThat(held.getBillingPeriod()).isEqualTo(BillingPeriod.SEMIANNUAL);
            assertThat(held.getPrice()).isEqualTo(money("54.00"));
        }

        @Test
        @DisplayName("only an active subscription is extended")
        void onlyActive() {
            SubscriptionPlan plan = plan("10.00", "54.00", "100.00");
            Subscription pending = Subscription.awaitingPayment(
                    UUID.randomUUID(), UUID.randomUUID(), plan, BillingPeriod.MONTHLY, Instant.parse("2026-05-15T10:00:00Z"));

            assertThatThrownBy(() -> pending.extend(BillingPeriod.YEARLY, money("100.00"), Instant.parse("2026-05-15T11:00:00Z")))
                    .isInstanceOf(IllegalStateException.class);
        }
    }

    private static Subscription heldUntil(Instant end) {
        // A year bought a year before the end: the period that ends there. A month would not do,
        // because a month bought on 28 February ends on 28 March.
        Instant bought = end.atOffset(ZoneOffset.UTC).minusYears(1).toInstant();
        Subscription held = held(BillingPeriod.YEARLY, "100.00", bought);
        assertThat(held.getCurrentPeriodEnd()).isEqualTo(end);
        return held;
    }

    private static Subscription held(BillingPeriod period, String price, Instant bought) {
        String monthly = period == BillingPeriod.MONTHLY ? price : "10.00";
        String semiannual = period == BillingPeriod.SEMIANNUAL ? price : "54.00";
        String yearly = period == BillingPeriod.YEARLY ? price : "100.00";
        return held(plan(monthly, semiannual, yearly), period, bought);
    }

    private static Subscription held(SubscriptionPlan plan, BillingPeriod period, Instant bought) {
        Subscription held = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, period, bought);
        held.activatePaid(plan, bought);
        return held;
    }

    private static Money money(String amount) {
        return Money.of(new BigDecimal(amount), "AZN");
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

    private static SubscriptionPlan plan(String monthly, String semiannual, String yearly) {
        SubscriptionPlan plan = SubscriptionPlan.create(
                UUID.randomUUID(),
                "EXTEND",
                "A plan",
                null,
                Map.of(),
                Money.of(new BigDecimal(monthly == null ? "10.00" : monthly), "AZN"),
                BillingPeriod.MONTHLY,
                1,
                null,
                10,
                Instant.parse("2026-01-01T00:00:00Z"),
                UUID.randomUUID());
        plan.reprice(prices(monthly, semiannual, yearly), "AZN");
        return plan;
    }
}
