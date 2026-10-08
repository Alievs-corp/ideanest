package az.ideanest.shared.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.support.AbstractIntegrationTest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.Trigger;
import org.springframework.scheduling.support.CronTrigger;

/**
 * The guarantee (#134): a scheduled job fires on every replica and runs on one.
 *
 * <p>Against a real PostgreSQL, because the whole of this is PostgreSQL deciding
 * which of two callers won a conditional update. An in-memory database that accepts
 * the same SQL would prove nothing about the case that matters, which is two
 * connections issuing it at the same moment.
 *
 * <p>Four of these carry the design:
 *
 * <ul>
 *   <li>{@link #twoConcurrentTriggersRunTheJobOnce()} is the issue, checked against
 *       two real connections rather than described.
 *   <li>{@link #aLeaseLeftBehindByADeadHolderIsReclaimed()} is the other half of it:
 *       a lock nobody released is an outage, and the expiry is what makes the
 *       recovery automatic.
 *   <li>{@link #aStaleHolderCannotReleaseSomebodyElsesLease()} is the failure that
 *       makes an expiring lease worth having rather than dangerous.
 *   <li>{@link #consecutiveFailuresReachTheTerminalState()} is the bound: a job that
 *       cannot run stops being retried and says why.
 * </ul>
 *
 * <p>Every claim here is driven with the instant it should be judged against, for
 * the reason {@code ReservationCleanerJob} gives about its own sweep: waiting for a
 * lease to elapse would make the suite slow, and waiting for a backoff would make it
 * flaky on the machine that is busiest.
 */
class JobSchedulerTests extends AbstractIntegrationTest {

    /** §8.4's names for the jobs this release actually runs. */
    private static final List<String> JOBS_THIS_RELEASE_RUNS = List.of(
            "outbox-relay", "reservation-cleaner", "idempotency-key-cleaner", "account-anonymiser", "reminder-sender");

    /**
     * Distinguishes the jobs these tests register. A counter, because the name is the
     * primary key and two tests sharing one would take each other's lease.
     */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private JobLease lease;

    @Autowired
    private JobRunner runner;

    @Autowired
    private JobProperties properties;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private Clock clock;

