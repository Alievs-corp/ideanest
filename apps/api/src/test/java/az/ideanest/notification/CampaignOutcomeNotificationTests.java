package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.application.CampaignFinalizerJob;
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
 * A campaign closes, and everybody who is owed a message gets one.
 *
 * <p>The whole path, end to end and with no fixture standing in for any part of it: the
 * deadline passes, {@code campaign-finalizer} applies §5.1, the outbox event it records is
 * relayed, the notification module recognises the event type, resolves the audience
 * through {@code shared.audience}, and writes a row per recipient per channel.
 *
 * <p><strong>Driven this way deliberately.</strong> Recording the event by hand — which is
 * what {@code NotificationAudienceTests} does, correctly, because its subject is the
 * audience port — would leave the one thing #63 and #85 could still get wrong untested:
 * that the producer writes the event type the consumer switches on. Nothing in either
 * module fails to compile when those two strings disagree, and the symptom is a campaign
 * that closes and tells nobody.
 */
class CampaignOutcomeNotificationTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** §4.10 gives both campaign outcomes email, push and in-app. */
    private static final int OUTCOME_CHANNELS = 3;

    private static final Duration CAMPAIGN_LENGTH = Duration.ofDays(30);

    @Autowired
    private CampaignFinalizerJob finalizer;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;

    @BeforeEach
    void aCreator() {
        handle = "outcome-" + SEQUENCE.incrementAndGet();
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
    @DisplayName("a campaign that funds tells the creator and every backer")
    void aFundedCampaignTellsEverybody() {
        UUID projectId = closed("10000.00", "12500.00", 2);
        UUID first = backer(projectId);
        UUID second = backer(projectId);

        close();

        assertThat(recipients("CAMPAIGN_SUCCEEDED")).containsExactlyInAnyOrder(creatorId, first, second);
        assertThat(rowCount("CAMPAIGN_SUCCEEDED")).isEqualTo(3 * OUTCOME_CHANNELS);
        assertThat(recipients("CAMPAIGN_UNSUCCESSFUL")).isEmpty();
    }

    /**
     * The backers of a failed campaign are told too, and it is not politeness.
     *
     * <p>They are holding a commitment that will never be charged and a stored card §5.1
     * has the platform delete within thirty days. Somebody who is not told waits for a
     * charge that never comes.
     */
    @Test
    @DisplayName("a campaign that does not fund tells the creator and every backer")
    void anUnsuccessfulCampaignTellsEverybody() {
        UUID projectId = closed("10000.00", "400.00", 1);
        UUID backer = backer(projectId);

        close();

        assertThat(recipients("CAMPAIGN_UNSUCCESSFUL")).containsExactlyInAnyOrder(creatorId, backer);
        assertThat(recipients("CAMPAIGN_SUCCEEDED")).isEmpty();
    }

    /**
     * The message can say what the campaign raised, and it says the frozen number.
     *
     * <p>The rendering document is what a template reads, so an absent {@code pledged}
     * would make "you raised 7,400 ₼ of your 10,000 ₼ goal" unwritable — the sentence a
     * creator whose campaign failed most needs to see. Money as §10.3's object with a
     * string amount, all the way into {@code notifications.params}.
     */
    @Test
    @DisplayName("the notification carries the frozen numbers, as money")
    void theNotificationCarriesTheOutcome() {
        // 74%: below IDN-EXT-01's eighty (#31). This row was 8,400 under all-or-nothing, which
        // now succeeds and would announce CAMPAIGN_SUCCEEDED instead.
        closed("10000.00", "7400.00", 21);

        close();

        assertThat(paramsOf("CAMPAIGN_UNSUCCESSFUL"))
                .contains("\"amount\": \"7400.00\"")
                .contains("\"amount\": \"10000.00\"")
                .contains("\"backersCount\": 21");
    }

    /**
     * The message can say which campaign it is about — #249.
     *
     * <p>Before the port existed, every notification the platform sent called it "this
     * campaign", because the event carries identifiers and money and no title. What is
     * asserted here is the whole chain: the listener asked {@code ProjectSummaries}, the
     * project module answered from its own table, and the answer reached
     * {@code notifications.params} — where a template can read it.
     *
     * <p>Both slugs too, and they matter more than they look. §10.2's campaign page is
     * {@code /projects/{creatorSlug}/{projectSlug}}, so an email whose button was built from
     * the identifier pointed at no route at all.
     */
    @Test
    @DisplayName("the notification names the campaign and carries its public path")
    void theNotificationNamesTheCampaign() {
        String projectSlug = named("Xari Bulbul Ceramics");

        close();

        assertThat(paramsOf("CAMPAIGN_SUCCEEDED"))
                .contains("\"projectTitle\": \"Xari Bulbul Ceramics\"")
                .contains("\"creatorSlug\": \"" + handle + "\"")
                .contains("\"projectSlug\": \"" + projectSlug + "\"");
    }

    /**
     * The title stored is the title as it was, not as it is.
     *
     * <p>The reason {@code ProjectSummaries} is asked at translation time rather than at send
     * time, asserted rather than only argued: a campaign renamed after it closed does not
     * rewrite the message that went out about it closing. A reader who is told "Xari Bulbul
     * Ceramics was funded" and later sees the campaign under another name has a record of
     * what they were told; the other way round, the record silently changes.
     */
    @Test
    @DisplayName("a campaign renamed after the event does not rewrite the message about it")
    void theStoredTitleIsTheTitleAsItWas() {
        named("Xari Bulbul Ceramics");

        close();
        new JdbcTemplate(dataSource)
                .update("UPDATE projects SET title = ? WHERE creator_id = ?", "Something Else", creatorId);

        assertThat(paramsOf("CAMPAIGN_SUCCEEDED"))
                .contains("\"projectTitle\": \"Xari Bulbul Ceramics\"")
                .doesNotContain("Something Else");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A closed, funded campaign with a title worth printing. Answers its slug. */
    private String named(String title) {
        // Past the first deadline and its seven-day window, so one pass decides (#33).
        Instant deadline = Instant.now().minus(Duration.ofDays(8));
        String projectSlug = handle + "-" + SEQUENCE.incrementAndGet();

        Campaigns.seed(dataSource, creatorId, projectSlug)
                .state("LIVE")
                .title(title)
                .goal("10000.00")
                .pledged("12500.00")
                .backers(1)
                .launchedAt(deadline.minus(CAMPAIGN_LENGTH))
                .deadline(deadline)
                .insert();

        return projectSlug;
    }

    /** The rendering document of one notification of this type, as PostgreSQL prints it. */
    private String paramsOf(String type) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT params::text FROM notifications WHERE type = ? LIMIT 1", String.class, type);
    }

    /** Closes every campaign past its deadline and delivers what that produced. */
    private void close() {
        finalizer.finaliseClosedCampaigns(Instant.now().truncatedTo(ChronoUnit.MICROS));
        relay.run();
    }

    private UUID closed(String goal, String pledged, int backers) {
        // Past the first deadline and its seven-day window, so one pass decides (#33).
        Instant deadline = Instant.now().minus(Duration.ofDays(8));
        return Campaigns.seed(dataSource, creatorId, handle + "-" + SEQUENCE.incrementAndGet())
                .state("LIVE")
                .goal(goal)
                .pledged(pledged)
                .backers(backers)
                .launchedAt(deadline.minus(CAMPAIGN_LENGTH))
                .deadline(deadline)
                .insert();
    }

    /** A new account with a live commitment to this campaign. */
    private UUID backer(UUID projectId) {
        UUID backerId = Campaigns.creator(dataSource, handle + "-b" + SEQUENCE.incrementAndGet());
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount)
                        VALUES (?, ?, ?, 'CONFIRMED', 25.00)
                        """,
                        Identifiers.newIdentifier(),
                        projectId,
                        backerId);
        return backerId;
    }

    private List<UUID> recipients(String type) {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT DISTINCT recipient_id FROM notifications WHERE type = ?", UUID.class, type);
    }

    private long rowCount(String type) {
        Long count = new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM notifications WHERE type = ?", Long.class, type);
        return count == null ? 0 : count;
    }
}
