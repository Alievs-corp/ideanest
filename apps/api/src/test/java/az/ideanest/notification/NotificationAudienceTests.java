package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.notification.application.NotificationEvents.GoalReached;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.audience.AudienceProperties;
import az.ideanest.shared.audience.ProjectAudience;
import az.ideanest.shared.audience.ProjectAudiences;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.Outbox;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
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
 * An audience the platform computes: that "goal reached" reaches the people who funded it.
 *
 * <p>#245's whole complaint. #85's fan-out resolved one recipient per event, taken from the
 * payload, so {@code GoalReached} notified the creator and nobody else — "the least useful half
 * of that event: the people who funded it hear nothing". The port
 * {@code shared.audience.ProjectAudiences} is what changes that, and this suite is what makes it
 * a guarantee.
 *
 * <p>The rows go in through the real path — pledges in the table, an outbox event, the relay, the
 * fan-out — because the property being asserted is that the pledge module's definition of a
 * backer and the notification module's audience are the same set. A fixture that decided who the
 * backers were would be asserting its own opinion.
 *
 * <p>The ones that carry the design:
 *
 * <ul>
 *   <li>{@link #goalReachedTellsTheCreatorAndTheBackers()} — the feature.
 *   <li>{@link #aDraftIsNotABacker()} — the one place this definition deliberately differs from
 *       V17's active set, and the difference matters: telling somebody who abandoned a checkout
 *       that the campaign succeeded implies their card is about to be charged.
 *   <li>{@link #aCreatorWhoBackedTheirOwnCampaignIsToldOnce()} — the deduplication is
 *       load-bearing. Without it the second insert violates
 *       {@code notifications_event_recipient_channel_key}, which rolls back a dispatch every
 *       other consumer of the event shares, for ever, because no redelivery changes the audience.
 *   <li>{@link #anAudienceOverTheBoundIsTruncatedAndTheCreatorSurvives()} — the bound exists, and
 *       what it cuts is not the one recipient certain to want the message.
 * </ul>
 */
class NotificationAudienceTests extends AbstractIntegrationTest {

    /** Distinguishes the accounts these tests create. See {@code ReferralAttributionTests}. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String AGGREGATE = "project";

    /** §4.10 gives {@code GOAL_REACHED} email, push and in-app. */
    private static final int GOAL_REACHED_CHANNELS = 3;

    @Autowired
    private ProjectAudiences audiences;

    @Autowired
    private AudienceProperties properties;

    @Autowired
    private Outbox outbox;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;
    private UUID projectId;

    @BeforeEach
    void aLiveCampaign() {
        handle = "audience-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);
        projectId = Campaigns.seed(dataSource, creatorId, handle).state("LIVE").insert();
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM pledges WHERE project_id = ?", projectId);
        jdbc.update("DELETE FROM project_state_transitions WHERE project_id = ?", projectId);
        jdbc.update("DELETE FROM projects WHERE id = ?", projectId);
    }

    // ------------------------------------------------------------------
    // The feature
    // ------------------------------------------------------------------

    @Test
    @DisplayName("goal reached tells the creator and every backer")
    void goalReachedTellsTheCreatorAndTheBackers() {
        UUID first = backer("COLLECTED");
        UUID second = backer("FULFILLED");

        goalReached();

        assertThat(recipients())
                .as("#245: the creator, and the people who funded it")
                .containsExactlyInAnyOrder(creatorId, first, second);
        assertThat(rowCount())
                .as("three recipients, and §4.10 gives this type three channels")
                .isEqualTo(3 * GOAL_REACHED_CHANNELS);
    }

    /**
     * The distinction between "backed this campaign" and V17's "active pledge".
     *
     * <p>A draft is active — it holds a place on a limited tier, which is what V17's unique index
     * is for — and is not a backer. {@code PledgeProjectAudiences} argues it: somebody who opened
     * a checkout and did not finish has not committed anything, and a "campaign succeeded"
     * notification would tell them their card is about to be charged.
     */
    @Test
    @DisplayName("a draft is not a backer")
    void aDraftIsNotABacker() {
        UUID confirmed = backer("COLLECTED");
        UUID drafting = draftingBacker();

        goalReached();

        assertThat(recipients()).containsExactlyInAnyOrder(creatorId, confirmed);
        assertThat(recipients()).doesNotContain(drafting);
    }

    /** Every state in which the commitment has ended, in one pass over V17's vocabulary. */
    @Test
    @DisplayName("a pledge whose commitment has ended is not a backer")
    void anEndedPledgeIsNotABacker() {
        List<UUID> gone = List.of(
                backer("EXPIRED"),
                backer("CANCELED_BY_BACKER"),
                backer("CANCELED_BY_PROJECT"),
                backer("REFUNDED"),
                backer("CHARGEBACK"));

        goalReached();

        assertThat(recipients())
                .as("only the creator: nobody else is still backing this campaign")
                .containsExactly(creatorId);
        assertThat(recipients()).doesNotContainAnyElementsOf(gone);
    }

    /** And the states after payment that are, so the set is asserted from both sides. */
    @Test
    @DisplayName("a paid pledge is a backer, whatever stage it has reached")
    void aPaidPledgeIsABacker() {
        UUID collected = backer("COLLECTED");
        UUID fulfilled = backer("FULFILLED");

        goalReached();

        assertThat(recipients()).containsExactlyInAnyOrder(creatorId, collected, fulfilled);
    }

    /**
     * The deduplication that stops a dispatch rolling back for ever.
     *
     * <p>{@code notifications_event_recipient_channel_key} is unique on (event, recipient,
     * channel). Without the {@code LinkedHashSet} in the translation, this test would not merely
     * produce a duplicate row — it would fail the whole dispatch, take every other consumer's
     * writes with it, and do the same on all eight redeliveries.
     */
    @Test
    @DisplayName("a creator who backed their own campaign is told once")
    void aCreatorWhoBackedTheirOwnCampaignIsToldOnce() {
        pledge(creatorId, "COLLECTED");

        goalReached();

        assertThat(recipients()).containsExactly(creatorId);
        assertThat(rowCount()).as("one recipient, three channels — not six").isEqualTo(GOAL_REACHED_CHANNELS);
    }

    // ------------------------------------------------------------------
    // The bound
    // ------------------------------------------------------------------

    /**
     * The bound is real, and it cuts backers rather than the creator.
     *
     * <p>Observable only because the test profile sets {@code max-recipients} to three. What this
     * asserts is the shape of the truncation, not the number:
     * {@code NotificationProperties.Audience} argues the number, and the {@code ERROR} the
     * listener logs is what stops it being silent.
     */
    @Test
    @DisplayName("an audience over the bound is truncated, and the creator survives it")
    void anAudienceOverTheBoundIsTruncatedAndTheCreatorSurvives() {
        int ceiling = properties.maxRecipients();
        for (int backer = 0; backer < ceiling + 2; backer++) {
            backer("COLLECTED");
        }

        goalReached();

        assertThat(recipients())
                .as("the creator plus the first %s backers, and no more", ceiling)
                .hasSize(ceiling + 1)
                .contains(creatorId);
    }

    // ------------------------------------------------------------------
    // The port itself
    // ------------------------------------------------------------------

    /**
     * A stable order, which is what makes a truncated audience a repeatable one.
     *
     * <p>An event is redelivered — {@code OutboxMessage}'s contract is at-least-once — and a port
     * that returned a different subset each time would tell a different set of people on each
     * attempt. It does not matter here, because the fan-out is idempotent on the event, and it
     * would matter enormously the day it is chunked.
     *
     * <p><strong>Stable, and deliberately not asserted to be ascending.</strong> PostgreSQL orders
     * a {@code uuid} by its bytes and {@code UUID.compareTo} orders it as two signed longs, so the
     * two disagree on about half of all pairs. Which order it is does not matter to anything;
     * that it is the same order twice is the whole requirement, and an assertion on Java's
     * ordering would be an assertion about the storage engine.
     */
    @Test
    @DisplayName("the audience port answers in a stable order, bounded, distinct")
    void thePortAnswersInAStableOrder() {
        backer("COLLECTED");
        backer("COLLECTED");
        backer("COLLECTED");

        List<UUID> once = audiences.membersOf(projectId, ProjectAudience.BACKERS, 2);
        List<UUID> again = audiences.membersOf(projectId, ProjectAudience.BACKERS, 2);

        assertThat(once).hasSize(2).doesNotHaveDuplicates().isEqualTo(again);
    }

    /**
     * A campaign that does not exist is an empty audience rather than a failure.
     *
     * <p>The interface says so and the reason is {@code NotificationFanOut}'s: the caller is
     * consuming an event other modules also consume, so it must not be able to fail their
     * dispatch over a campaign that has since been removed.
     */
    @Test
    @DisplayName("a campaign with nothing behind it has an empty audience, not an error")
    void anUnknownCampaignHasAnEmptyAudience() {
        assertThat(audiences.membersOf(UUID.randomUUID(), ProjectAudience.BACKERS, 10))
                .isEmpty();
        assertThat(audiences.membersOf(null, ProjectAudience.BACKERS, 10)).isEmpty();
    }

    @Test
    @DisplayName("an audience of nobody is a caller bug, not an instruction")
    void aLimitOfZeroIsRefused() {
        assertThatThrownBy(() -> audiences.membersOf(projectId, ProjectAudience.BACKERS, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A new account with a pledge to this campaign in the given state. */
    private UUID backer(String state) {
        UUID backerId = Campaigns.creator(dataSource, handle + "-b" + SEQUENCE.incrementAndGet());
        pledge(backerId, state);
        return backerId;
    }

    /**
     * A new account holding a place at a checkout it has not finished.
     *
     * <p>{@code pledges_drafts_are_time_bounded} insists a draft says when it lapses, so this is
     * the one state that needs the extra column.
     */
    private UUID draftingBacker() {
        UUID backerId = Campaigns.creator(dataSource, handle + "-d" + SEQUENCE.incrementAndGet());
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, reservation_expires_at)
                        VALUES (?, ?, ?, 'DRAFT', 25.00, now() + interval '1 hour')
                        """,
                        Identifiers.newIdentifier(),
                        projectId,
                        backerId);
        return backerId;
    }

    private void pledge(UUID backerId, String state) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount)
                        VALUES (?, ?, ?, ?, 25.00)
                        """,
                        Identifiers.newIdentifier(),
                        projectId,
                        backerId,
                        state);
    }

    /** Records a {@code project.goal_reached} and fans it out. */
    private void goalReached() {
        GoalReached event = new GoalReached(
                projectId,
                creatorId,
                Money.of(new BigDecimal("1000.00"), "AZN"),
                Instant.now().truncatedTo(ChronoUnit.MICROS));
        new TransactionTemplate(transactions)
                .executeWithoutResult(status ->
                        outbox.record(AGGREGATE, projectId, GoalReached.EVENT_TYPE, event));
        relay.run();
    }

    /** Who the fan-out decided to tell, distinctly. */
    private List<UUID> recipients() {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT DISTINCT recipient_id FROM notifications WHERE type = 'GOAL_REACHED'", UUID.class);
    }

    private long rowCount() {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM notifications WHERE type = 'GOAL_REACHED'", Long.class);
    }
}
