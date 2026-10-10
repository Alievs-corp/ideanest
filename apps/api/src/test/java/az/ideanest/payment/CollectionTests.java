package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.payment.application.ChargeProcessorJob;
import az.ideanest.payment.application.ChargeRetryJob;
import az.ideanest.payment.application.CollectionEvents;
import az.ideanest.payment.application.CollectionRun;
import az.ideanest.payment.application.ProviderCircuitBreaker;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Ledgers;
import az.ideanest.support.Pledges;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedStoredCards;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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

/**
 * §9.2's phase two and §9.6's schedule, end to end (#64, #65).
 *
 * <p>This is where a campaign stops being an obligation and becomes money, so the
 * properties asserted here are the ones whose absence is expensive in a way nothing else
 * on the platform is:
 *
 * <ul>
 *   <li>{@link #aSuccessfulCampaignIsQueuedAndCollected()} — the whole of §9.2's phase
 *       two, including the ledger posting and the receipt.
 *   <li>{@link #aSecondPassDoesNotQueueTwice()} — queuing twice would reset every
 *       backer's attempt count and hand four fresh attempts to cards already refused four
 *       times.
 *   <li>{@link #aCollectedPledgeIsNeverChargedAgain()} — the failure that charges somebody
 *       twice.
 *   <li>{@link #anUnreachableProviderDoesNotCostAnAttempt()} — §9.6 gives four chances at a
 *       card, not four chances at a network.
 *   <li>{@link #anUndecidedChargeKeepsItsIdempotencyKey()} — §9.3's R-08, which is the only
 *       thing standing between a re-poll and a second charge.
 *   <li>{@link #aDeclineIsRecordedWithItsCode()} and
 *       {@link #theWindowElapsingDropsThePledge()} — §9.6's schedule from the first refusal
 *       to the drop.
 * </ul>
 *
 * <p>The jobs are driven directly with the instant to judge against;
 * {@code application-test.yml} sets both schedules to {@code -} for the reason every job
 * in this codebase does, and with a sharper one here — a timer firing in the background
 * would charge the very pledges a test is about to assert are uncharged.
 *
 * <p><strong>Nothing is torn down.</strong> V41 makes {@code transactions} and
 * {@code ledger_entries} append-only in PostgreSQL and both reference the pledge and the
 * campaign, so a suite that has collected anything cannot delete either — the database
 * refuses, which is the property those triggers exist for. Every test therefore mints its
 * own campaign and scopes every assertion to it.
 */
class CollectionTests extends AbstractIntegrationTest {

    /** Distinguishes the accounts, slugs and handles these tests create. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private ChargeProcessorJob processor;

    @Autowired
    private ChargeRetryJob retries;

    @Autowired
    private ScriptedPaymentProvider provider;

    @Autowired
    private ScriptedStoredCards cards;

    @Autowired
    private ProviderCircuitBreaker breaker;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private Ledger ledger;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;

    @BeforeEach
    void aCreatorAndAFreshScript() {
        handle = "collect-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);

        // The suite shares one context, so the provider, the cards and the breaker are
        // shared too. A test that inherited another test's open breaker would fail for a
        // reason nowhere in its own body.
        provider.reset();
        cards.reset();
        breaker.reset();
    }

    /**
     * Parks every collection this suite left behind, so that the next test's sweep sees
     * only its own rows.
     *
     * <p><strong>Parked rather than deleted, and the reason is the feature under test.</strong>
     * V41 makes {@code transactions} and {@code ledger_entries} append-only in PostgreSQL
     * and both reference the pledge with {@code ON DELETE NO ACTION}, so a pledge that has
     * been charged cannot be removed — the database refuses, which is exactly the property
     * those triggers exist for. Moving the leftovers out of both queues achieves what
     * teardown is for without asking the schema to be less strict than it is.
     *
     * <p>It has to happen at all because the two jobs are <em>global</em> sweeps: they
     * claim the next pledge due anywhere, not the next pledge on this test's campaign. A
     * suite that left its rows queued would have each test charging the previous test's
     * pledges, and the bound on a pass — three, in this profile — would be spent before
     * the test's own pledge was reached.
     *
     * <p>Scoped by slug to this suite's campaigns, so that nothing another suite created is
     * touched.
     */
    @AfterEach
    void parkWhatThisSuiteLeftQueued() {
        jdbc().update(
                        """
                        UPDATE pledges
                           SET state = 'DROPPED',
                               canceled_at = now(),
                               next_charge_attempt_at = NULL,
                               charge_window_ends_at = NULL
                         WHERE state IN ('CHARGE_PENDING', 'CHARGE_FAILED')
                           AND project_id IN (SELECT id FROM projects WHERE slug LIKE 'collect-%')
                        """);
        // A campaign this test left in SUCCESSFUL would be opened by the next test's pass
        // and would spend part of its campaigns-per-pass budget.
        jdbc().update("UPDATE projects SET state = 'COLLECTING' WHERE state = 'SUCCESSFUL' AND slug LIKE 'collect-%'");
        // And the financial rows, which reference this suite's campaigns and pledges with
        // ON DELETE NO ACTION -- so leaving them would make the next suite's
        // `DELETE FROM projects` fail. Ledgers has the argument for why teardown is
        // allowed to turn V41's triggers off for the length of two statements.
        Ledgers.clear(dataSource);
    }

