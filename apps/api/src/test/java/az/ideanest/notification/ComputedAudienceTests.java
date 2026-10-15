package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.notification.application.NotificationEvents.CampaignEndingSoon;
import az.ideanest.notification.application.NotificationEvents.ProjectLaunched;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.audience.ProjectAudience;
import az.ideanest.shared.audience.ProjectAudiences;
import az.ideanest.shared.outbox.Outbox;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
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
 * The half of #245 that #90 unblocked: audiences whose rows are the community module's.
 *
 * <p>{@code NotificationAudienceTests} covers {@code BACKERS} and the shape of the port. This
 * one covers what could not be written until {@code saves} and {@code follows} existed —
 * §4.10's "followed creator launched" and "saved project ending soon", which had copy, channels
 * and a preference category and no audience at all.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aLaunchReachesTheCreatorsFollowersAndNotTheCreator()} — the audience is somebody
 *       else's followers reached through a campaign, which is the one place the port's
 *       project-shaped key is a join rather than a lookup.
 *   <li>{@link #aSaverWhoAlreadyBackedTheCampaignIsNotInvited()} — the subtraction that makes
 *       "saved project ending soon" a different message from "48 hours remaining" rather than a
 *       second copy of it.
 *   <li>{@link #theTwentyFourHourThresholdDoesNotChaseSavers()} — a saver is invited once, not
 *       chased.
 *   <li>{@link #everyAudienceHasExactlyOneAnswerer()} — the property that turns
 *       {@code ProjectAudience}'s standing rule into something the application checks.
 * </ul>
 */
class ComputedAudienceTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String AGGREGATE = "project";

    @Autowired
    private ProjectAudiences audiences;

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
        handle = "computed-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);
        projectId = Campaigns.seed(dataSource, creatorId, handle).state("LIVE").insert();
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM saves WHERE project_id = ?", projectId);
        jdbc.update("DELETE FROM follows WHERE creator_id = ?", creatorId);
        jdbc.update("DELETE FROM pledges WHERE project_id = ?", projectId);
        jdbc.update("DELETE FROM deadline_notices WHERE project_id = ?", projectId);
        jdbc.update("DELETE FROM project_state_transitions WHERE project_id = ?", projectId);
        jdbc.update("DELETE FROM projects WHERE id = ?", projectId);
    }

    // ------------------------------------------------------------------
    // FOLLOWERS
    // ------------------------------------------------------------------

    /**
     * The audience is the creator's followers, reached through the campaign.
     *
     * <p>And the creator is not in it, unlike {@code GoalReached}'s audience: they pressed the
     * button. {@code follows_is_not_self} means they cannot be in it by accident either.
     */
    @Test
    @DisplayName("a launch reaches the creator's followers, and not the creator")
    void aLaunchReachesTheCreatorsFollowersAndNotTheCreator() {
        UUID first = follower();
        UUID second = follower();

        launched();

        assertThat(recipients("FOLLOWED_CREATOR_LAUNCHED")).containsExactlyInAnyOrder(first, second);
        assertThat(recipients("FOLLOWED_CREATOR_LAUNCHED"))
                .as("the creator pressed the button")
                .doesNotContain(creatorId);
    }

    @Test
    @DisplayName("a creator nobody follows launches quietly")
    void aCreatorNobodyFollowsLaunchesQuietly() {
        launched();

        assertThat(recipients("FOLLOWED_CREATOR_LAUNCHED")).isEmpty();
    }

    @Test
    @DisplayName("somebody who unfollowed before the launch is not told")
    void anUnfollowerIsNotTold() {
        UUID left = follower();
        new JdbcTemplate(dataSource).update("DELETE FROM follows WHERE follower_id = ?", left);

        launched();

        assertThat(recipients("FOLLOWED_CREATOR_LAUNCHED")).isEmpty();
    }

    // ------------------------------------------------------------------
    // SAVERS, and the subtraction
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the 48-hour threshold tells the creator and the backers, and invites the savers")
    void theFortyEightHourThresholdTellsBothGroups() {
        UUID backer = backer();
        UUID saver = saver();

        endingSoon(48);

        assertThat(recipients("DEADLINE_48H")).containsExactlyInAnyOrder(creatorId, backer);
        assertThat(recipients("SAVED_PROJECT_ENDING_SOON")).containsExactly(saver);
    }

    /**
     * The subtraction, which is about what the messages mean rather than about efficiency.
     *
     * <p>"Saved project ending soon" is an invitation. Sending it to somebody who has already
     * pledged reads as though their pledge had not been noticed — and they are receiving the
     * backer's message about the same campaign in the same dispatch.
     */
    @Test
    @DisplayName("a saver who already backed the campaign gets the backer's message and not the invitation")
    void aSaverWhoAlreadyBackedTheCampaignIsNotInvited() {
        UUID both = backer();
        saved(both);

        endingSoon(48);

        assertThat(recipients("DEADLINE_48H")).containsExactlyInAnyOrder(creatorId, both);
        assertThat(recipients("SAVED_PROJECT_ENDING_SOON"))
                .as("already committed: this message is not theirs")
                .isEmpty();
    }

    @Test
    @DisplayName("a creator who saved their own campaign is not invited to back it")
    void aCreatorWhoSavedTheirOwnCampaignIsNotInvited() {
        saved(creatorId);

        endingSoon(48);

        assertThat(recipients("SAVED_PROJECT_ENDING_SOON")).isEmpty();
        assertThat(recipients("DEADLINE_48H")).containsExactly(creatorId);
    }

    /** §4.10 gives a saver one row, not two. */
    @Test
    @DisplayName("the 24-hour threshold does not chase savers")
    void theTwentyFourHourThresholdDoesNotChaseSavers() {
        UUID backer = backer();
        saver();

        endingSoon(24);

        assertThat(recipients("DEADLINE_24H")).containsExactlyInAnyOrder(creatorId, backer);
        assertThat(recipients("SAVED_PROJECT_ENDING_SOON")).isEmpty();
    }

    /**
     * §4.10 gives "24 hours remaining" no email column, and the fan-out honours the table.
     *
     * <p>Asserted here rather than in {@code DeliveryPolicyTests} because it is the one place
     * the two deadline rows differ, and the difference is the reason they are two
     * {@code NotificationType}s rather than one type carrying a number.
     */
    @Test
    @DisplayName("the 24-hour message has no email channel and the 48-hour one does")
    void theTwoThresholdsDifferInTheirChannels() {
        backer();

        endingSoon(24);

        assertThat(channels("DEADLINE_24H")).doesNotContain("EMAIL").contains("PUSH", "IN_APP");
    }

    // ------------------------------------------------------------------
    // The port
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the savers audience is stable, bounded and distinct")
    void theSaversAudienceIsStable() {
        saver();
        saver();
        saver();

        List<UUID> once = audiences.membersOf(projectId, ProjectAudience.SAVERS, 2);
        List<UUID> again = audiences.membersOf(projectId, ProjectAudience.SAVERS, 2);

        assertThat(once).hasSize(2).doesNotHaveDuplicates().isEqualTo(again);
    }

    @Test
    @DisplayName("a campaign that does not exist has empty computed audiences, not an error")
    void anUnknownCampaignHasEmptyAudiences() {
        assertThat(audiences.membersOf(UUID.randomUUID(), ProjectAudience.SAVERS, 10)).isEmpty();
        assertThat(audiences.membersOf(UUID.randomUUID(), ProjectAudience.FOLLOWERS, 10)).isEmpty();
    }

    /**
     * Every constant is answered, by exactly one module.
     *
     * <p>{@code RoutedProjectAudiences} refuses to start otherwise, so in one sense this test
     * cannot fail without the whole context failing first — which is the point. What it asserts
     * is that the router really is wired to every constant rather than merely to the ones a
     * test happened to exercise, so adding a constant with no implementation is caught here and
     * named, rather than surfacing as an unexplained context failure in an unrelated suite.
     */
    @Test
    @DisplayName("every audience the vocabulary names has exactly one answerer")
    void everyAudienceHasExactlyOneAnswerer() {
        for (ProjectAudience audience : ProjectAudience.values()) {
            assertThat(audiences.membersOf(projectId, audience, 1))
                    .as("%s is answered rather than refused", audience)
                    .isNotNull();
        }
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A new account following this campaign's creator. */
    private UUID follower() {
        UUID followerId = Campaigns.creator(dataSource, handle + "-f" + SEQUENCE.incrementAndGet());
        new JdbcTemplate(dataSource)
                .update(
                        "INSERT INTO follows (id, creator_id, follower_id) VALUES (?, ?, ?)",
                        Identifiers.newIdentifier(),
                        creatorId,
                        followerId);
        return followerId;
    }

    /** A new account that saved this campaign and has not backed it. */
    private UUID saver() {
        UUID saverId = Campaigns.creator(dataSource, handle + "-s" + SEQUENCE.incrementAndGet());
        saved(saverId);
        return saverId;
    }

    private void saved(UUID accountId) {
        new JdbcTemplate(dataSource)
                .update(
                        "INSERT INTO saves (id, project_id, user_id) VALUES (?, ?, ?)",
                        Identifiers.newIdentifier(),
                        projectId,
                        accountId);
    }

    /** A new account with a live commitment to this campaign. */
    private UUID backer() {
        UUID backerId = Campaigns.creator(dataSource, handle + "-b" + SEQUENCE.incrementAndGet());
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount)
                        VALUES (?, ?, ?, 'COLLECTED', 25.00)
                        """,
                        Identifiers.newIdentifier(),
                        projectId,
                        backerId);
        return backerId;
    }

    private void launched() {
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        record(ProjectLaunched.EVENT_TYPE, new ProjectLaunched(projectId, creatorId, now, now.plus(30, ChronoUnit.DAYS)));
    }

    private void endingSoon(int hoursRemaining) {
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        record(
                CampaignEndingSoon.EVENT_TYPE,
                new CampaignEndingSoon(
                        projectId, creatorId, hoursRemaining, now.plus(hoursRemaining, ChronoUnit.HOURS), now));
    }

    private void record(String eventType, Object payload) {
        new TransactionTemplate(transactions)
                .executeWithoutResult(status -> outbox.record(AGGREGATE, projectId, eventType, payload));
        relay.run();
    }

    private List<UUID> recipients(String type) {
        return new JdbcTemplate(dataSource)
                .queryForList("SELECT DISTINCT recipient_id FROM notifications WHERE type = ?", UUID.class, type);
    }

    private List<String> channels(String type) {
        return new JdbcTemplate(dataSource)
                .queryForList("SELECT DISTINCT channel FROM notifications WHERE type = ?", String.class, type);
    }
}
