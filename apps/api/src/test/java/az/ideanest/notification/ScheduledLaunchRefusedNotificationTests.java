package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.application.CampaignLauncherJob;
import az.ideanest.project.application.ScheduledLaunchRefusedEvent;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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
 * A scheduled launch the creator's plan does not cover — #587.
 *
 * <p>The sweep refuses to open the campaign and clears its launch time, so nothing will open it on
 * its own again. Before this, that reached a log line and nobody else: the campaign silently missed
 * the date its creator had announced. Now the refusal is an audit row under the system actor and a
 * message to the creator, and only to the creator.
 */
class ScheduledLaunchRefusedNotificationTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** EMAIL, PUSH and IN_APP, as {@code NotificationType.SCHEDULED_LAUNCH_REFUSED} declares. */
    private static final int CHANNELS = 3;

    @Autowired
    private CampaignLauncherJob job;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;

    @BeforeEach
    void aCreatorWithNoPlan() {
        handle = "launch-refused-" + SEQUENCE.incrementAndGet();
        // No subscription: the plan lapsed while the launch time waited.
        creatorId = Campaigns.creator(dataSource, handle);
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM follows WHERE creator_id = ?", creatorId);
        jdbc.update(
                "DELETE FROM project_state_transitions WHERE project_id IN"
                        + " (SELECT id FROM projects WHERE creator_id = ?)",
                creatorId);
        jdbc.update("DELETE FROM projects WHERE creator_id = ?", creatorId);
    }

    @Test
    @DisplayName("the campaign stays approved, its launch time is cleared, and the refusal is audited as the system")
    void theRefusalIsAudited() {
        Instant at = now().minus(Duration.ofMinutes(5));
        UUID projectId = approved(at);

        assertThat(job.launchDueCampaigns(now())).isZero();

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        assertThat(jdbc.queryForObject("SELECT state FROM projects WHERE id = ?", String.class, projectId))
                .isEqualTo("APPROVED");
        assertThat(jdbc.queryForObject("SELECT scheduled_launch_at FROM projects WHERE id = ?", Object.class, projectId))
                .isNull();

        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT actor_type, actor_id, outcome, detail FROM audit_logs"
                        + " WHERE action = 'project.scheduled_launch_refused' AND entity_id = ?",
                projectId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst())
                .containsEntry("actor_type", "SYSTEM")
                .containsEntry("outcome", "REFUSED");
        assertThat(rows.getFirst().get("actor_id")).isNull();
        // Why, in the words of the refusal the creator's own launch would get.
        assertThat((String) rows.getFirst().get("detail")).contains("subscription");
    }

    @Test
    @DisplayName("the creator is told, on every channel, and nobody else is")
    void theCreatorIsTold() {
        UUID projectId = approved(now().minus(Duration.ofMinutes(1)));
        // Somebody following the creator: the launch announcement would reach them, this does not.
        UUID follower = Campaigns.creator(dataSource, handle + "-f");
        new JdbcTemplate(dataSource)
                .update(
                        "INSERT INTO follows (id, creator_id, follower_id) VALUES (?, ?, ?)",
                        Identifiers.newIdentifier(),
                        creatorId,
                        follower);

        job.launchDueCampaigns(now());
        relay.run();

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        assertThat(jdbc.queryForList(
                        "SELECT DISTINCT recipient_id FROM notifications WHERE type = 'SCHEDULED_LAUNCH_REFUSED'",
                        UUID.class))
                .containsExactly(creatorId);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM notifications WHERE type = 'SCHEDULED_LAUNCH_REFUSED'", Long.class))
                .isEqualTo((long) CHANNELS);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM notifications WHERE recipient_id = ?", Long.class, follower))
                .isZero();
        // The campaign's name and page are in the document, so the copy can name it.
        assertThat(jdbc.queryForObject(
                        "SELECT params::text FROM notifications WHERE type = 'SCHEDULED_LAUNCH_REFUSED' LIMIT 1",
                        String.class))
                .contains(projectId.toString())
                .contains("projectTitle")
                .contains("scheduledFor");
    }

    @Test
    @DisplayName("a second pass neither refuses nor tells anybody again")
    void aSecondPassIsQuiet() {
        UUID projectId = approved(now().minus(Duration.ofMinutes(1)));

        job.launchDueCampaigns(now());
        job.launchDueCampaigns(now().plus(Duration.ofMinutes(1)));

        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT count(*) FROM outbox_events WHERE aggregate_id = ? AND event_type = ?",
                                Long.class,
                                projectId,
                                ScheduledLaunchRefusedEvent.EVENT_TYPE))
                .isEqualTo(1L);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    /** An approved campaign with a goal, a duration and a launch time: everything the sweep needs but a plan. */
    private UUID approved(Instant scheduledLaunchAt) {
        UUID projectId = Campaigns.seed(dataSource, creatorId, handle + "-" + SEQUENCE.incrementAndGet())
                .state("APPROVED")
                .goal("5000.00")
                .insert();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("UPDATE projects SET duration_days = 30 WHERE id = ?", projectId);
        jdbc.update(
                "UPDATE projects SET scheduled_launch_at = ? WHERE id = ?",
                OffsetDateTime.ofInstant(scheduledLaunchAt, ZoneOffset.UTC),
                projectId);
        return projectId;
    }
}