    // ------------------------------------------------------------------
    // §9.2's phase two
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a successful campaign starts collecting, and its confirmed pledges are charged")
    void aSuccessfulCampaignIsQueuedAndCollected() {
        UUID projectId = successful();
        UUID first = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        UUID second = Pledges.confirmed(dataSource, projectId, handle + "-b", "45.50");

        assertThat(processor.collect(now())).isEqualTo(2);

        assertThat(stateOf(projectId)).isEqualTo(ProjectState.COLLECTING);
        assertThat(pledgeState(first)).isEqualTo("COLLECTED");
        assertThat(pledgeState(second)).isEqualTo("COLLECTED");
        assertThat(collectedAt(first)).isNotNull();
    }

    /**
     * §9.5's collection arrow: escrow is debited and the creator's account is credited.
     *
     * <p>The fee split is deliberately <em>not</em> here — §9.5 puts the distribution
     * after the fourteen-day hold, and #69 owns it. {@code CollectionRun#post} carries the
     * argument, including where §9.2's diagram disagrees.
     */
    @Test
    @DisplayName("a collected pledge posts a balanced pair of ledger entries")
    void aCollectionIsPosted() {
        UUID projectId = successful();
        Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");

        processor.collect(now());

        assertThat(ledger.balanceOf(LedgerAccount.ESCROW, projectId, "AZN").amount())
                .isEqualByComparingTo("120.00");
        assertThat(ledger.balanceOf(LedgerAccount.creator(creatorId), projectId, "AZN")
                        .amount())
                .as("a credit, so the balance of what the platform owes the creator is negative")
                .isEqualByComparingTo("-120.00");
    }

    @Test
    @DisplayName("a collected pledge records what the provider did, with its identifier")
    void aCollectionIsRecorded() {
        UUID projectId = successful();
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");

        processor.collect(now());

        Map<String, Object> transaction = onlyTransactionFor(pledgeId);
        assertThat(transaction.get("type")).isEqualTo("CHARGE");
        assertThat(transaction.get("status")).isEqualTo("SUCCEEDED");
        assertThat(transaction.get("provider")).isEqualTo(ProviderName.AZERICARD.name());
        assertThat(transaction.get("attempt_number")).isEqualTo(1);
        assertThat((BigDecimal) transaction.get("amount")).isEqualByComparingTo("120.00");
        assertThat((String) transaction.get("provider_transaction_id")).startsWith("scripted-");
        assertThat(transaction.get("failure_code")).isNull();
    }

    @Test
    @DisplayName("a collected pledge is announced, with the amount as a string")
    void aCollectionIsAnnounced() {
        UUID projectId = successful();
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");

        processor.collect(now());

        List<Map<String, Object>> events = eventsFor(pledgeId);
        assertThat(events).hasSize(1);
        assertThat(events.getFirst().get("event_type")).isEqualTo(CollectionEvents.PledgeCollected.EVENT_TYPE);
        assertThat(events.getFirst().get("aggregate_type")).isEqualTo("pledge");
        assertThat(String.valueOf(events.getFirst().get("payload")))
                .as("§10.3: money crosses as a string, never a number")
                .contains("\"amount\":\"120.00\"")
                .contains("\"currency\":\"AZN\"");
    }

