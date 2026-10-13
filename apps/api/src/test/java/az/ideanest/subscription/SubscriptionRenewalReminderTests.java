package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.Outbox;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.subscription.application.SubscriptionPaidEvent;
import az.ideanest.subscription.application.SubscriptionRenewalReminderJob;
import az.ideanest.subscription.infrastructure.SubscriptionReminderRepository;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@code subscription-renewal-reminders} and the plan receipt, from the subscription row to the
 * notification — #450.
 *
 * <p>The pass is driven with an instant years ahead of the wall clock, so no subscription another suite
 * left behind falls inside a window it is asking about; every assertion is still scoped to the rows this
 * test wrote.
 */
class SubscriptionRenewalReminderTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** V62's seeded Growth plan. The subscription carries its own price; the name is read from here. */
    private static final UUID GROWTH = UUID.fromString("7c0d4f8e-6a1b-4c2d-9e3f-1a2b3c4d5e02");

    private static final Instant NOW = Instant.parse("2031-03-10T09:00:00Z");

    @Autowired
    private SubscriptionRenewalReminderJob job;

    @Autowired
    private SubscriptionReminderRepository reminders;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private Outbox outbox;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private DataSource dataSource;

    private UUID creator;

    @BeforeEach
    void aCreator() {
        creator = Campaigns.creator(dataSource, "renewal-" + SEQUENCE.incrementAndGet());
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = jdbc();
        jdbc.update("DELETE FROM notifications WHERE recipient_id = ?", creator);
        jdbc.update("DELETE FROM outbox_events WHERE aggregate_type = 'subscription'");
        // Cascades to subscription_reminders.
        jdbc.update("DELETE FROM subscriptions WHERE account_id = ?", creator);
    }

    // ------------------------------------------------------------------
    // Before the end
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a priced plan is reminded at three days and again at one day, once each, however often the pass runs")
    void remindedAtEachLeadOnce() {
        Instant end = NOW.plus(Duration.ofHours(60));
        UUID subscription = active(end, "49.00", false);

        job.remind(NOW);
        job.remind(NOW);
        job.remind(NOW.plus(Duration.ofHours(12)));

        assertThat(events(subscription, "subscription.renewal_due")).hasSize(1);
        assertThat(claims(subscription)).containsExactly("RENEWAL_DUE/72");

        // Inside the last day: the one-day lead's window, and a key of its own.
        job.remind(end.minus(Duration.ofHours(20)));
        job.remind(end.minus(Duration.ofHours(19)));

        assertThat(events(subscription, "subscription.renewal_due")).hasSize(2);
        assertThat(claims(subscription)).containsExactlyInAnyOrder("RENEWAL_DUE/72", "RENEWAL_DUE/24");
    }

    @Test
    @DisplayName("a plan first seen inside the last day is reminded once, at the one-day lead, not twice in one pass")
    void oneReminderPerPass() {
        UUID subscription = active(NOW.plus(Duration.ofHours(20)), "49.00", false);

        job.remind(NOW);

        assertThat(events(subscription, "subscription.renewal_due")).hasSize(1);
        assertThat(claims(subscription)).containsExactly("RENEWAL_DUE/24");
    }

    @Test
    @DisplayName("a plan ending beyond the largest lead is not reminded yet")
    void tooEarly() {
        UUID subscription = active(NOW.plus(Duration.ofDays(4)), "49.00", false);

        job.remind(NOW);

        assertThat(events(subscription, "subscription.renewal_due")).isEmpty();
    }

    @Test
    @DisplayName("a creator who cancelled is neither reminded nor told the plan lapsed")
    void cancelledByTheCreatorIsLeftAlone() {
        Instant end = NOW.plus(Duration.ofDays(2));
        UUID subscription = active(end, "49.00", true);

        job.remind(NOW);
        job.remind(end.plus(Duration.ofHours(1)));

        assertThat(events(subscription, "subscription.renewal_due")).isEmpty();
        assertThat(events(subscription, "subscription.lapsed")).isEmpty();
    }

    @Test
    @DisplayName("a free plan has nothing to renew and is never reminded")
    void freePlanIsLeftAlone() {
        Instant end = NOW.plus(Duration.ofDays(2));
        UUID subscription = active(end, "0.00", false);

        job.remind(NOW);
        job.remind(end.plus(Duration.ofHours(1)));

        assertThat(events(subscription, "subscription.renewal_due")).isEmpty();
        assertThat(events(subscription, "subscription.lapsed")).isEmpty();
    }

    @Test
    @DisplayName("a renewal moves the period end, and the next period is reminded under new keys")
    void aRenewalReArmsTheReminders() {
        Instant end = NOW.plus(Duration.ofDays(2));
        UUID subscription = active(end, "49.00", false);
        job.remind(NOW);

        Instant next = end.plus(Duration.ofDays(30));
        jdbc().update(
                "UPDATE subscriptions SET current_period_end = ? WHERE id = ?",
                java.sql.Timestamp.from(next),
                subscription);
        job.remind(end.minus(Duration.ofHours(1)));

        assertThat(events(subscription, "subscription.renewal_due"))
                .as("the renewed period is not due on the old end date")
                .hasSize(1);

        job.remind(next.minus(Duration.ofDays(2)));

        assertThat(events(subscription, "subscription.renewal_due")).hasSize(2);
    }

    // ------------------------------------------------------------------
    // After the end
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a plan that ended without a renewal is announced once")
    void lapsedOnce() {
        Instant end = NOW.minus(Duration.ofHours(5));
        UUID subscription = active(end, "49.00", false);

        job.remind(NOW);
        job.remind(NOW);
        job.remind(NOW.plus(Duration.ofDays(1)));

        assertThat(events(subscription, "subscription.lapsed")).hasSize(1);
        assertThat(events(subscription, "subscription.renewal_due")).isEmpty();
        assertThat(claims(subscription)).containsExactly("LAPSED/0");
    }

    @Test
    @DisplayName("a period that ended before the look-back is not announced, so a first deployment does not spam")
    void theLookBackBoundsTheLapse() {
        UUID subscription = active(NOW.minus(Duration.ofDays(8)), "49.00", false);

        job.remind(NOW);

        assertThat(events(subscription, "subscription.lapsed")).isEmpty();
    }

    @Test
    @DisplayName("a subscription staff ended is never told it lapsed")
    void endedByStaffIsLeftAlone() {
        UUID subscription = active(NOW.minus(Duration.ofDays(1)), "49.00", false);
        jdbc().update("UPDATE subscriptions SET state = 'CANCELED', canceled_at = ? WHERE id = ?",
                java.sql.Timestamp.from(NOW.minus(Duration.ofDays(3))), subscription);

        job.remind(NOW);

        assertThat(events(subscription, "subscription.lapsed")).isEmpty();
    }

    // ------------------------------------------------------------------
    // The claim
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the claim is the database's: a second insert of the same key is refused, whatever was read")
    void theClaimIsAUniqueKey() {
        Instant end = NOW.plus(Duration.ofDays(2));
        UUID subscription = active(end, "49.00", false);

        TransactionTemplate tx = new TransactionTemplate(transactions);
        Boolean first = tx.execute(status -> reminders.claim(subscription, end, "RENEWAL_DUE", 72, NOW));
        Boolean second = tx.execute(status -> reminders.claim(subscription, end, "RENEWAL_DUE", 72, NOW));
        assertThat(first).isTrue();
        assertThat(second).isFalse();
        // Already claimed, so the pass the claim was made for sends nothing.
        job.remind(NOW);

        assertThat(events(subscription, "subscription.renewal_due")).isEmpty();
    }

    // ------------------------------------------------------------------
    // What the creator receives
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the reminder reaches the creator with the plan, the snapshot price, the end date and the days left")
    void theReminderBecomesANotification() {
        Instant end = Instant.parse("2031-03-12T15:00:00Z");
        UUID subscription = active(end, "49.00", false);

        job.remind(NOW);
        relay.run();

        Map<String, Object> row = notification("SUBSCRIPTION_RENEWAL_DUE");
        assertThat(row)
                .containsEntry("subject_type", "subscription")
                .containsEntry("subject_id", subscription)
                .containsEntry("plan", "Growth")
                .containsEntry("price", "49.00")
                .containsEntry("period_end", "2031-03-12")
                .containsEntry("days_left", "3");
        assertThat(channels("SUBSCRIPTION_RENEWAL_DUE")).contains("IN_APP", "EMAIL");
    }

    @Test
    @DisplayName("the lapse reaches the creator with the plan and the day it ended")
    void theLapseBecomesANotification() {
        Instant end = Instant.parse("2031-03-09T15:00:00Z");
        UUID subscription = active(end, "49.00", false);

        job.remind(NOW);
        relay.run();

        assertThat(notification("SUBSCRIPTION_LAPSED"))
                .containsEntry("subject_id", subscription)
                .containsEntry("plan", "Growth")
                .containsEntry("period_end", "2031-03-09");
    }

    @Test
    @DisplayName("#449's subscription.paid becomes the creator's receipt, with the amount paid and the new end")
    void aPaymentBecomesTheReceipt() {
        UUID subscription = active(NOW.plus(Duration.ofDays(30)), "49.00", false);
        SubscriptionPaidEvent paid = new SubscriptionPaidEvent(
                subscription,
                creator,
                GROWTH,
                "Growth",
                Money.of(new BigDecimal("49.00"), "AZN"),
                true,
                Instant.parse("2031-04-10T09:00:00Z"),
                NOW);

        new TransactionTemplate(transactions).executeWithoutResult(status -> outbox.record(
                SubscriptionPaidEvent.AGGREGATE_TYPE, subscription, SubscriptionPaidEvent.EVENT_TYPE, paid));
        relay.run();

        assertThat(notification("SUBSCRIPTION_RENEWED"))
                .containsEntry("subject_id", subscription)
                .containsEntry("plan", "Growth")
                .containsEntry("amount", "49.00")
                .containsEntry("period_end", "2031-04-10")
                .containsEntry("renewal", "true");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }

    /** An ACTIVE subscription to Growth at this price, a month long, ending at {@code end}. */
    private UUID active(Instant end, String price, boolean cancelAtPeriodEnd) {
        UUID id = UUID.randomUUID();
        jdbc().update(
                """
                INSERT INTO subscriptions
                    (id, account_id, plan_id, state, price, currency, billing_period,
                     started_at, current_period_end, cancel_at_period_end, canceled_at)
                VALUES (?, ?, ?, 'ACTIVE', ?, 'AZN', 'MONTHLY', ?, ?, ?, ?)
                """,
                id,
                creator,
                GROWTH,
                new BigDecimal(price),
                java.sql.Timestamp.from(end.minus(Duration.ofDays(30))),
                java.sql.Timestamp.from(end),
                cancelAtPeriodEnd,
                cancelAtPeriodEnd ? java.sql.Timestamp.from(end.minus(Duration.ofDays(10))) : null);
        return id;
    }

    private List<String> events(UUID subscription, String type) {
        return jdbc().queryForList(
                "SELECT payload::text FROM outbox_events WHERE aggregate_type = 'subscription'"
                        + " AND aggregate_id = ? AND event_type = ?",
                String.class,
                subscription,
                type);
    }

    private List<String> claims(UUID subscription) {
        return jdbc().queryForList(
                "SELECT kind || '/' || lead_hours FROM subscription_reminders WHERE subscription_id = ?",
                String.class,
                subscription);
    }

    /** The creator's in-app row of this type, with the facts the copy reads. */
    private Map<String, Object> notification(String type) {
        return jdbc().queryForMap(
                """
                SELECT subject_type, subject_id,
                       params->>'planName' AS plan,
                       COALESCE(params->'price'->>'amount', params->'amount'->>'amount') AS price,
                       params->'amount'->>'amount' AS amount,
                       params->>'periodEnd' AS period_end,
                       params->>'daysLeft' AS days_left,
                       params->>'renewal' AS renewal
                  FROM notifications
                 WHERE recipient_id = ? AND type = ? AND channel = 'IN_APP'
                """,
                creator,
                type);
    }

    private List<String> channels(String type) {
        return jdbc().queryForList(
                "SELECT channel FROM notifications WHERE recipient_id = ? AND type = ?", String.class, creator, type);
    }
}
