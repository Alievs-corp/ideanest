package az.ideanest.pledgemanager;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.pledgemanager.application.SurveyNudgeJob;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.Campaigns;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * §4.8's PM-24 and §8.4's {@code survey-nudge} (#74): chasing the backers who have not
 * answered.
 *
 * <p>Driven directly rather than by a timer — {@code application-test.yml} sets the
 * schedule to {@code -} for the reason every schedule in that file is disabled: a sweep
 * firing in the background would chase the non-responders of a survey a test is in the
 * middle of asserting has had no reminders.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aNonResponderIsChasedOnceAndNotAgainTheNextDay()} — the row is the
 *       claim. Without it the sweep's question stays true and every pass is another
 *       email.
 *   <li>{@link #somebodyWhoAnsweredIsNotChased()} — the whole point.
 *   <li>{@link #remindersStopAtTheConfiguredNumber()} — the difference between a
 *       reminder and a campaign of its own.
 *   <li>{@link #aClosedSurveyIsNotChased()} — chasing somebody about a form that would
 *       refuse them is worse than saying nothing.
 * </ul>
 */
class SurveyNudgeTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** {@code PledgeManagerProperties.Surveys} defaults to seven days between reminders. */
    private static final Duration PAST_THE_INTERVAL = Duration.ofDays(8);

    @Autowired
    private SurveyNudgeJob job;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        clock.reset();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM survey_answers");
        jdbc.update("DELETE FROM survey_responses");
        jdbc.update("DELETE FROM survey_nudges");
        jdbc.update("DELETE FROM survey_questions");
        jdbc.update("DELETE FROM surveys");
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    @Test
    @DisplayName("a non-responder is chased once, and not again the next day")
    void aNonResponderIsChasedOnceAndNotAgainTheNextDay() {
        UUID project = liveCampaign();
        UUID pledge = backer(project);
        UUID survey = sentSurvey(project);

        clock.advance(PAST_THE_INTERVAL);
        assertThat(job.chaseNonResponders()).isEqualTo(1);

        // The claim is the row, written in the same transaction as the event.
        assertThat(nudgeCount(survey, pledge)).isEqualTo(1);

        clock.advance(Duration.ofDays(1));
        assertThat(job.chaseNonResponders())
                .as("the interval is measured from the last contact, not from the send")
                .isZero();
        assertThat(nudgeCount(survey, pledge)).isEqualTo(1);
    }

    @Test
    @DisplayName("a reminder becomes a SURVEY_OVERDUE notification for that backer alone")
    void aReminderReachesOnlyTheBackerItNames() {
        UUID project = liveCampaign();
        UUID answered = backer(project);
        UUID pending = backer(project);
        UUID survey = sentSurvey(project);
        answer(survey, answered);

        clock.advance(PAST_THE_INTERVAL);
        job.chaseNonResponders();
        relay.run();

        assertThat(overdueRecipients()).containsExactly(backerOf(pending));
    }

    @Test
    @DisplayName("somebody who answered is not chased")
    void somebodyWhoAnsweredIsNotChased() {
        UUID project = liveCampaign();
        UUID pledge = backer(project);
        UUID survey = sentSurvey(project);
        answer(survey, pledge);

        clock.advance(PAST_THE_INTERVAL);

        assertThat(job.chaseNonResponders()).isZero();
    }

    @Test
    @DisplayName("reminders stop at the configured number")
    void remindersStopAtTheConfiguredNumber() {
        UUID project = liveCampaign();
        UUID pledge = backer(project);
        UUID survey = sentSurvey(project);

        // Three attempts is the default, and the fourth pass must send nothing: one is
        // a nudge and five is a campaign of its own.
        for (int pass = 0; pass < 4; pass++) {
            clock.advance(PAST_THE_INTERVAL);
            job.chaseNonResponders();
        }

        assertThat(nudgeCount(survey, pledge)).isEqualTo(3);
    }

    @Test
    @DisplayName("a survey past its cut-off is not chased")
    void aClosedSurveyIsNotChased() {
        UUID project = liveCampaign();
        backer(project);
        UUID survey = sentSurvey(project);

        new JdbcTemplate(dataSource)
                .update("UPDATE surveys SET respond_by = sent_at + interval '1 hour' WHERE id = ?", survey);

        clock.advance(PAST_THE_INTERVAL);

        // Chasing somebody about a form that would refuse them is worse than saying
        // nothing at all.
        assertThat(job.chaseNonResponders()).isZero();
    }

    @Test
    @DisplayName("a survey sent this morning is not chased before the interval has passed")
    void aFreshSurveyIsNotChased() {
        UUID project = liveCampaign();
        backer(project);
        sentSurvey(project);

        clock.advance(Duration.ofDays(1));

        assertThat(job.chaseNonResponders())
                .as("a survey that arrived yesterday has been received, not ignored")
                .isZero();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private UUID liveCampaign() {
        UUID creator = Campaigns.creator(dataSource, "nudge-c" + SEQUENCE.incrementAndGet());
        UUID project = Identifiers.newIdentifier();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO projects (id, creator_id, title, slug, state)
                        VALUES (?, ?, ?, ?, 'DRAFT')
                        """,
                        project,
                        creator,
                        "A campaign that chases people " + SEQUENCE.incrementAndGet(),
                        "nudge-" + SEQUENCE.incrementAndGet());
        Campaigns.launch(dataSource, project);
        return project;
    }

    /** A pledge on this campaign, by a new account. Returns the pledge. */
    private UUID backer(UUID project) {
        UUID backerId = Campaigns.creator(dataSource, "nudge-b" + SEQUENCE.incrementAndGet());
        UUID pledge = Identifiers.newIdentifier();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges
                            (id, project_id, backer_id, state, base_amount, shipping_country, confirmed_at)
                        VALUES (?, ?, ?, 'COLLECTED', 25.00, 'AZ', now())
                        """,
                        pledge,
                        project,
                        backerId);
        return pledge;
    }

    /** A survey that has already gone out, written directly: the send itself is SurveyApiTests'. */
    private UUID sentSurvey(UUID project) {
        UUID survey = Identifiers.newIdentifier();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update(
                """
                INSERT INTO surveys (id, project_id, title, sent_at, sent_to, created_by)
                VALUES (?, ?, 'Reward details', now(), 1, (SELECT creator_id FROM projects WHERE id = ?))
                """,
                survey,
                project,
                project);
        jdbc.update(
                """
                INSERT INTO survey_questions (id, survey_id, project_id, position, prompt, type, required)
                VALUES (?, ?, ?, 0, 'What size?', 'TEXT', false)
                """,
                Identifiers.newIdentifier(),
                survey,
                project);
        return survey;
    }

    private void answer(UUID survey, UUID pledge) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO survey_responses (id, survey_id, pledge_id, backer_id)
                        VALUES (?, ?, ?, (SELECT backer_id FROM pledges WHERE id = ?))
                        """,
                        Identifiers.newIdentifier(),
                        survey,
                        pledge,
                        pledge);
    }

    private UUID backerOf(UUID pledge) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT backer_id FROM pledges WHERE id = ?", UUID.class, pledge);
    }

    private long nudgeCount(UUID survey, UUID pledge) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM survey_nudges WHERE survey_id = ? AND pledge_id = ?",
                        Long.class,
                        survey,
                        pledge);
    }

    private List<UUID> overdueRecipients() {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT DISTINCT recipient_id FROM notifications WHERE type = 'SURVEY_OVERDUE'", UUID.class);
    }
}