    /**
     * <strong>The failure that charges somebody twice.</strong>
     *
     * <p>Two passes over one campaign. The second must find nothing: the pledge has left
     * both queues, and the campaign has left {@code SUCCESSFUL} so it is not opened again.
     */
    @Test
    @DisplayName("a collected pledge is never charged again")
    void aCollectedPledgeIsNeverChargedAgain() {
        UUID projectId = successful();
        Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");

        processor.collect(now());
        assertThat(processor.collect(now())).isZero();

        assertThat(provider.chargeCount()).isEqualTo(1);
    }

    /**
     * Queuing a campaign twice would reset every backer's {@code charge_attempts} to zero.
     *
     * <p>Which is worse than it sounds: a backer whose card has already been refused four
     * times would be given four more attempts and four more messages, and the seven-day
     * window would be extended by however long it took anybody to notice.
     */
    @Test
    @DisplayName("a second pass does not queue a campaign that is already collecting")
    void aSecondPassDoesNotQueueTwice() {
        UUID projectId = successful();
        provider.willDecline("insufficient_funds");
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");

        processor.collect(now());
        assertThat(chargeAttempts(pledgeId)).isEqualTo(1);

        processor.collect(now());

        assertThat(chargeAttempts(pledgeId))
                .as("still one: the campaign is COLLECTING, so nothing re-queued the pledge")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("a pledge that was never confirmed is not collected")
    void onlyConfirmedPledgesAreQueued() {
        UUID projectId = successful();
        UUID draft = draft(projectId, handle + "-draft");
        UUID confirmed = Pledges.confirmed(dataSource, projectId, handle + "-a", "10.00");

        processor.collect(now());

        assertThat(pledgeState(draft))
                .as("§5.1 decided success from the confirmed pledges; a draft was never a commitment")
                .isEqualTo("DRAFT");
        assertThat(pledgeState(confirmed)).isEqualTo("COLLECTED");
    }

    // ------------------------------------------------------------------
    // §9.6: a card that is refused
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a declined charge is recorded with the provider's code and scheduled for +24 hours")
    void aDeclineIsRecordedWithItsCode() {
        UUID projectId = successful();
        provider.willDecline("insufficient_funds");
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        Instant at = now();

        processor.collect(at);

        assertThat(pledgeState(pledgeId)).isEqualTo("CHARGE_FAILED");
        assertThat(chargeAttempts(pledgeId)).isEqualTo(1);
        assertThat(nextAttemptAt(pledgeId)).isEqualTo(at.plus(Duration.ofHours(24)));

        Map<String, Object> transaction = onlyTransactionFor(pledgeId);
        assertThat(transaction.get("status")).isEqualTo("FAILED");
        assertThat(transaction.get("failure_code")).isEqualTo("insufficient_funds");
    }

    @Test
    @DisplayName("a decline posts nothing to the ledger; nothing moved")
    void aDeclinePostsNothing() {
        UUID projectId = successful();
        provider.willDecline("insufficient_funds");
        Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");

        processor.collect(now());

        assertThat(ledger.balanceOf(LedgerAccount.ESCROW, projectId, "AZN").isZero())
                .isTrue();
    }

    /**
     * §9.6's channel column: attempt 1 has none.
     *
     * <p>{@code RetrySchedule#notifiesBacker} carries the argument, including where §9.2's
     * diagram disagrees with §9.6's table.
     */
    @Test
    @DisplayName("the first failure is not announced; the second is")
    void theFirstFailureIsSilent() {
        UUID projectId = successful();
        provider.willDecline("do_not_honour");
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        Instant closedAt = now();

        processor.collect(closedAt);
        assertThat(eventsFor(pledgeId)).as("§9.6 gives attempt 1 no channel").isEmpty();

        retries.retryFailedCollections(closedAt.plus(Duration.ofHours(24)));

        assertThat(eventsFor(pledgeId))
                .extracting(event -> event.get("event_type"))
                .containsExactly(CollectionEvents.PaymentFailed.EVENT_TYPE);
    }

    /**
     * §9.6's fourth row gets its own notification type, and it carries the date the pledge
     * will be dropped — which is the only thing that makes the message actionable.
     */
    @Test
    @DisplayName("the last attempt sends the final warning rather than another failure notice")
    void theLastAttemptWarnsFinally() {
        UUID projectId = successful();
        provider.willDecline("expired_card");
        Instant closedAt = now();
        UUID pledgeId = Pledges.queued(
                dataSource,
                projectId,
                handle + "-a",
                "120.00",
                "CHARGE_FAILED",
                3,
                closedAt.plus(Duration.ofDays(5)),
                closedAt.plus(Duration.ofDays(7)));

        retries.retryFailedCollections(closedAt.plus(Duration.ofDays(5)));

        assertThat(chargeAttempts(pledgeId)).isEqualTo(4);
        List<Map<String, Object>> events = eventsFor(pledgeId);
        assertThat(events)
                .extracting(event -> event.get("event_type"))
                .containsExactly(CollectionEvents.FinalPaymentWarning.EVENT_TYPE);
        assertThat(String.valueOf(events.getFirst().get("payload")))
                .contains("\"attempt\":4")
                .contains("\"droppedAt\"");
    }

    @Test
    @DisplayName("a card that is fixed between attempts is collected on the retry")
    void aFixedCardIsCollectedOnRetry() {
        UUID projectId = successful();
        provider.willDecline("insufficient_funds");
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        Instant closedAt = now();

        processor.collect(closedAt);
        provider.willApprove();
        assertThat(retries.retryFailedCollections(closedAt.plus(Duration.ofHours(24)))).isEqualTo(1);

        assertThat(pledgeState(pledgeId)).isEqualTo("COLLECTED");
        assertThat(chargeAttempts(pledgeId)).isEqualTo(2);
        assertThat(ledger.balanceOf(LedgerAccount.ESCROW, projectId, "AZN").amount())
                .isEqualByComparingTo("120.00");
    }

    @Test
    @DisplayName("a retry that is not yet due is not made")
    void aRetryBeforeItsSlotIsNotMade() {
        UUID projectId = successful();
        provider.willDecline("insufficient_funds");
        Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        Instant closedAt = now();

        processor.collect(closedAt);
        int before = provider.chargeCount();

        retries.retryFailedCollections(closedAt.plus(Duration.ofHours(23)));

        assertThat(provider.chargeCount()).isEqualTo(before);
    }

    // ------------------------------------------------------------------
    // §9.6's last row
    // ------------------------------------------------------------------

    /**
     * The boundary, and it is the one place §9.6 could quietly become a five-attempt
     * schedule.
     *
     * <p>The last slot the schedule can offer once the four attempts are used is the end
     * of the window — V42 refuses a queued pledge with no next attempt, so it has to offer
     * something. At that instant the pledge is both "due" and "out of time", and the
     * claim's {@code charge_window_ends_at > :now} is what decides between them. The
     * provider is left approving here on purpose: if the pledge were charged, this test
     * would find it {@code COLLECTED} rather than {@code DROPPED}, which is exactly the
     * fifth attempt nobody sanctioned.
     */
    @Test
    @DisplayName("a pledge whose window has elapsed is dropped rather than charged a fifth time")
    void theWindowElapsingDropsThePledge() {
        UUID projectId = successful();
        Instant closedAt = now();
        UUID pledgeId = Pledges.queued(
                dataSource,
                projectId,
                handle + "-a",
                "120.00",
                "CHARGE_FAILED",
                4,
                closedAt.plus(Duration.ofDays(7)),
                closedAt.plus(Duration.ofDays(7)));

        retries.retryFailedCollections(closedAt.plus(Duration.ofDays(7)));

        assertThat(pledgeState(pledgeId)).isEqualTo("DROPPED");
        assertThat(provider.chargeCount())
                .as("§9.6 gives four attempts, and the window closing is not a fifth")
                .isZero();
        assertThat(nextAttemptAt(pledgeId))
                .as("V42 refuses a schedule on a pledge that is no longer being collected")
                .isNull();
    }

    @Test
    @DisplayName("a pledge inside its window is not dropped")
    void aPledgeInsideItsWindowIsNotDropped() {
        UUID projectId = successful();
        Instant closedAt = now();
        UUID pledgeId = Pledges.queued(
                dataSource,
                projectId,
                handle + "-a",
                "120.00",
                "CHARGE_FAILED",
                4,
                closedAt.plus(Duration.ofDays(7)),
                closedAt.plus(Duration.ofDays(7)));

        retries.retryFailedCollections(closedAt.plus(Duration.ofDays(6)));

        assertThat(pledgeState(pledgeId)).isEqualTo("CHARGE_FAILED");
    }

    // ------------------------------------------------------------------
    // A provider that cannot be reached
    // ------------------------------------------------------------------

    /**
     * <strong>§9.6 gives a backer four chances at their card, not four chances at a
     * network.</strong>
     *
     * <p>An outage that consumed attempts would mean a provider's bad afternoon dropping
     * pledges from campaigns that funded, and the backers would be told their cards had
     * been refused.
     */
    @Test
    @DisplayName("a provider that cannot be reached does not cost the backer an attempt")
    void anUnreachableProviderDoesNotCostAnAttempt() {
        UUID projectId = successful();
        provider.willBeUnavailable();
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");

        processor.collect(now());

        assertThat(chargeAttempts(pledgeId)).isZero();
        assertThat(pledgeState(pledgeId))
                .as("CHARGE_FAILED would say the card was refused, which is exactly what is not known")
                .isEqualTo("CHARGE_PENDING");

        Map<String, Object> transaction = onlyTransactionFor(pledgeId);
        assertThat(transaction.get("status")).isEqualTo("FAILED");
        assertThat(transaction.get("failure_code")).isEqualTo("provider_unreachable");
    }

    /**
     * The pass stops rather than rediscovering one outage once per pledge.
     *
     * <p>The test profile sets {@code charges-per-pass} to three, so a pass that did not
     * stop would attempt all three.
     */
    @Test
    @DisplayName("an outage ends the pass instead of being met once per pledge")
    void anOutageEndsThePass() {
        UUID projectId = successful();
        provider.willBeUnavailable();
        Pledges.confirmed(dataSource, projectId, handle + "-a", "10.00");
        Pledges.confirmed(dataSource, projectId, handle + "-b", "20.00");
        Pledges.confirmed(dataSource, projectId, handle + "-c", "30.00");

        processor.collect(now());

        assertThat(provider.chargeCount()).isEqualTo(1);
    }

    /**
     * The breaker opens on unavailability and never on declines.
     *
     * <p>§9.6 puts declines at 5–15% of a campaign, so a breaker that counted them would
     * open on a perfectly healthy Tuesday and stop collecting the other 85%.
     */
    @Test
    @DisplayName("declines never open the circuit breaker")
    void declinesNeverOpenTheBreaker() {
        UUID projectId = successful();
        provider.willDecline("do_not_honour");
        Pledges.confirmed(dataSource, projectId, handle + "-a", "10.00");
        Pledges.confirmed(dataSource, projectId, handle + "-b", "20.00");
        Pledges.confirmed(dataSource, projectId, handle + "-c", "30.00");

        processor.collect(now());

        assertThat(provider.chargeCount()).as("all three were attempted").isEqualTo(3);
        assertThat(breaker.isOpen(ProviderName.AZERICARD)).isFalse();
    }

    @Test
    @DisplayName("consecutive outages open the breaker, and the next pass asks nothing")
    void consecutiveOutagesOpenTheBreaker() {
        UUID projectId = successful();
        provider.willBeUnavailable();
        Pledges.confirmed(dataSource, projectId, handle + "-a", "10.00");
        Pledges.confirmed(dataSource, projectId, handle + "-b", "20.00");
        Instant at = now();

        // The test profile's threshold is two, and a pass stops at the first outage -- so
        // two passes are what it takes, which is also what would happen in production.
        processor.collect(at);
        processor.collect(at);
        assertThat(breaker.isOpen(ProviderName.AZERICARD)).isTrue();

        int before = provider.chargeCount();
        processor.collect(at);

        assertThat(provider.chargeCount())
                .as("an open breaker means the provider is not asked at all")
                .isEqualTo(before);
    }

    // ------------------------------------------------------------------
    // §9.3's R-08
    // ------------------------------------------------------------------

    /**
     * <strong>The only thing standing between a re-poll and a second charge.</strong>
     *
     * <p>A provider that accepted the instruction and has not decided is asked about the
     * <em>same</em> attempt, under the same key, so R-08 makes the provider replay its
     * answer rather than take the money again. Advancing the attempt would change the key
     * and turn the question into a second charge.
     */
    @Test
    @DisplayName("an undecided charge is asked about again under the same idempotency key")
    void anUndecidedChargeKeepsItsIdempotencyKey() {
        UUID projectId = successful();
        provider.willLeavePending();
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        Instant at = now();

        processor.collect(at);
        assertThat(chargeAttempts(pledgeId)).isZero();
        assertThat(pledgeState(pledgeId)).isEqualTo("CHARGE_PENDING");

        processor.collect(at.plus(Duration.ofHours(1)));

        assertThat(provider.chargeCount()).isEqualTo(2);
        assertThat(provider.idempotencyKeys())
                .as("the same attempt, so the same key: R-08 makes the provider replay rather than re-charge")
                .containsExactly("collect:" + pledgeId + ":1", "collect:" + pledgeId + ":1");
    }

    @Test
    @DisplayName("an undecided charge writes one PENDING row however often it is asked about")
    void anUndecidedChargeIsRecordedOnce() {
        UUID projectId = successful();
        provider.willLeavePending();
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        Instant at = now();

        processor.collect(at);
        processor.collect(at.plus(Duration.ofHours(1)));
        processor.collect(at.plus(Duration.ofHours(2)));

        assertThat(transactionsFor(pledgeId)).hasSize(1);
        assertThat(transactionsFor(pledgeId).getFirst().get("status")).isEqualTo("PENDING");
    }

    /**
     * The row that settles a {@code PENDING} one shares its key, which V41's partial
     * unique index permits and a full one would not.
     */
    @Test
    @DisplayName("a settled charge is recorded beside the PENDING row that preceded it")
    void aSettledChargeJoinsItsPendingRow() {
        UUID projectId = successful();
        provider.nextCharge(ProviderOutcome.PENDING);
        provider.nextCharge(ProviderOutcome.APPROVED);
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        Instant at = now();

        processor.collect(at);
        processor.collect(at.plus(Duration.ofHours(1)));

        assertThat(pledgeState(pledgeId)).isEqualTo("COLLECTED");
        assertThat(transactionsFor(pledgeId))
                .extracting(row -> row.get("status"))
                .containsExactlyInAnyOrder("PENDING", "SUCCEEDED");
        assertThat(transactionsFor(pledgeId))
                .extracting(row -> row.get("idempotency_key"))
                .containsOnly("collect:" + pledgeId + ":1");
    }

    @Test
    @DisplayName("each attempt is made under its own key")
    void everyAttemptHasItsOwnKey() {
        UUID projectId = successful();
        provider.willDecline("insufficient_funds");
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        Instant closedAt = now();

        processor.collect(closedAt);
        retries.retryFailedCollections(closedAt.plus(Duration.ofHours(24)));

        assertThat(provider.idempotencyKeys())
                .containsExactly("collect:" + pledgeId + ":1", "collect:" + pledgeId + ":2");
    }

    // ------------------------------------------------------------------
    // The state of the platform today
    // ------------------------------------------------------------------

    /**
     * A pledge with no saved card, which is <em>every</em> pledge the platform holds:
     * {@code payment_methods} is #55, blocked on #60, so nothing has ever written
     * {@code pledges.payment_method_id}.
     *
     * <p>It counts against §9.6's four, because a pledge with no card will not acquire one
     * by being retried and should reach its window and be dropped rather than sit in the
     * queue for ever. The distinct code is what lets a report tell it from a real decline.
     */
    @Test
    @DisplayName("a pledge with no stored card fails with a code of the platform's own")
    void aPledgeWithNoCardFails() {
        UUID projectId = successful();
        UUID pledgeId = Pledges.confirmed(dataSource, projectId, handle + "-a", "120.00");
        cards.withoutACard(pledgeId);

        processor.collect(now());

        assertThat(pledgeState(pledgeId)).isEqualTo("CHARGE_FAILED");
        assertThat(onlyTransactionFor(pledgeId).get("failure_code")).isEqualTo(CollectionRun.NO_PAYMENT_METHOD);
        assertThat(provider.chargeCount()).as("no provider was asked").isZero();
    }

    // ------------------------------------------------------------------
    // The bound on a pass
    // ------------------------------------------------------------------

    /**
     * §9.3's R-09: the rate limit is the batch per tick.
     *
     * <p>Observable only because the test profile sets {@code charges-per-pass} to three.
     * What is asserted is that the pass is bounded and the remainder is picked up next
     * time, not the number.
     */
    @Test
    @DisplayName("a pass charges at most its batch, and the next one takes the rest")
    void aPassIsBounded() {
        UUID projectId = successful();
        for (int pledge = 0; pledge < 4; pledge++) {
            Pledges.confirmed(dataSource, projectId, handle + "-p" + pledge, "10.00");
        }

        assertThat(processor.collect(now())).isEqualTo(3);
        assertThat(processor.collect(now())).isEqualTo(1);
        assertThat(processor.collect(now())).isZero();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** The instant a pass judges against, truncated as the jobs truncate it. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    /** A campaign §5.1 decided in favour of, waiting for its collection to open. */
    private UUID successful() {
        Instant deadline = Instant.now().minus(Duration.ofMinutes(5));
        return Campaigns.seed(dataSource, creatorId, handle + "-" + SEQUENCE.incrementAndGet())
                .state("SUCCESSFUL")
                .goal("100.00")
                .pledged("1000.00")
                .backers(4)
                .launchedAt(deadline.minus(Duration.ofDays(30)))
                .deadline(deadline)
                .insert();
    }

    /** A draft pledge, holding a reservation that has not lapsed. */
    private UUID draft(UUID projectId, String backerHandle) {
        UUID pledgeId = UUID.randomUUID();
        jdbc().update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, currency,
                                             reservation_expires_at)
                        VALUES (?, ?, ?, 'DRAFT', 10.00, 'AZN', now() + interval '5 minutes')
                        """,
                        pledgeId,
                        projectId,
                        Campaigns.creator(dataSource, backerHandle));
        return pledgeId;
    }

    private ProjectState stateOf(UUID projectId) {
        return projects.findById(projectId).orElseThrow().getState();
    }

    private String pledgeState(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }

    private int chargeAttempts(UUID pledgeId) {
        Integer attempts =
                jdbc().queryForObject("SELECT charge_attempts FROM pledges WHERE id = ?", Integer.class, pledgeId);
        return attempts == null ? 0 : attempts;
    }

    private Instant nextAttemptAt(UUID pledgeId) {
        return instant("next_charge_attempt_at", pledgeId);
    }

    private Instant collectedAt(UUID pledgeId) {
        return instant("collected_at", pledgeId);
    }

    private Instant instant(String column, UUID pledgeId) {
        java.sql.Timestamp value = jdbc().queryForObject(
                "SELECT " + column + " FROM pledges WHERE id = ?", java.sql.Timestamp.class, pledgeId);
        return value == null ? null : value.toInstant();
    }

    private List<Map<String, Object>> transactionsFor(UUID pledgeId) {
        return jdbc().queryForList(
                        """
                        SELECT type, status, provider, provider_transaction_id, amount, failure_code,
                               attempt_number, idempotency_key
                          FROM transactions WHERE pledge_id = ? ORDER BY created_at
                        """,
                        pledgeId);
    }

    private Map<String, Object> onlyTransactionFor(UUID pledgeId) {
        List<Map<String, Object>> rows = transactionsFor(pledgeId);
        assertThat(rows).hasSize(1);
        return rows.getFirst();
    }

    private List<Map<String, Object>> eventsFor(UUID pledgeId) {
        return jdbc().queryForList(
                        "SELECT aggregate_type, event_type, payload FROM outbox_events"
                                + " WHERE aggregate_id = ? ORDER BY sequence_no",
                        pledgeId);
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