    private JdbcTemplate jdbc;

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    @AfterEach
    void removeTestJobs() {
        // Only this test's rows. The rows for the jobs the service actually runs are
        // written once at start-up and asserted on by the first test here.
        jdbc().update("DELETE FROM scheduled_jobs WHERE name LIKE 'test-%'");
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /** The instant these tests measure from, at the resolution PostgreSQL stores. */
    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    /** A registered job, ready to be claimed. */
    private String registeredJob(Instant at) {
        String name = "test-job-" + SEQUENCE.incrementAndGet();
        lease.register(name, at);
        return name;
    }

    private String stateOf(String name) {
        return jdbc().queryForObject("SELECT state FROM scheduled_jobs WHERE name = ?", String.class, name);
    }

    private int attemptsOf(String name) {
        Integer attempts =
                jdbc().queryForObject("SELECT attempts FROM scheduled_jobs WHERE name = ?", Integer.class, name);
        return attempts == null ? 0 : attempts;
    }

    private String lastErrorOf(String name) {
        return jdbc().queryForObject("SELECT last_error FROM scheduled_jobs WHERE name = ?", String.class, name);
    }

    private String holderOf(String name) {
        return jdbc().queryForObject("SELECT lock_holder FROM scheduled_jobs WHERE name = ?", String.class, name);
    }

    private Instant nextAttemptAt(String name) {
        return jdbc().queryForObject("SELECT next_attempt_at FROM scheduled_jobs WHERE name = ?", Instant.class, name);
    }

    private Instant lastRunAt(String name) {
        return jdbc().queryForObject("SELECT last_run_at FROM scheduled_jobs WHERE name = ?", Instant.class, name);
    }

    /** A job whose body is whatever the test needs it to be. */
    private static final class TestJob implements ScheduledJob {

        private final String name;
        private final String schedule;
        private final Runnable body;
        private final AtomicInteger runs = new AtomicInteger();

        /**
         * Disabled by default. These tests trigger the job themselves, because a cron
         * firing in the background would claim the very lease a test is asserting is
         * free.
         */
        private TestJob(String name, Runnable body) {
            this(name, "-", body);
        }

        private TestJob(String name, String schedule, Runnable body) {
            this.name = name;
            this.schedule = schedule;
            this.body = body;
        }

        @Override
        public String name() {
            return name;
        }

        @Override
        public String schedule() {
            return schedule;
        }

        @Override
        public void run() {
            runs.incrementAndGet();
            body.run();
        }

        int runs() {
            return runs.get();
        }
    }

    /**
     * A timer that remembers what it was asked to run rather than running it.
     *
     * <p>Hand-written rather than mocked, like every other double in this suite, and
     * here for one reason: the schedules in the test profile are all {@code -}, so the
     * only way to check that a cron expression reaches a trigger — and that the thing
     * behind the trigger claims the lease rather than calling the job — is to hold the
     * timer still and look at it.
     */
    private static final class CapturingTimers implements TaskScheduler {

        private final List<Trigger> triggers = new ArrayList<>();
        private final List<Runnable> tasks = new ArrayList<>();

        @Override
        public ScheduledFuture<?> schedule(Runnable task, Trigger trigger) {
            triggers.add(trigger);
            tasks.add(task);
            return null;
        }

        List<Trigger> triggers() {
            return triggers;
        }

        List<Runnable> tasks() {
            return tasks;
        }

        // Nothing here schedules by rate or delay: §8.4 is entirely cron, and a
        // scheduler that quietly accepted one of these would hide the day that stops
        // being true.

        @Override
        public ScheduledFuture<?> schedule(Runnable task, Instant startTime) {
            throw new UnsupportedOperationException("Jobs are scheduled by cron expression");
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Instant startTime, Duration period) {
            throw new UnsupportedOperationException("Jobs are scheduled by cron expression");
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Duration period) {
            throw new UnsupportedOperationException("Jobs are scheduled by cron expression");
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Instant startTime, Duration delay) {
            throw new UnsupportedOperationException("Jobs are scheduled by cron expression");
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Duration delay) {
            throw new UnsupportedOperationException("Jobs are scheduled by cron expression");
        }
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("every job the service runs today is on the durable scheduler")
    void everyJobIsRegisteredAtStartUp() {
        List<String> registered =
                jdbc().queryForList("SELECT name FROM scheduled_jobs ORDER BY name", String.class);

        // The wiring, end to end: five job classes that used to carry @Scheduled now
        // declare themselves to the scheduler, and the scheduler wrote them down. A
        // job missing here is a job whose trigger reaches nothing.
        assertThat(registered).containsAll(JOBS_THIS_RELEASE_RUNS);
    }

    @Test
    @DisplayName("a replica starting up does not reset a job's retry state")
    void registrationIsIdempotent() {
        Instant at = now();
        String name = registeredJob(at);
        assertThat(lease.claim(name, "replica-a", at)).isTrue();
        lease.failed(name, "replica-a", at, new IllegalStateException("the database is down"));

        // Every replica registers every job on the way up. If that were an upsert, a
        // rolling restart would clear the attempt counters of a job that is failing —
        // which is the one moment somebody is restarting replicas.
        lease.register(name, at.plus(Duration.ofHours(1)));

        assertThat(attemptsOf(name)).isEqualTo(1);
        assertThat(nextAttemptAt(name)).isEqualTo(at.plus(properties.backoffAfter(1)));
    }

    // -----------------------------------------------------------------------
    // The lease
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("one replica takes the job and the other is told nothing to do")
    void onlyOneReplicaClaimsAJob() {
        Instant at = now();
        String name = registeredJob(at);

        assertThat(lease.claim(name, "replica-a", at)).isTrue();
        // Not queued behind the first: a claim that waited would acquire the lease the
        // instant the holder released it and run the job a second time, immediately.
        assertThat(lease.claim(name, "replica-b", at)).isFalse();

        assertThat(holderOf(name)).isEqualTo("replica-a");
        assertThat(lastRunAt(name)).isEqualTo(at);
    }

    @Test
    @DisplayName("a lease left behind by a dead holder is reclaimed once it expires")
    void aLeaseLeftBehindByADeadHolderIsReclaimed() {
        Instant at = now();
        String name = registeredJob(at);

        assertThat(lease.claim(name, "replica-a", at)).isTrue();
        // replica-a is killed here. It releases nothing, and a lock that is never
        // released is a job that never runs again — reservations never given back,
        // notices never sent, and no symptom but an absence.
        Instant beforeItExpires = at.plus(properties.lockLease()).minusSeconds(1);
        assertThat(lease.claim(name, "replica-b", beforeItExpires)).isFalse();

        Instant afterItExpires = at.plus(properties.lockLease()).plusSeconds(1);
        assertThat(lease.claim(name, "replica-b", afterItExpires)).isTrue();
        assertThat(holderOf(name)).isEqualTo("replica-b");
    }

    @Test
    @DisplayName("a replica whose lease expired cannot release the one that replaced it")
    void aStaleHolderCannotReleaseSomebodyElsesLease() {
        Instant at = now();
        String name = registeredJob(at);

        assertThat(lease.claim(name, "replica-a", at)).isTrue();
        Instant afterItExpires = at.plus(properties.lockLease()).plusSeconds(1);
        assertThat(lease.claim(name, "replica-b", afterItExpires)).isTrue();

        // replica-a comes back from whatever paused it and finishes its run. It must
        // not clear a lease it no longer holds: doing so would hand the job to a third
        // replica while replica-b is still in it, which is the double run this whole
        // package exists to prevent.
        lease.succeeded(name, "replica-a", afterItExpires.plusSeconds(1));
        assertThat(holderOf(name)).isEqualTo("replica-b");

        // And a failure it reports is not written onto somebody else's run either.
        lease.failed(name, "replica-a", afterItExpires.plusSeconds(1), new IllegalStateException("too late"));
        assertThat(attemptsOf(name)).isZero();
        assertThat(lastErrorOf(name)).isNull();
    }

    @Test
    @DisplayName("two triggers firing at once run the job exactly once")
    void twoConcurrentTriggersRunTheJobOnce() throws Exception {
        Instant at = now();
        String name = registeredJob(at);

        CountDownLatch inTheMiddleOfRunning = new CountDownLatch(1);
        CountDownLatch releaseTheFirstRun = new CountDownLatch(1);

        TestJob job = new TestJob(name, () -> {
            inTheMiddleOfRunning.countDown();
            try {
                if (!releaseTheFirstRun.await(30, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("the second trigger never finished");
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        });

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            // The first trigger is inside the job's body — and therefore holding the
            // lease — while the second one fires. Two triggers in one process rather
            // than two replicas, which is the same interleaving: neither the claim nor
            // the lease asks who is calling, only whether the job is held.
            Future<Boolean> first = pool.submit(() -> runner.run(job));
            assertThat(inTheMiddleOfRunning.await(30, TimeUnit.SECONDS)).isTrue();

            boolean second = runner.run(job);
            releaseTheFirstRun.countDown();

            assertThat(first.get(30, TimeUnit.SECONDS)).isTrue();
            assertThat(second).isFalse();
        } finally {
            pool.shutdownNow();
        }

        assertThat(job.runs()).isEqualTo(1);
        // And the lease is given back, so the next tick is not refused.
        assertThat(holderOf(name)).isNull();
        assertThat(stateOf(name)).isEqualTo("READY");
    }

    // -----------------------------------------------------------------------
    // The trigger
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a job with a schedule is put on a cron trigger that runs it through the lease")
    void aScheduledJobIsPutOnATrigger() {
        TestJob job = new TestJob("test-trigger-" + SEQUENCE.incrementAndGet(), "0 0 * * * *", () -> {});

        CapturingTimers timers = new CapturingTimers();
        new JobScheduler(List.of(job), lease, runner, timers, clock).registerJobs();

        assertThat(timers.triggers()).hasSize(1);
        // The cron the job asked for, in UTC, reaches the timer unchanged. A schedule
        // read in the deployment's local zone runs at a different hour twice a year,
        // and the daily jobs are where that is least likely to be noticed.
        assertThat(timers.triggers().getFirst()).isInstanceOf(CronTrigger.class);
        assertThat(((CronTrigger) timers.triggers().getFirst()).getExpression()).isEqualTo("0 0 * * * *");
        // Registered as eligible immediately: there is nothing to wait for until
        // something has failed.
        assertThat(nextAttemptAt(job.name())).isBeforeOrEqualTo(now());

        // And what the timer will run is the claim, not the body: firing it once takes
        // the lease, runs the job, and gives the lease back.
        timers.tasks().getFirst().run();

        assertThat(job.runs()).isEqualTo(1);
        assertThat(holderOf(job.name())).isNull();
        assertThat(stateOf(job.name())).isEqualTo("READY");
    }

    @Test
    @DisplayName("a long-running job gets a thread of its own and a lease of its own length")
    void aLongRunningJobIsKeptOffTheSharedThread() {
        String name = "test-long-" + SEQUENCE.incrementAndGet();
        Instant[] leaseSeenDuringTheRun = new Instant[1];
        ScheduledJob job = new ScheduledJob() {
            @Override
            public String name() {
                return name;
            }

            @Override
            public String schedule() {
                return "0 0 * * * *";
            }

            @Override
            public void run() {
                leaseSeenDuringTheRun[0] = jdbc().queryForObject(
                        "SELECT lock_expires_at FROM scheduled_jobs WHERE name = ?", Instant.class, name);
            }

            @Override
            public boolean isLongRunning() {
                return true;
            }

            @Override
            public Optional<Duration> lease() {
                return Optional.of(Duration.ofMinutes(15));
            }
        };

        CapturingTimers timers = new CapturingTimers();
        JobScheduler scheduler = new JobScheduler(List.of(job), lease, runner, timers, clock);
        try {
            scheduler.registerJobs();

            // Issue #331: a transcode held the one shared scheduler thread for minutes and
            // stopped the outbox and the charges with it. The shared timer never sees it.
            assertThat(timers.triggers()).isEmpty();
        } finally {
            scheduler.destroy();
        }

        runner.run(job);
        assertThat(leaseSeenDuringTheRun[0]).isAfter(now().plus(Duration.ofMinutes(14)));
    }

    @Test
    @DisplayName("a job whose schedule is disabled is still written down")
    void aDisabledScheduleRegistersWithoutATimer() {
        TestJob job = new TestJob("test-disabled-" + SEQUENCE.incrementAndGet(), "-", () -> {});

        CapturingTimers timers = new CapturingTimers();
        new JobScheduler(List.of(job), lease, runner, timers, clock).registerJobs();

        // `-` is Spring's own value for "do not schedule this", and it has to keep
        // meaning that: the whole test profile relies on it. The row is written anyway,
        // because it is the job's identity and its retry state, and a deployment that
        // runs the job by hand still expects to find it.
        assertThat(timers.triggers()).isEmpty();
        assertThat(stateOf(job.name())).isEqualTo("READY");
    }

    @Test
    @DisplayName("two jobs under one name refuse to start")
    void oneNameIsOneJob() {
        String name = "test-duplicate-" + SEQUENCE.incrementAndGet();
        List<ScheduledJob> clashing = List.of(new TestJob(name, () -> {}), new TestJob(name, () -> {}));
        JobScheduler scheduler = new JobScheduler(clashing, lease, runner, new CapturingTimers(), clock);

        // They would share one lease, so each would stop the other from running about
        // half the time — a scheduler that mostly works, which is the worst thing for
        // it to be. Refusing to start is the only symptom anybody would see in time.
        assertThatThrownBy(scheduler::registerJobs).isInstanceOf(IllegalStateException.class);
    }

    // -----------------------------------------------------------------------
    // Retries
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a run that threw is retried, but not before its backoff has elapsed")
    void aFailedRunBacksOffBeforeItIsTriedAgain() {
        Instant at = now();
        TestJob job = new TestJob(registeredJob(at), () -> {
            throw new IllegalStateException("the transport is down");
        });

        assertThat(runner.run(job)).isTrue();

        assertThat(job.runs()).isEqualTo(1);
        assertThat(attemptsOf(job.name())).isEqualTo(1);
        assertThat(lastErrorOf(job.name())).contains("the transport is down");
        // The lease goes back immediately. A failure is not a reason to hold the job:
        // the backoff is what stops it being retried, and it is a column rather than a
        // lock so that another replica can serve it.
        assertThat(holderOf(job.name())).isNull();
        assertThat(nextAttemptAt(job.name())).isAfter(at);

        assertThat(lease.claim(job.name(), "replica-a", at)).isFalse();
        assertThat(lease.claim(job.name(), "replica-a", nextAttemptAt(job.name()))).isTrue();
    }

    @Test
    @DisplayName("a successful run clears the failures behind it")
    void aSuccessfulRunClearsTheFailureHistory() {
        Instant at = now();
        String name = registeredJob(at);

        assertThat(lease.claim(name, "replica-a", at)).isTrue();
        lease.failed(name, "replica-a", at, new IllegalStateException("the database is down"));

        Instant later = nextAttemptAt(name);
        assertThat(lease.claim(name, "replica-a", later)).isTrue();
        lease.succeeded(name, "replica-a", later);

        // Consecutive failures, not failures ever. A job that fails once an hour and
        // succeeds the rest of the time has never been failing, and a counter that
        // only went up would dead-letter it eventually for no reason at all.
        assertThat(attemptsOf(name)).isZero();
        assertThat(lastErrorOf(name)).isNull();
        assertThat(nextAttemptAt(name)).isEqualTo(later);
        assertThat(lease.claim(name, "replica-b", later)).isTrue();
    }

    @Test
    @DisplayName("consecutive failures reach the terminal state and stay there")
    void consecutiveFailuresReachTheTerminalState() {
        Instant at = now();
        String name = registeredJob(at);

        for (int attempt = 1; attempt <= properties.maxAttempts(); attempt++) {
            assertThat(lease.claim(name, "replica-a", at))
                    .withFailMessage("attempt %d should have been claimable", attempt)
                    .isTrue();
            lease.failed(name, "replica-a", at, new IllegalStateException("the database is down"));
            // Far enough forward that the backoff has certainly elapsed. This test is
            // about the count of attempts, not the arithmetic of the delay.
            at = at.plus(Duration.ofDays(1));
        }

        assertThat(stateOf(name)).isEqualTo("DEAD");
        assertThat(attemptsOf(name)).isEqualTo(properties.maxAttempts());
        assertThat(lastErrorOf(name)).contains("the database is down");

        // Terminal means terminal: no clock reaches it again, because a job that has
        // failed this many times in a row is waiting for a person and retrying it for
        // ever buries that fact in a log line repeated a million times.
        assertThat(lease.claim(name, "replica-a", at.plus(Duration.ofDays(365)))).isFalse();
    }

    @Test
    @DisplayName("a job that has given up is not triggered")
    void aDeadJobIsNotRun() {
        Instant at = now();
        TestJob job = new TestJob(registeredJob(at), () -> {
            throw new IllegalStateException("the database is down");
        });

        jdbc().update(
                        "UPDATE scheduled_jobs SET state = 'DEAD', attempts = 1, last_error = 'given up'"
                                + " WHERE name = ?",
                        job.name());

        assertThat(runner.run(job)).isFalse();
        assertThat(job.runs()).isZero();
    }
}
