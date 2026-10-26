package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.application.ProjectLaunchedEvent;
import az.ideanest.project.application.CampaignLauncherJob;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.infrastructure.ProjectRepository;
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
 * §6.1's scheduled launch, which nothing performed until #389.
 *
 * <p>The state machine has carried {@code APPROVED → SCHEDULED → LIVE} since it was written
 * and the campaign editor tells a creator their cleared campaign "goes live when you launch
 * it, or at the launch time you set". Only the first half was true, and
 * {@link #aCampaignWhoseTimeHasComeOpens()} is the second half as a test.
 *
 * <p>The rest are what a sweep over other people's campaigns has to get right:
 * {@link #aCampaignWhoseTimeHasNotComeIsLeftAlone()} and
 * {@link #aCampaignWithNoLaunchTimeIsLeftAlone()} — a creator who chose to press the button
 * themselves must not have it pressed for them — and
 * {@link #aSecondPassChangesNothing()}, because opening a campaign twice would announce it
 * twice to everybody following the creator.
 *
 * <p>The job is driven with the instant to judge against rather than by waiting:
 * {@code application-test.yml} sets the schedule to {@code -}, for the reason every job in
 * this codebase does.
 */
class CampaignLaunchTests extends AbstractIntegrationTest {

    /** Distinguishes the accounts and slugs these tests create. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private CampaignLauncherJob job;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;

    @BeforeEach
    void aCreator() {
        handle = "campaign-launch-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);
        // A plan, because the scheduled launch asks for one as the creator's own launch does
        // (#587): a campaign over its creator's plan at its launch time does not open.
        Campaigns.subscribe(dataSource, creatorId);
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // The outbox first: a launch event pointing at a campaign this deletes breaks an
        // unrelated suite on a foreign key three files away.
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update(
                "DELETE FROM project_state_transitions WHERE project_id IN"
                        + " (SELECT id FROM projects WHERE creator_id = ?)",
                creatorId);
        jdbc.update("DELETE FROM projects WHERE creator_id = ?", creatorId);
        jdbc.update("DELETE FROM subscriptions WHERE account_id = ?", creatorId);
    }

    // ------------------------------------------------------------------
    // The promise
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a cleared campaign whose launch time has arrived opens by itself")
    void aCampaignWhoseTimeHasComeOpens() {
        Instant at = Instant.now().minus(Duration.ofMinutes(5));
        UUID projectId = approved(at);

        assertThat(job.launchDueCampaigns(now())).isEqualTo(1);

        // The whole point: nobody pressed anything, and the campaign is public and taking
        // pledges at the time its creator told everybody it would be.
        assertThat(state(projectId)).isEqualTo(ProjectState.LIVE);
        assertThat(projects.findById(projectId).orElseThrow().getLaunchedAt()).isNotNull();
        // And the deadline is computed on the edge, from the launch, as it is for a launch
        // somebody pressed -- a campaign that opened on a timer and never closes is worse
        // than one that never opened.
        assertThat(projects.findById(projectId).orElseThrow().getDeadline()).isNotNull();
    }

    @Test
    @DisplayName("the trail says the platform opened it, not the creator")
    void theTransitionIsRecordedAsTheSystem() {
        UUID projectId = approved(Instant.now().minus(Duration.ofMinutes(1)));

        job.launchDueCampaigns(now());

        Map<String, Object> transition = new JdbcTemplate(dataSource)
                .queryForMap(
                        "SELECT from_state, to_state, actor_role, actor_id FROM project_state_transitions"
                                + " WHERE project_id = ? AND to_state = 'LIVE'",
                        projectId);

        assertThat(transition).containsEntry("from_state", "APPROVED");
        assertThat(transition).containsEntry("actor_role", "SYSTEM");
        // Nobody was signed in. An actor here would name somebody who did not do it.
        assertThat(transition.get("actor_id")).isNull();
    }

    @Test
    @DisplayName("opening on a timer is announced exactly as opening by hand is")
    void openingIsAnnounced() {
        UUID projectId = approved(Instant.now().minus(Duration.ofMinutes(1)));

        job.launchDueCampaigns(now());

        // A campaign that opened and told nobody is the same defect as one that did not
        // open: #245's "a creator you follow has launched" rides on this event, and it has
        // no sweep behind it to notice a missing one.
        assertThat(launchEvents(projectId)).hasSize(1);
    }

    @Test
    @DisplayName("a campaign already waiting in SCHEDULED opens on the same terms")
    void aScheduledCampaignOpens() {
        UUID projectId = campaign("SCHEDULED", Instant.now().minus(Duration.ofMinutes(1)));

        assertThat(job.launchDueCampaigns(now())).isEqualTo(1);

        // Nothing performs APPROVED -> SCHEDULED today, so this state is reached only by a
        // hand-written UPDATE. Reading both states is what makes the sweep correct now and
        // still correct the day something sets it.
        assertThat(state(projectId)).isEqualTo(ProjectState.LIVE);
    }

    // ------------------------------------------------------------------
    // What is left alone
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a campaign whose launch time has not arrived is left alone")
    void aCampaignWhoseTimeHasNotComeIsLeftAlone() {
        UUID projectId = approved(Instant.now().plus(Duration.ofHours(2)));

        assertThat(job.launchDueCampaigns(now())).isZero();

        assertThat(state(projectId)).isEqualTo(ProjectState.APPROVED);
    }

    @Test
    @DisplayName("a cleared campaign with no launch time waits for its creator")
    void aCampaignWithNoLaunchTimeIsLeftAlone() {
        UUID projectId = approved(null);

        assertThat(job.launchDueCampaigns(now())).isZero();

        // §5.3 makes the launch time advisory, so most campaigns have none -- and a creator
        // who did not name a time has said they will press the button themselves. Opening
        // it for them is publishing somebody's campaign on their behalf.
        assertThat(state(projectId)).isEqualTo(ProjectState.APPROVED);
    }

    @Test
    @DisplayName("a campaign still in review is not opened by a launch time on it")
    void aSubmittedCampaignIsLeftAlone() {
        UUID projectId = campaign("SUBMITTED", Instant.now().minus(Duration.ofDays(1)));

        assertThat(job.launchDueCampaigns(now())).isZero();

        // A creator may set a launch time while the campaign is still with a moderator. The
        // time arriving does not decide the review.
        assertThat(state(projectId)).isEqualTo(ProjectState.SUBMITTED);
    }

    @Test
    @DisplayName("a second pass changes nothing")
    void aSecondPassChangesNothing() {
        UUID projectId = approved(Instant.now().minus(Duration.ofMinutes(1)));

        assertThat(job.launchDueCampaigns(now())).isEqualTo(1);
        assertThat(job.launchDueCampaigns(now())).isZero();

        assertThat(state(projectId)).isEqualTo(ProjectState.LIVE);
        // Announcing twice is two messages to everybody following the creator about one
        // campaign opening once.
        assertThat(launchEvents(projectId)).hasSize(1);
    }

    // ------------------------------------------------------------------
    // The batch
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a pass is bounded, and the oldest launch time goes first")
    void aPassIsBoundedAndOldestFirst() {
        // `batch-size: 2` in application-test.yml.
        UUID first = approved(Instant.now().minus(Duration.ofHours(3)));
        UUID second = approved(Instant.now().minus(Duration.ofHours(2)));
        UUID third = approved(Instant.now().minus(Duration.ofHours(1)));

        assertThat(job.launchDueCampaigns(now())).isEqualTo(2);

        assertThat(state(first)).isEqualTo(ProjectState.LIVE);
        assertThat(state(second)).isEqualTo(ProjectState.LIVE);
        // Not skipped -- waiting for the next pass, a minute later. A campaign whose time
        // passed while the service was down opens before one whose time is a minute old.
        assertThat(state(third)).isEqualTo(ProjectState.APPROVED);

        assertThat(job.launchDueCampaigns(now())).isEqualTo(1);
        assertThat(state(third)).isEqualTo(ProjectState.LIVE);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    private UUID approved(Instant scheduledLaunchAt) {
        return campaign("APPROVED", scheduledLaunchAt);
    }

    /**
     * A campaign in one state, with a launch time and everything the edge into {@code LIVE}
     * needs.
     *
     * <p>Both columns are set with an {@code UPDATE} rather than through the seed builder,
     * which has neither: it writes a duration only for a campaign it seeds as already
     * launched, and it has no column for a launch time at all. This is the only suite that
     * needs either, and a column added to a fixture every suite uses is a change every suite
     * carries.
     *
     * <p>{@code OffsetDateTime} rather than {@code Instant}, which is what the seed builder
     * does two files away and for the same reason: the driver cannot infer the type of a
     * bare {@code Instant} for a {@code timestamptz}, and a null one it cannot infer at all.
     */
    private UUID campaign(String state, Instant scheduledLaunchAt) {
        UUID projectId = Campaigns.seed(dataSource, creatorId, handle + "-" + SEQUENCE.incrementAndGet())
                .state(state)
                .goal("5000.00")
                .insert();

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // §5.3 refuses a submission without a duration, so an approved campaign always has
        // one. The seed writes it only for a launched campaign, and without it the sweep
        // would skip these rows for the right reason and the wrong one.
        jdbc.update("UPDATE projects SET duration_days = 30 WHERE id = ?", projectId);

        if (scheduledLaunchAt == null) {
            jdbc.update("UPDATE projects SET scheduled_launch_at = NULL WHERE id = ?", projectId);
        } else {
            jdbc.update(
                    "UPDATE projects SET scheduled_launch_at = ? WHERE id = ?",
                    OffsetDateTime.ofInstant(scheduledLaunchAt, ZoneOffset.UTC),
                    projectId);
        }
        return projectId;
    }

    private ProjectState state(UUID projectId) {
        return projects.findById(projectId).orElseThrow().getState();
    }

    private List<Map<String, Object>> launchEvents(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT event_type FROM outbox_events WHERE aggregate_id = ? AND event_type = ?",
                        projectId,
                        ProjectLaunchedEvent.EVENT_TYPE);
    }
}
