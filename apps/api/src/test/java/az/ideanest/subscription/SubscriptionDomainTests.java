package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.shared.money.Money;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPlan;
import az.ideanest.subscription.domain.SubscriptionState;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The subscription domain, without a database.
 *
 * <p>The tests that carry the design are {@link Entitlement#theWindowIsHalfOpen()} — the
 * boundary instant everything else on this feature is built on — and {@link Periods},
 * because a month is not thirty days and a duration would walk a renewal date backwards
 * through the calendar a little further every month.
 */
class SubscriptionDomainTests {

    private static final Instant NOW = Instant.parse("2026-01-31T10:00:00Z");

    @Nested
    @DisplayName("a billing period")
    class Periods {

        @Test
        @DisplayName("is calendar arithmetic, so a month later is the same day of the month")
        void monthlyIsCalendarArithmetic() {
            assertThat(BillingPeriod.MONTHLY.endOf(Instant.parse("2026-03-15T10:00:00Z")))
                    .isEqualTo(Instant.parse("2026-04-15T10:00:00Z"));
        }

        @Test
        @DisplayName("clamps 31 January to the end of February rather than overflowing into March")
        void monthlyClampsShortMonths() {
            // Thirty days would land on 2 March: three days nobody sold, and a renewal
            // date that drifts every month.
            assertThat(BillingPeriod.MONTHLY.endOf(NOW)).isEqualTo(Instant.parse("2026-02-28T10:00:00Z"));
        }

        @Test
        @DisplayName("yearly is a year")
        void yearly() {
            assertThat(BillingPeriod.YEARLY.endOf(NOW)).isEqualTo(Instant.parse("2027-01-31T10:00:00Z"));
        }
    }

    @Nested
    @DisplayName("a plan")
    class Plans {

        @Test
        @DisplayName("upper-cases a code an operator typed in lower case")
        void codeIsNormalised() {
            assertThat(plan("growth", "49.00").getCode()).isEqualTo("GROWTH");
        }

        @Test
        @DisplayName("refuses a code with a space in it, because it would be spelled two ways")
        void codeShapeIsEnforced() {
            assertThatThrownBy(() -> plan("two words", "49.00")).isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        @DisplayName("refuses a negative price")
        void priceIsNotNegative() {
            assertThatThrownBy(() -> plan("GROWTH", "-1.00")).isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        @DisplayName("accepts a price of zero, which is a free tier and not a mistake")
        void freeIsAllowed() {
            SubscriptionPlan free = plan("FREE", "0.00");

            assertThat(free.getPrice().amount()).isEqualByComparingTo("0.00");
            assertThat(free.requiresPayment()).isFalse();
        }

        @Test
        @DisplayName("refuses a plan that permits no campaigns, which nobody could use")
        void zeroCampaignsIsRefused() {
            SubscriptionPlan plan = plan("GROWTH", "49.00");

            assertThatThrownBy(() -> plan.limits(0, null)).isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        @DisplayName("treats a null limit as no limit rather than as zero")
        void nullLimitsMeanUnlimited() {
            SubscriptionPlan plan = plan("PRO", "149.00");
            plan.limits(null, null);

            assertThat(plan.getMaxActiveCampaigns()).isNull();
            assertThat(plan.getGoalCeiling()).isNull();
        }
    }

    @Nested
    @DisplayName("entitlement")
    class Entitlement {

        @Test
        @DisplayName("a plan that costs something starts waiting for payment, with no window")
        void paidPlansStartPending() {
            Subscription bought =
                    Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan("GROWTH", "49.00"), NOW);

            assertThat(bought.getState()).isEqualTo(SubscriptionState.PENDING_PAYMENT);
            assertThat(bought.getCurrentPeriodEnd()).isNull();
            // The whole point: choosing a plan is not paying for one.
            assertThat(bought.entitlesAt(NOW)).isFalse();
        }

        @Test
        @DisplayName("a free plan entitles immediately, because there is no payment to wait for")
        void freePlansStartActive() {
            Subscription bought =
                    Subscription.activeFrom(UUID.randomUUID(), UUID.randomUUID(), plan("FREE", "0.00"), NOW);

            assertThat(bought.getState()).isEqualTo(SubscriptionState.ACTIVE);
            assertThat(bought.entitlesAt(NOW)).isTrue();
        }

        @Test
        @DisplayName("stops at the instant the period ends, not after it")
        void theWindowIsHalfOpen() {
            SubscriptionPlan plan = plan("GROWTH", "49.00");
            Subscription bought = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);
            bought.activate(plan, UUID.randomUUID(), "transfer 44", NOW);

            Instant end = bought.getCurrentPeriodEnd();

            assertThat(bought.entitlesAt(end.minusMillis(1))).isTrue();
            // Half-open, like every other window on this platform, so that no reader has
            // to remember which boundary belongs to which table.
            assertThat(bought.entitlesAt(end)).isFalse();
            assertThat(bought.hasLapsedBy(end)).isTrue();
        }

        @Test
        @DisplayName("records who confirmed the payment and starts the period then, not at purchase")
        void activationStartsThePeriodWhenPaymentArrives() {
            SubscriptionPlan plan = plan("GROWTH", "49.00");
            Subscription bought = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);

            UUID admin = UUID.randomUUID();
            Instant threeDaysLater = NOW.plusSeconds(3 * 24 * 3600);
            bought.activate(plan, admin, "transfer 44", threeDaysLater);

            // A creator who waited three days for a transfer to clear gets the month they
            // paid for, not twenty-seven days of it.
            assertThat(bought.getStartedAt()).isEqualTo(threeDaysLater);
            assertThat(bought.getCurrentPeriodEnd()).isEqualTo(BillingPeriod.MONTHLY.endOf(threeDaysLater));
            assertThat(bought.getActivatedBy()).isEqualTo(admin);
        }

        @Test
        @DisplayName("cannot be activated twice, so a colleague cannot extend it by accident")
        void activationIsNotRepeatable() {
            SubscriptionPlan plan = plan("GROWTH", "49.00");
            Subscription bought = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);
            bought.activate(plan, UUID.randomUUID(), null, NOW);

            assertThatThrownBy(() -> bought.activate(plan, UUID.randomUUID(), null, NOW.plusSeconds(60)))
                    .isInstanceOf(IllegalStateException.class);
        }

        @Test
        @DisplayName("a creator cancelling keeps the period they paid for")
        void creatorCancellationIsNotImmediate() {
            SubscriptionPlan plan = plan("GROWTH", "49.00");
            Subscription bought = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);
            bought.activate(plan, UUID.randomUUID(), null, NOW);

            bought.cancelAtPeriodEnd(NOW.plusSeconds(3600));

            assertThat(bought.isCancelAtPeriodEnd()).isTrue();
            // Charging for a month and then withdrawing it is what this prevents.
            assertThat(bought.entitlesAt(NOW.plusSeconds(3600))).isTrue();
        }

        @Test
        @DisplayName("staff ending one takes the entitlement away at once")
        void staffCancellationIsImmediate() {
            SubscriptionPlan plan = plan("GROWTH", "49.00");
            Subscription bought = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);
            bought.activate(plan, UUID.randomUUID(), null, NOW);

            bought.cancelNow("payment reversed", NOW.plusSeconds(3600));

            assertThat(bought.getState()).isEqualTo(SubscriptionState.CANCELED);
            assertThat(bought.entitlesAt(NOW.plusSeconds(3600))).isFalse();
            // The window is kept: it says what was bought, and blanking it would lose the
            // only record of the period somebody is asking for their money back for.
            assertThat(bought.getCurrentPeriodEnd()).isNotNull();
        }

        @Test
        @DisplayName("keeps the price it was sold at when the plan is repriced afterwards")
        void thePriceIsSnapshotted() {
            SubscriptionPlan plan = plan("GROWTH", "49.00");
            Subscription bought = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);

            plan.price(Money.of(new BigDecimal("99.00"), "AZN"));

            // A price that moved under a subscriber would be a bill they never agreed to.
            assertThat(bought.getPrice().amount()).isEqualByComparingTo("49.00");
        }
    }

    @Nested
    @DisplayName("paying by card (#449)")
    class CardPayments {

        private static final Duration WINDOW = Duration.ofDays(7);

        @Test
        @DisplayName("a paid first period names nobody as having activated it")
        void paidActivationHasNoStaff() {
            SubscriptionPlan plan = plan("GROWTH", "49.00");
            Subscription bought = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);

            bought.activatePaid(plan, NOW);

            assertThat(bought.getState()).isEqualTo(SubscriptionState.ACTIVE);
            assertThat(bought.getActivatedBy()).isNull();
            assertThat(bought.getCurrentPeriodEnd()).isEqualTo(BillingPeriod.MONTHLY.endOf(NOW));
        }

        @Test
        @DisplayName("a pending plan owes its first period, whatever the window")
        void pendingOwesTheFirstPeriod() {
            Subscription bought = Subscription.awaitingPayment(
                    UUID.randomUUID(), UUID.randomUUID(), plan("GROWTH", "49.00"), NOW);

            assertThat(bought.paymentDueAt(NOW, WINDOW)).contains(Subscription.DuePayment.FIRST_PERIOD);
            assertThat(bought.renewalOpensAt(WINDOW)).isNull();
        }

        @Test
        @DisplayName("renewal opens at the window's start, inclusive, and closes when the period ends")
        void renewalWindow() {
            Subscription held = active("49.00");
            Instant end = held.getCurrentPeriodEnd();
            Instant opens = end.minus(WINDOW);

            assertThat(held.renewalOpensAt(WINDOW)).isEqualTo(opens);
            assertThat(held.paymentDueAt(opens.minusMillis(1), WINDOW)).isEmpty();
            assertThat(held.paymentDueAt(opens, WINDOW)).contains(Subscription.DuePayment.RENEWAL);
            assertThat(held.paymentDueAt(end.minusMillis(1), WINDOW)).contains(Subscription.DuePayment.RENEWAL);
            // A lapsed plan is bought again rather than renewed.
            assertThat(held.paymentDueAt(end, WINDOW)).isEmpty();
        }

        @Test
        @DisplayName("a free plan owes nothing")
        void freeOwesNothing() {
            Subscription held = Subscription.activeFrom(UUID.randomUUID(), UUID.randomUUID(), plan("FREE", "0.00"), NOW);

            assertThat(held.paymentDueAt(held.getCurrentPeriodEnd().minusSeconds(60), WINDOW)).isEmpty();
            assertThat(held.renewalOpensAt(WINDOW)).isNull();
        }

        @Test
        @DisplayName("renewing early extends from the old end, so no paid day is lost")
        void earlyRenewalExtendsFromTheEnd() {
            Subscription held = active("49.00");
            Instant end = held.getCurrentPeriodEnd();

            held.renew(end.minus(Duration.ofDays(3)));

            assertThat(held.getCurrentPeriodEnd()).isEqualTo(BillingPeriod.MONTHLY.endOf(end));
        }

        @Test
        @DisplayName("renewing after the end starts from the payment, so the period is not partly over")
        void lateRenewalStartsFromNow() {
            Subscription held = active("49.00");
            Instant late = held.getCurrentPeriodEnd().plus(Duration.ofDays(2));

            held.renew(late);

            assertThat(held.getCurrentPeriodEnd()).isEqualTo(BillingPeriod.MONTHLY.endOf(late));
            assertThat(held.entitlesAt(late)).isTrue();
        }

        @Test
        @DisplayName("renewing withdraws the creator's cancellation")
        void renewalLiftsACancellation() {
            Subscription held = active("49.00");
            held.cancelAtPeriodEnd(NOW.plusSeconds(60));

            held.renew(NOW.plusSeconds(120));

            assertThat(held.isCancelAtPeriodEnd()).isFalse();
            assertThat(held.getCanceledAt()).isNull();
        }

        @Test
        @DisplayName("only an active subscription renews")
        void onlyActiveRenews() {
            Subscription pending = Subscription.awaitingPayment(
                    UUID.randomUUID(), UUID.randomUUID(), plan("GROWTH", "49.00"), NOW);

            assertThatThrownBy(() -> pending.renew(NOW)).isInstanceOf(IllegalStateException.class);
        }

        private Subscription active(String price) {
            SubscriptionPlan plan = plan("GROWTH", price);
            Subscription bought = Subscription.awaitingPayment(UUID.randomUUID(), UUID.randomUUID(), plan, NOW);
            bought.activatePaid(plan, NOW);
            return bought;
        }
    }

    private static SubscriptionPlan plan(String code, String price) {
        return SubscriptionPlan.create(
                UUID.randomUUID(),
                code,
                "A plan",
                null,
                Money.of(new BigDecimal(price), "AZN"),
                BillingPeriod.MONTHLY,
                3,
                new BigDecimal("100000.00"),
                10,
                NOW,
                UUID.randomUUID());
    }
}
