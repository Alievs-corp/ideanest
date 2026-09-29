package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.payment.application.ChargeRetryJob;
import az.ideanest.payment.application.CollectionOpening;
import az.ideanest.payment.application.CollectionOutcome;
import az.ideanest.payment.application.CollectionRun;
import az.ideanest.pledge.application.CollectionStage;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Ledgers;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedStoredCards;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * §20.4's campaign close, under load and under contention — issue #141.
 *
 * <h2>What this measures, and what it deliberately does not</h2>
 *
 * §20.4's target is <strong>10,000 collections within ten minutes</strong>, a sustained
 * floor of 16.7 a second. That figure has two halves and they belong to different owners.
 *
 * <p>The half that is <strong>ours</strong> is everything between "a pledge is due" and
 * "the money is recorded, posted and announced": the claim under {@code FOR UPDATE SKIP
 * LOCKED}, the transaction that spans the provider call, the ledger posting, the outbox
 * write, and §9.6's schedule. That half is what runs here, against a provider that answers
 * instantly, on a real PostgreSQL. If it cannot clear 16.7 a second with <em>no network at
 * all</em>, no provider will rescue it, and the measurement is worth having on every run
 * rather than on the day somebody wonders.
 *
 * <p>The half that is <strong>not</strong> ours is the provider's latency, its rate limit
 * and its retry semantics. #60 has not chosen one, and §9.3 records that the four
 * candidates differ enough that a number measured against a guess would be a
 * threshold-bearing artefact describing code that is not IdeyaNest. So <strong>no
 * end-to-end throughput SLO is asserted here</strong>. What is asserted is the floor our
 * own path must clear for the provider's latency to be the only remaining variable, and
 * the measured rate is logged so a regression is visible as a number rather than as a
 * feeling.
 *
 * <h2>Why this was blocked, and why it is not any more</h2>
 *
 * #141's blocking comment said "there is no close-and-collect run to load test yet — the
 * migrations stop at V21, `charge-processor` is named in comments and not written". That
 * is no longer true: #64 and #65 built {@code CollectionOpening}, {@code CollectionRun},
 * {@code ChargeProcessorJob} and {@code ChargeRetryJob}, and V41 and V42 built the tables
 * under them. The remaining objection in that comment — a mock PSP — is answered by
 * scoping the assertion to our own half rather than by waiting.
 *
 * <h2>Correctness matters more than throughput here, and is asserted exactly</h2>
 *
 * <ul>
 *   <li><strong>No double collection.</strong> {@link #theRunIsExactUnderContention()}
 *       drives {@value #WORKERS} threads at one campaign's queue — which is what two
 *       replicas do — and asserts one charge per pledge and one transaction row per
 *       pledge. This is the failure that charges somebody twice.
 *   <li><strong>No lost pledge.</strong> Every one of {@value #PLEDGES} ends in exactly one
 *       of §9.6's two outcomes, and the set that was refused is the set the rule says
 *       should have been.
 *   <li><strong>Exact decimal amounts.</strong> The ledger is compared against a
 *       {@code BigDecimal} sum, never a double.
 *   <li><strong>The outcome is never revisited.</strong> §5.1 decides success at the
 *       deadline from the confirmed pledges. A collection failure reduces the payout and
 *       must not flip the campaign, so the frozen outcome columns are read before and
 *       after.
 *   <li><strong>§9.6's schedule survives the load.</strong> Every refused pledge is at
 *       attempt one with its next slot at +24 hours, and the retry sweep collects all of
 *       them under their own keys.
 * </ul>
 *
 * <h2>The decline rate is a rule, not a script</h2>
 *
 * §9.6 puts 5–15% of a campaign's cards on the failure path, and a stub that always
 * approves never exercises it. The threads claim pledges in an order nobody controls, so
 * a queued script would make the outcome depend on that order;
 * {@code ScriptedPaymentProvider#willDeclineFirstAttemptForOneIn} refuses on a function of
 * the pledge instead, which the test computes independently and compares against.
 *
 * <h2>Scale</h2>
 *
 * {@value #PLEDGES} pledges rather than ten thousand, deliberately. What §20.4 constrains
 * is a <em>rate</em>, and a rate is what this measures; running ten thousand would multiply
 * the wall time of every CI run by the one variable — provider latency — that is stubbed
 * out to zero here anyway. The floor asserted is §20.4's own, unscaled.
 */
class CollectionLoadTests extends AbstractIntegrationTest {

    private static final Logger log = LoggerFactory.getLogger(CollectionLoadTests.class);

    /** How many pledges one campaign closes with. See "Scale" above. */
    private static final int PLEDGES = 600;

    /**
     * How many threads drain the queue at once.
     *
     * <p>Eight rather than two, because what is being exercised is {@code SKIP LOCKED}
     * under contention and two threads rarely collide. It is more replicas than the
     * platform will run, which is the right direction for a test of a lock.
     */
    private static final int WORKERS = 8;

    /** Roughly one card in this many is refused on its first attempt. §9.6's band is 5–15%. */
    private static final int DECLINE_ONE_IN = 10;

    /** §20.4: 10,000 collections within 10 minutes. */
    private static final double SUSTAINED_FLOOR_PER_SECOND = 10_000 / (10 * 60.0);

    /** What every pledge in this campaign is worth. Exact, and it stays exact. */
    private static final BigDecimal AMOUNT = new BigDecimal("37.55");

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private CollectionOpening opening;

    @Autowired
    private CollectionRun collection;

    @Autowired
    private ChargeRetryJob retries;

    @Autowired
    private ScriptedPaymentProvider provider;

    @Autowired
    private ScriptedStoredCards cards;

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
        handle = "load-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);
        provider.reset();
        cards.reset();
    }

    /**
     * Parks whatever is still queued, for {@code CollectionTests}' reason: the two jobs are
     * global sweeps, so rows left behind would be charged by the next suite's pass.
     */
    @AfterEach
    void parkWhatIsLeft() {
        jdbc().update(
                        """
                        UPDATE pledges
                           SET state = 'DROPPED',
                               canceled_at = now(),
                               next_charge_attempt_at = NULL,
                               charge_window_ends_at = NULL
                         WHERE state IN ('CHARGE_PENDING', 'CHARGE_FAILED')
                           AND project_id IN (SELECT id FROM projects WHERE slug LIKE 'load-%')
                        """);
        jdbc().update("UPDATE projects SET state = 'COLLECTING' WHERE state = 'SUCCESSFUL' AND slug LIKE 'load-%'");
        Ledgers.clear(dataSource);
    }

    /**
     * One campaign closing, drained by {@value #WORKERS} threads at once.
     *
     * <p>Everything §20.4 and §9.6 promise about that moment, in one pass, because they are
     * one event: splitting them into a throughput test and a correctness test would let a
     * run be fast because it collected half the pledges twice.
     */
    @Test
    @DisplayName("a campaign of 600 pledges closes exactly, at or above §20.4's sustained rate")
    void theRunIsExactUnderContention() throws Exception {
        UUID projectId = successful();
        List<UUID> pledgeIds = queue(projectId, PLEDGES);
        Instant closedAt = now();

        provider.willDeclineFirstAttemptForOneIn(DECLINE_ONE_IN, "insufficient_funds");
        Map<String, Object> outcomeBefore = frozenOutcome(projectId);

        assertThat(opening.open(projectId, closedAt)).contains(PLEDGES);

        long startedAt = System.nanoTime();
        int passes = drainConcurrently(closedAt);
        Duration elapsed = Duration.ofNanos(System.nanoTime() - startedAt);

        // ------------------------------------------------------------------
        // No lost pledge, and no pledge charged twice
        // ------------------------------------------------------------------

        List<UUID> expectedDeclines = pledgeIds.stream()
                .filter(id -> ScriptedPaymentProvider.declinesFirstAttempt(id, DECLINE_ONE_IN))
                .toList();
        List<UUID> expectedCollections =
                pledgeIds.stream().filter(id -> !expectedDeclines.contains(id)).toList();

        assertThat(pledgesInState(projectId, "COLLECTED"))
                .containsExactlyInAnyOrderElementsOf(expectedCollections);
        assertThat(pledgesInState(projectId, "CHARGE_FAILED"))
                .containsExactlyInAnyOrderElementsOf(expectedDeclines);
        assertThat(pledgesInState(projectId, "CHARGE_PENDING"))
                .as("§9.6 leaves nothing in the initial queue once the pass has drained it")
                .isEmpty();

        assertThat(provider.chargeCount())
                .as("one attempt per pledge -- a second is somebody's card charged twice")
                .isEqualTo(PLEDGES);
        assertThat(provider.idempotencyKeys())
                .as("§9.3's R-08: the key is derived from the pledge and the attempt, so a "
                        + "duplicate here would be a duplicate charge")
                .doesNotHaveDuplicates();
        assertThat(transactionCount(projectId))
                .as("one row per attempt, and there was one attempt each")
                .isEqualTo(PLEDGES);

        // ------------------------------------------------------------------
        // Exact decimal amounts, on both sides of the posting
        // ------------------------------------------------------------------

        BigDecimal collected = AMOUNT.multiply(BigDecimal.valueOf(expectedCollections.size()));
        assertThat(ledger.balanceOf(LedgerAccount.ESCROW, projectId, "AZN").amount())
                .isEqualByComparingTo(collected);
        assertThat(ledger.balanceOf(LedgerAccount.creator(creatorId), projectId, "AZN")
                        .amount())
                .as("a credit, so the claim the creator has on the platform is negative")
                .isEqualByComparingTo(collected.negate());

        // ------------------------------------------------------------------
        // §9.6's schedule, and §5.1's frozen outcome
        // ------------------------------------------------------------------

        assertThat(attemptsFor(projectId, "CHARGE_FAILED"))
                .as("a refusal costs one of §9.6's four attempts, and exactly one")
                .containsOnly(1);
        assertThat(nextAttemptsFor(projectId))
                .as("§9.6's second row: +24 hours from the close, for every one of them")
                .containsOnly(closedAt.plus(Duration.ofHours(24)));

        assertThat(projects.findById(projectId).orElseThrow().getState()).isEqualTo(ProjectState.COLLECTING);
        assertThat(frozenOutcome(projectId))
                .as("§5.1 decided success at the deadline from the confirmed pledges. A "
                        + "collection failure reduces the payout; it must never revisit the outcome")
                .isEqualTo(outcomeBefore);

        // ------------------------------------------------------------------
        // §9.6's decline band, and §20.4's rate
        // ------------------------------------------------------------------

        double declineRate = (double) expectedDeclines.size() / PLEDGES;
        assertThat(declineRate)
                .as("§9.6 puts 5-15%% of a campaign's cards on the failure path; a stub "
                        + "outside that band is not exercising the retry schedule")
                .isBetween(0.05, 0.15);

        double perSecond = PLEDGES / Math.max(elapsed.toNanos() / 1e9, 1e-9);
        log.info(
                "§20.4 campaign close: {} pledges over {} passes on {} threads in {} ms = {} collections/second "
                        + "(provider latency zero; §20.4's floor is {}/second).",
                PLEDGES,
                passes,
                WORKERS,
                elapsed.toMillis(),
                String.format("%.1f", perSecond),
                String.format("%.1f", SUSTAINED_FLOOR_PER_SECOND));

        assertThat(perSecond)
                .as("§20.4 asks for 10,000 collections in ten minutes. This measures our own "
                        + "half of that with the provider answering instantly, so it is the floor "
                        + "below which no provider could make the target reachable")
                .isGreaterThan(SUSTAINED_FLOOR_PER_SECOND);
    }

    /**
     * A second drain over the same queue finds nothing and charges nothing.
     *
     * <p>The idempotency assertion the run above cannot make on its own: "each pledge was
     * charged once" and "a further pass would charge them again" are different facts, and
     * the second is what a replica that restarts mid-close produces.
     */
    @Test
    @DisplayName("a second drain over a collected campaign charges nothing")
    void aCollectedCampaignIsNotCollectedAgain() throws Exception {
        UUID projectId = successful();
        queue(projectId, 40);
        Instant closedAt = now();

        opening.open(projectId, closedAt);
        drainConcurrently(closedAt);
        int charged = provider.chargeCount();

        // Including the opening: a campaign that was queued twice would reset every
        // backer's attempt count and hand four fresh attempts to cards already refused.
        assertThat(opening.open(projectId, closedAt)).isEmpty();
        drainConcurrently(closedAt);

        assertThat(provider.chargeCount()).isEqualTo(charged);
        assertThat(ledger.balanceOf(LedgerAccount.ESCROW, projectId, "AZN").amount())
                .isEqualByComparingTo(AMOUNT.multiply(BigDecimal.valueOf(40)));
    }

    /**
     * §9.6's retry, at the volume a decline band actually produces.
     *
     * <p>The band is 5–15%, so a ten-thousand-backer campaign owes five hundred to fifteen
     * hundred retries in one sweep — a queue of its own, drained by a job whose pass is
     * bounded. What is asserted is that the whole of it clears, under keys of its own, and
     * that the money lands exactly.
     */
    @Test
    @DisplayName("every refused card is collected on its second attempt, under its own key")
    void theRetrySweepClearsTheWholeBand() throws Exception {
        UUID projectId = successful();
        List<UUID> pledgeIds = queue(projectId, PLEDGES);
        Instant closedAt = now();

        provider.willDeclineFirstAttemptForOneIn(DECLINE_ONE_IN, "insufficient_funds");
        opening.open(projectId, closedAt);
        drainConcurrently(closedAt);

        long refused = pledgesInState(projectId, "CHARGE_FAILED").size();
        assertThat(refused).isPositive();

        provider.willApprove();
        Instant nextSlot = closedAt.plus(Duration.ofHours(24));
        int retried = 0;
        // Bounded per pass, like every sweep on this platform. Looping is what an
        // operator's six-hourly schedule does over a day.
        for (int swept = retries.retryFailedCollections(nextSlot); swept > 0; ) {
            retried += swept;
            swept = retries.retryFailedCollections(nextSlot);
        }

        assertThat(retried).isEqualTo((int) refused);
        assertThat(pledgesInState(projectId, "COLLECTED")).hasSize(PLEDGES);
        assertThat(pledgesInState(projectId, "CHARGE_FAILED")).isEmpty();

        assertThat(ledger.balanceOf(LedgerAccount.ESCROW, projectId, "AZN").amount())
                .as("every pledge, to the minor unit")
                .isEqualByComparingTo(AMOUNT.multiply(BigDecimal.valueOf(PLEDGES)));

        assertThat(provider.idempotencyKeys())
                .as("R-08: a second attempt is a new charge and carries a new key; a repeated "
                        + "key here would mean the provider replaying an answer instead")
                .doesNotHaveDuplicates()
                .hasSize(PLEDGES + (int) refused);
        assertThat(attemptsForPledges(pledgeIds.stream()
                        .filter(id -> ScriptedPaymentProvider.declinesFirstAttempt(id, DECLINE_ONE_IN))
                        .toList()))
                .containsOnly(2);
    }

    // ------------------------------------------------------------------
    // The harness
    // ------------------------------------------------------------------

    /**
     * Drains the initial queue from {@value #WORKERS} threads until it is empty.
     *
     * <p>{@code CollectionRun#collectNext} rather than {@code ChargeProcessorJob#collect},
     * because the job bounds a pass at {@code charges-per-pass} — three in the test profile
     * — and what is under test here is the claim under contention rather than the bound.
     * Each call is its own transaction, which is the property {@code REQUIRES_NEW} exists
     * to give it.
     *
     * @return how many calls were made in total, which is one more per worker than the
     *     number of pledges: the extra is each worker meeting {@code NOTHING_DUE}
     */
    private int drainConcurrently(Instant now) throws Exception {
        ExecutorService workers = Executors.newFixedThreadPool(WORKERS);
        try {
            List<Future<Integer>> passes = new ArrayList<>();
            for (int worker = 0; worker < WORKERS; worker++) {
                passes.add(workers.submit(() -> {
                    int calls = 0;
                    while (true) {
                        calls++;
                        CollectionOutcome outcome = collection.collectNext(CollectionStage.INITIAL, now);
                        if (outcome == CollectionOutcome.NOTHING_DUE
                                || outcome == CollectionOutcome.NO_PROVIDER
                                || outcome == CollectionOutcome.PROVIDER_UNAVAILABLE) {
                            return calls;
                        }
                    }
                }));
            }

            int total = 0;
            for (Future<Integer> pass : passes) {
                // A worker that threw fails the test here, naming the cause, rather than
                // leaving the run to fail later on a count nobody can explain.
                total += pass.get(2, TimeUnit.MINUTES);
            }
            return total;
        } finally {
            workers.shutdownNow();
        }
    }

    /**
     * A campaign §5.1 decided in favour of, waiting for its collection to open.
     *
     * <p>The outcome columns are written here rather than left null, unlike
     * {@code CollectionTests}' equivalent, and the difference is the point of one of the
     * assertions: "the outcome was not revisited" says nothing when the outcome is three
     * nulls before and three nulls after. What is written is what {@code CampaignFinalizer}
     * freezes at the deadline.
     */
    private UUID successful() {
        Instant deadline = Instant.now().minus(Duration.ofMinutes(5));
        UUID projectId = Campaigns.seed(dataSource, creatorId, handle + "-campaign")
                .state("SUCCESSFUL")
                .goal("100.00")
                .pledged("1000.00")
                .backers(PLEDGES)
                .launchedAt(deadline.minus(Duration.ofDays(30)))
                .deadline(deadline)
                .insert();

        jdbc().update(
                        """
                        UPDATE projects
                           SET finalized_at = deadline,
                               outcome_goal_amount = goal_amount,
                               outcome_pledged_amount = pledged_amount,
                               outcome_backers_count = backers_count
                         WHERE id = ?
                        """,
                        projectId);
        return projectId;
    }

    /**
     * {@code count} confirmed pledges, each with its own backer.
     *
     * <p>Batched rather than one round trip per row, for a reason that is about the
     * measurement rather than about impatience: six hundred individually-committed inserts
     * would dominate the wall time of a test whose subject is how fast the collection runs.
     * {@code pledges_project_backer_active_key} allows one active pledge per backer per
     * campaign, so the accounts are minted alongside.
     */
    private List<UUID> queue(UUID projectId, int count) {
        List<Object[]> backers = new ArrayList<>(count);
        List<Object[]> pledges = new ArrayList<>(count);
        List<UUID> pledgeIds = new ArrayList<>(count);

        for (int index = 0; index < count; index++) {
            UUID backerId = UUID.randomUUID();
            UUID pledgeId = UUID.randomUUID();
            String backerHandle = handle + "-b" + index;
            backers.add(new Object[] {backerId, backerHandle + "@example.com", "Backer " + index, backerHandle});
            pledges.add(new Object[] {pledgeId, projectId, backerId, AMOUNT});
            pledgeIds.add(pledgeId);
        }

        jdbc().batchUpdate("INSERT INTO users (id, email, name, slug) VALUES (?, ?, ?, ?)", backers);
        jdbc().batchUpdate(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, currency, confirmed_at)
                        VALUES (?, ?, ?, 'CONFIRMED', ?, 'AZN', now())
                        """,
                        pledges);
        return pledgeIds;
    }

    /** The instant a pass judges against, truncated as the jobs truncate it. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    private List<UUID> pledgesInState(UUID projectId, String state) {
        return jdbc().queryForList(
                        "SELECT id FROM pledges WHERE project_id = ? AND state = ?", UUID.class, projectId, state);
    }

    private List<Integer> attemptsFor(UUID projectId, String state) {
        return jdbc().queryForList(
                        "SELECT charge_attempts FROM pledges WHERE project_id = ? AND state = ?",
                        Integer.class,
                        projectId,
                        state);
    }

    private List<Integer> attemptsForPledges(List<UUID> pledgeIds) {
        return jdbc().queryForList(
                        "SELECT charge_attempts FROM pledges WHERE id = ANY (?)",
                        Integer.class,
                        (Object) pledgeIds.toArray(UUID[]::new));
    }

    private List<Instant> nextAttemptsFor(UUID projectId) {
        return jdbc()
                .queryForList(
                        """
                        SELECT next_charge_attempt_at FROM pledges
                         WHERE project_id = ? AND state = 'CHARGE_FAILED'
                        """,
                        java.sql.Timestamp.class,
                        projectId)
                .stream()
                .map(java.sql.Timestamp::toInstant)
                .toList();
    }

    private int transactionCount(UUID projectId) {
        Integer count =
                jdbc().queryForObject("SELECT count(*) FROM transactions WHERE project_id = ?", Integer.class, projectId);
        return count == null ? 0 : count;
    }

    /**
     * §5.1's outcome, frozen at the deadline. Read before and after, and compared.
     *
     * <p>{@code state} is deliberately not among the columns: the campaign is <em>meant</em>
     * to move from {@code SUCCESSFUL} to {@code COLLECTING} during the run, and including it
     * would make this assertion fail for the one change that is supposed to happen. The
     * state is asserted on its own line, against the value it should have reached.
     */
    private Map<String, Object> frozenOutcome(UUID projectId) {
        return jdbc().queryForMap(
                        """
                        SELECT outcome_goal_amount, outcome_pledged_amount, outcome_backers_count, finalized_at
                          FROM projects WHERE id = ?
                        """,
                        projectId);
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
