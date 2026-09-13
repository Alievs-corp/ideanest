package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.application.ProjectTransitionService;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.time.Duration;
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

/**
 * Who is told when a campaign is extended — IDN-EXT-01 (#34), §5.1.
 *
 * <p><strong>Every backer, and not the creator.</strong> §5.1 says a backer "receives only a
 * notification of the new deadline": told, not asked. The creator is the person who extended it,
 * and a message to them about their own decision is noise — including when they also backed their
 * own campaign, which is the case a plain "backers" audience would get wrong.
 */
class CampaignExtendedNotificationTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** EMAIL, PUSH and IN_APP, as {@code NotificationType.CAMPAIGN_EXTENDED} declares. */
    private static final int CHANNELS = 3;

    @Autowired
    private ProjectTransitionService transitions;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;

    @BeforeEach
    void aCreator() {
        handle = "extended-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM pledges WHERE project_id IN (SELECT id FROM projects WHERE creator_id = ?)", creatorId);
        jdbc.update(
                "DELETE FROM project_state_transitions WHERE project_id IN"
                        + " (SELECT id FROM projects WHERE creator_id = ?)",
                creatorId);
        jdbc.update("DELETE FROM projects WHERE creator_id = ?", creatorId);
    }

    @Test
    @DisplayName("every backer is told the new deadline, on every channel, and the creator is not")
    void everyBackerIsToldAndTheCreatorIsNot() {
        Instant deadline = now().plus(Duration.ofDays(3));
        UUID projectId = live(deadline);
        UUID first = backer(projectId);
        UUID second = backer(projectId);

        transitions.extend(projectId, creatorId, deadline.plus(Duration.ofDays(21)));
        relay.run();

        assertThat(recipients()).containsExactlyInAnyOrder(first, second);
        assertThat(rowCount()).isEqualTo(2L * CHANNELS);
    }

    @Test
    @DisplayName("a creator who backed their own campaign is still not told about their own extension")
    void aCreatorWhoBackedIsNotTold() {
        Instant deadline = now().plus(Duration.ofDays(2));
        UUID projectId = live(deadline);
        UUID backer = backer(projectId);
        pledge(projectId, creatorId);

        transitions.extend(projectId, creatorId, deadline.plus(Duration.ofDays(14)));
        relay.run();

        assertThat(recipients()).containsExactly(backer);
    }

    @Test
    @DisplayName("the message carries the new deadline and the first one")
    void theMessageCarriesTheDates() {
        Instant deadline = now().plus(Duration.ofDays(4));
        UUID projectId = live(deadline);
        backer(projectId);
        Instant until = deadline.plus(Duration.ofDays(30));

        transitions.extend(projectId, creatorId, until);
        relay.run();

        String params = new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT params::text FROM notifications WHERE type = 'CAMPAIGN_EXTENDED' LIMIT 1", String.class);
        assertThat(params).contains("extendedUntil").contains("deadline");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    /** A live campaign above half its goal, inside seven days of its deadline, so it may be extended. */
    private UUID live(Instant deadline) {
        return Campaigns.seed(dataSource, creatorId, handle + "-" + SEQUENCE.incrementAndGet())
                .state("LIVE")
                .goal("10000.00")
                .pledged("6000.00")
                .backers(2)
                .launchedAt(deadline.minus(Duration.ofDays(30)))
                .deadline(deadline)
                .insert();
    }

    private UUID backer(UUID projectId) {
        UUID backerId = Campaigns.creator(dataSource, handle + "-b" + SEQUENCE.incrementAndGet());
        pledge(projectId, backerId);
        return backerId;
    }

    private void pledge(UUID projectId, UUID backerId) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount)
                        VALUES (?, ?, ?, 'CONFIRMED', 25.00)
                        """,
                        Identifiers.newIdentifier(),
                        projectId,
                        backerId);
    }

    private List<UUID> recipients() {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT DISTINCT recipient_id FROM notifications WHERE type = 'CAMPAIGN_EXTENDED'", UUID.class);
    }

    private long rowCount() {
        Long count = new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM notifications WHERE type = 'CAMPAIGN_EXTENDED'", Long.class);
        return count == null ? 0 : count;
    }
}
