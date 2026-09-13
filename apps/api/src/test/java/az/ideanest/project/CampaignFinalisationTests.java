package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import az.ideanest.project.application.CampaignFinalisedEvent;
import az.ideanest.project.application.CampaignFinalizerJob;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
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
 * §5.1 at the deadline: what {@code campaign-finalizer} decides, and what it freezes.
 *
 * <p>#63. This is the point at which a campaign stops being a page and becomes an
 * obligation, so the properties asserted here are the ones whose absence costs money:
 *
 * <ul>
 *   <li>{@link #aFundedCampaignSucceedsAtItsDeadline()} and
 *       {@link #anUnderfundedCampaignDoesNot()} — the rule.
 *   <li>{@link #aCampaignThatRaisedExactlyItsGoalSucceeds()} — the boundary, which is the
 *       one case nobody checks by hand and the one creator who would never forgive it.
 *   <li>{@link #aLaterCollectionFailureDoesNotChangeTheOutcome()} — #63's own sentence,
 *       and the entire reason V29 exists.
 *   <li>{@link #aSecondPassChangesNothing()} — closing a campaign twice would publish a
 *       second event, which is ten thousand duplicate messages about somebody's money.
 *   <li>{@link #closingIsAnnounced()} — a campaign that closed and told nobody is the
 *       same defect as one that did not close.
 * </ul>
 *
 * <p>The job is driven directly with the instant to judge against, rather than by waiting:
 * {@code application-test.yml} sets the schedule to {@code -} for the reason every job in
 * this codebase does, and with one of its own — a sweep firing in the background would
 * close the very campaigns these tests are about to assert are still live.
 */
class CampaignFinalisationTests extends AbstractIntegrationTest {

    /** Distinguishes the accounts and slugs these tests create. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** How long a fixture campaign ran for. Inside §5.3's 1–60 days, and otherwise arbitrary. */
    private static final Duration CAMPAIGN_LENGTH = Duration.ofDays(30);

    @Autowired
    private CampaignFinalizerJob job;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private ProjectProperties properties;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;

    @BeforeEach
    void aCreator() {
        handle = "finalise-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM project_state_transitions WHERE project_id IN"
                + " (SELECT id FROM projects WHERE creator_id = ?)", creatorId);
        jdbc.update("DELETE FROM projects WHERE creator_id = ?", creatorId);
    }

    // ------------------------------------------------------------------
    // §5.1
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a campaign that reached its goal by its deadline succeeds")
    void aFundedCampaignSucceedsAtItsDeadline() {
        UUID projectId = closed("10000.00", "12500.00", 42);

        assertThat(job.finaliseClosedCampaigns(now())).isEqualTo(1);

        assertThat(state(projectId)).isEqualTo(ProjectState.SUCCESSFUL);
    }

    @Test
    @DisplayName("a campaign below 80% of its goal by its deadline does not succeed")
    void anUnderfundedCampaignDoesNot() {
        // 79.99%. Under all-or-nothing this row was 9,999.99 — which now succeeds, and is
        // asserted to below.
        UUID projectId = closed("10000.00", "7999.00", 30);

        assertThat(job.finaliseClosedCampaigns(now())).isEqualTo(1);

        assertThat(state(projectId)).isEqualTo(ProjectState.UNSUCCESSFUL);
    }

    /**
     * IDN-EXT-01's boundary, through the sweep rather than beside it (#31): the threshold is
     * read from {@code ProjectProperties} by the service that closes campaigns, and a test on
     * {@code CampaignOutcome} alone could not notice that service passing the wrong number.
     */
    @Test
    @DisplayName("a campaign at exactly 80% of its goal succeeds, and one qapik under does not")
    void eightyPerCentIsTheBoundary() {
        assertThat(properties.finalisation().successThreshold()).isEqualByComparingTo("0.80");

        UUID atEighty = closed("10000.00", "8000.00", 20);
        UUID justOver = closed("10000.00", "8001.00", 20);
        UUID justUnder = closed("10000.00", "7999.99", 20);

        // Passes until nothing is left rather than one pass: the test profile bounds a pass at
        // two campaigns (see `aPassIsBounded`), and a single pass would close whichever two
        // it reached first — which is the bound working, not the threshold failing.
        int closed = 0;
        for (int pass = job.finaliseClosedCampaigns(now()); pass > 0; pass = job.finaliseClosedCampaigns(now())) {
            closed += pass;
        }
        assertThat(closed).isEqualTo(3);

        assertThat(state(atEighty)).isEqualTo(ProjectState.SUCCESSFUL);
        assertThat(state(justOver)).isEqualTo(ProjectState.SUCCESSFUL);
        assertThat(state(justUnder)).isEqualTo(ProjectState.UNSUCCESSFUL);
    }

    @Test
    @DisplayName("a campaign that raised 99.99% of its goal succeeds, which all-or-nothing failed")
    void whatAllOrNothingFailedNowSucceeds() {
        UUID projectId = closed("10000.00", "9999.99", 30);

        job.finaliseClosedCampaigns(now());

        assertThat(state(projectId)).isEqualTo(ProjectState.SUCCESSFUL);
    }

    /**
     * The boundary, written as its own test because {@code >=} and {@code >} are one
     * character apart and only one of them is §5.1.
     */
    @Test
    @DisplayName("a campaign that raised exactly its goal succeeds")
    void aCampaignThatRaisedExactlyItsGoalSucceeds() {
        UUID projectId = closed("10000.00", "10000.00", 12);

        job.finaliseClosedCampaigns(now());

        assertThat(state(projectId)).isEqualTo(ProjectState.SUCCESSFUL);
    }

    /**
     * The same amount written with a different scale is the same amount.
     *
     * <p>{@code numeric(14,2)} normalises this on the way in, so the assertion is really
     * about {@code CampaignOutcome} using {@code compareTo} rather than {@code equals} —
     * which is the standing money rule and the one a future edit is most likely to break.
     */
    @Test
    @DisplayName("scale does not decide an outcome")
    void scaleDoesNotDecideAnOutcome() {
        UUID projectId = closed("10000.0", "10000.000", 1);

        job.finaliseClosedCampaigns(now());

        assertThat(state(projectId)).isEqualTo(ProjectState.SUCCESSFUL);
    }

    @Test
    @DisplayName("a campaign nobody backed closes unsuccessful rather than failing")
    void aCampaignNobodyBackedClosesUnsuccessful() {
        UUID projectId = closed("10000.00", "0.00", 0);

        assertThat(job.finaliseClosedCampaigns(now())).isEqualTo(1);

        assertThat(state(projectId)).isEqualTo(ProjectState.UNSUCCESSFUL);
    }

    // ------------------------------------------------------------------
    // What is left alone
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a campaign whose deadline has not passed is left alone")
    void aRunningCampaignIsLeftAlone() {
        UUID projectId = live("10000.00", "12500.00", 42, Duration.ofHours(1));

        assertThat(job.finaliseClosedCampaigns(now())).isZero();

        assertThat(state(projectId)).isEqualTo(ProjectState.LIVE);
        assertThat(finalisedAt(projectId)).isNull();
    }

    /**
     * A campaign trust and safety stopped, or one the creator cancelled, is past its
     * deadline and is not this job's.
     *
     * <p>§6.1 has no edge from either state, so finalising one would be refused — but the
     * refusal would be an exception inside a sweep, once a minute, for ever. The query is
     * what keeps them out.
     */
    @Test
    @DisplayName("a suspended or cancelled campaign is never finalised")
    void aStoppedCampaignIsNeverFinalised() {
        UUID suspended = stopped("SUSPENDED");
        UUID canceled = stopped("CANCELED");

        assertThat(job.finaliseClosedCampaigns(now())).isZero();

        assertThat(state(suspended)).isEqualTo(ProjectState.SUSPENDED);
        assertThat(state(canceled)).isEqualTo(ProjectState.CANCELED);
    }

    // ------------------------------------------------------------------
    // Freezing the outcome
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the numbers that decided the campaign are frozen onto it")
    void theDecidingNumbersAreFrozen() {
        UUID projectId = closed("10000.00", "12500.00", 42);
        Instant at = now();

        job.finaliseClosedCampaigns(at);

        Project outcome = projects.findById(projectId).orElseThrow();
        assertThat(outcome.getFinalizedAt()).isEqualTo(at);
        assertThat(outcome.getOutcomeGoalAmount()).isEqualByComparingTo("10000.00");
        assertThat(outcome.getOutcomePledgedAmount()).isEqualByComparingTo("12500.00");
        assertThat(outcome.getOutcomeBackersCount()).isEqualTo(42);
    }

    /**
     * <strong>#63's own sentence, asserted.</strong> "Later collection failures reduce the
     * payout, never the outcome."
     *
     * <p>The live total is moved down after the campaign closes, which is what a refused
     * card, a dropped charge, a refund and a chargeback all do to it. The campaign stays
     * successful and the frozen numbers stay the ones that decided it — otherwise a
     * campaign that funded would appear, weeks later and on a page a backer is looking at,
     * to have failed all along.
     */
    @Test
    @DisplayName("a later collection failure does not change the outcome")
    void aLaterCollectionFailureDoesNotChangeTheOutcome() {
        UUID projectId = closed("10000.00", "10400.00", 80);
        job.finaliseClosedCampaigns(now());

        // Eight percent of the collections fail. This is what the pledge module does to
        // the denormalised counters when a charge is dropped.
        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE projects SET pledged_amount = 9568.00, backers_count = 74 WHERE id = ?",
                        projectId);

        assertThat(state(projectId))
                .as("the campaign funded, and losing collections afterwards does not undo that")
                .isEqualTo(ProjectState.SUCCESSFUL);
        Project outcome = projects.findById(projectId).orElseThrow();
        assertThat(outcome.getOutcomePledgedAmount())
                .as("what it raised at the deadline, not what was eventually collected")
                .isEqualByComparingTo("10400.00");
        assertThat(outcome.getOutcomeBackersCount()).isEqualTo(80);
        assertThat(outcome.getPledgedAmount())
                .as("the live total is free to move; that is why the outcome is a copy")
                .isEqualByComparingTo("9568.00");
    }

    /** The campaign's own history says who decided, and on what. */
    @Test
    @DisplayName("the transition is recorded against nobody, with the comparison that produced it")
    void theTransitionIsRecordedAgainstTheSystem() {
        UUID projectId = closed("10000.00", "12500.00", 42);

        job.finaliseClosedCampaigns(now());

        Map<String, Object> transition = new JdbcTemplate(dataSource)
                .queryForMap(
                        "SELECT from_state, to_state, actor_role, actor_id, note"
                                + " FROM project_state_transitions WHERE project_id = ?",
                        projectId);
        assertThat(transition.get("from_state")).isEqualTo("LIVE");
        assertThat(transition.get("to_state")).isEqualTo("SUCCESSFUL");
        assertThat(transition.get("actor_role")).isEqualTo("SYSTEM");
        assertThat(transition.get("actor_id")).as("no person decided this").isNull();
        assertThat((String) transition.get("note")).contains("12500.00", "10000.00", "AZN", "42");
    }

    // ------------------------------------------------------------------
    // Running twice
    // ------------------------------------------------------------------

    /**
     * The property the lease does not provide.
     *
     * <p>§8.4 is explicit that a run outlasting its lease is joined by a second replica, so
     * what stops a campaign being closed twice is the row claim — the state re-read under
     * {@code findByIdForUpdate}. A second event would be a second notification to every
     * backer.
     */
    @Test
    @DisplayName("a second pass changes nothing and announces nothing")
    void aSecondPassChangesNothing() {
        UUID projectId = closed("10000.00", "12500.00", 42);
        job.finaliseClosedCampaigns(now());
        Instant first = finalisedAt(projectId);

        assertThat(job.finaliseClosedCampaigns(now().plus(Duration.ofMinutes(1))))
                .as("nothing left to close")
                .isZero();

        assertThat(finalisedAt(projectId)).isEqualTo(first);
        assertThat(transitionCount(projectId)).isEqualTo(1);
        assertThat(events()).hasSize(1);
    }

    // ------------------------------------------------------------------
    // The bound on a pass
    // ------------------------------------------------------------------

    /**
     * Deadlines cluster; a pass does not.
     *
     * <p>Observable only because the test profile sets {@code batch-size} to two. What is
     * asserted is that the pass is bounded and that the remainder is picked up next time,
     * not the number — {@code ProjectProperties.Finalisation} argues the number.
     */
    @Test
    @DisplayName("a pass closes at most its batch, and the next one takes the rest")
    void aPassIsBounded() {
        int batch = properties.finalisation().batchSize();
        for (int campaign = 0; campaign < batch + 1; campaign++) {
            closed("10000.00", "12500.00", 5);
        }

        assertThat(job.finaliseClosedCampaigns(now())).isEqualTo(batch);
        assertThat(job.finaliseClosedCampaigns(now())).isEqualTo(1);
        assertThat(job.finaliseClosedCampaigns(now())).isZero();
    }

    /** The oldest deadline is the one that has been waiting longest, so it goes first. */
    @Test
    @DisplayName("a pass closes the campaign that has been waiting longest first")
    void theOldestDeadlineIsClosedFirst() {
        UUID recent = closedAt(Duration.ofMinutes(5));
        UUID oldest = closedAt(Duration.ofDays(3));
        UUID middle = closedAt(Duration.ofHours(6));

        job.finaliseClosedCampaigns(now());

        // The batch is two, so the two oldest are closed and the newest is not.
        assertThat(state(oldest)).isEqualTo(ProjectState.SUCCESSFUL);
        assertThat(state(middle)).isEqualTo(ProjectState.SUCCESSFUL);
        assertThat(state(recent)).isEqualTo(ProjectState.LIVE);
    }

    // ------------------------------------------------------------------
    // Telling everybody
    // ------------------------------------------------------------------

    /**
     * The event, in the same transaction as the decision.
     *
     * <p>Its payload carries the frozen numbers rather than the live ones, which is what
     * makes a redelivery hours later reproduce the message the deadline would have
     * produced. The money is §10.3's object with a string amount, so a notification cannot
     * round somebody's campaign.
     */
    @Test
    @DisplayName("closing a campaign records the event that tells everybody")
    void closingIsAnnounced() {
        UUID succeeded = closed("10000.00", "12500.00", 42);
        UUID failed = closed("10000.00", "500.00", 3);

        job.finaliseClosedCampaigns(now());

        List<Map<String, Object>> recorded = events();
        assertThat(recorded).hasSize(2);
        assertThat(recorded)
                .extracting(event -> event.get("aggregate_id"), event -> event.get("event_type"))
                .containsExactlyInAnyOrder(
                        tuple(succeeded, CampaignFinalisedEvent.SUCCEEDED),
                        tuple(failed, CampaignFinalisedEvent.UNSUCCESSFUL));

        String payload = recorded.stream()
                .filter(event -> succeeded.equals(event.get("aggregate_id")))
                .map(event -> String.valueOf(event.get("payload")))
                .findFirst()
                .orElseThrow();
        assertThat(payload)
                .as("§10.3: money crosses as a string, never a number")
                .contains("\"amount\":\"12500.00\"")
                .contains("\"currency\":\"AZN\"")
                .contains("\"backersCount\":42");
    }

    /** The aggregate is the campaign, so §8.3 orders a campaign's events against each other. */
    @Test
    @DisplayName("the event is recorded against the campaign, so its announcements stay ordered")
    void theEventIsOrderedPerCampaign() {
        UUID projectId = closed("10000.00", "12500.00", 42);

        job.finaliseClosedCampaigns(now());

        Map<String, Object> event = events().getFirst();
        assertThat(event.get("aggregate_type")).isEqualTo(CampaignFinalisedEvent.AGGREGATE_TYPE);
        assertThat(event.get("aggregate_id")).isEqualTo(projectId);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** The instant a pass judges against, truncated as the job truncates it. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    /** A live campaign whose deadline passed a day ago. */
    private UUID closed(String goal, String pledged, int backers) {
        return live(goal, pledged, backers, Duration.ofDays(1).negated());
    }

    /** A funded campaign whose deadline passed a given time ago. */
    private UUID closedAt(Duration ago) {
        return live("10000.00", "12500.00", 5, ago.negated());
    }

    /**
     * A live campaign closing at a chosen offset from now.
     *
     * <p>The launch instant is pinned relative to the deadline rather than left to the
     * fixture's default: {@code projects_deadline_follows_launch} refuses a campaign that
     * ends before it began, and a deadline three days in the past against a default launch
     * of yesterday is exactly that row.
     */
    private UUID live(String goal, String pledged, int backers, Duration deadlineFromNow) {
        Instant deadline = Instant.now().plus(deadlineFromNow);
        return Campaigns.seed(dataSource, creatorId, handle + "-" + SEQUENCE.incrementAndGet())
                .state("LIVE")
                .goal(goal)
                .pledged(pledged)
                .backers(backers)
                .launchedAt(deadline.minus(CAMPAIGN_LENGTH))
                .deadline(deadline)
                .insert();
    }

    /** A funded campaign, past its deadline, that somebody stopped before the deadline arrived. */
    private UUID stopped(String state) {
        Instant deadline = Instant.now().minus(Duration.ofDays(1));
        return Campaigns.seed(dataSource, creatorId, handle + "-" + state.toLowerCase(Locale.ROOT))
                .state(state)
                .goal("10000.00")
                .pledged("12500.00")
                .launchedAt(deadline.minus(CAMPAIGN_LENGTH))
                .deadline(deadline)
                .insert();
    }

    private ProjectState state(UUID projectId) {
        return projects.findById(projectId).orElseThrow().getState();
    }

    private Instant finalisedAt(UUID projectId) {
        return projects.findById(projectId).orElseThrow().getFinalizedAt();
    }

    private int transitionCount(UUID projectId) {
        Integer count = new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM project_state_transitions WHERE project_id = ?",
                        Integer.class,
                        projectId);
        return count == null ? 0 : count;
    }

    private List<Map<String, Object>> events() {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT aggregate_type, aggregate_id, event_type, payload FROM outbox_events"
                                + " WHERE event_type IN (?, ?)",
                        CampaignFinalisedEvent.SUCCEEDED,
                        CampaignFinalisedEvent.UNSUCCESSFUL);
    }
}
