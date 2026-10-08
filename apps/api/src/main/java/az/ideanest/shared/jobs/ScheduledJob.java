package az.ideanest.shared.jobs;

import java.time.Duration;
import java.util.Optional;

/**
 * Work that happens on a schedule, on one replica at a time.
 *
 * <p>A job implements this instead of carrying {@code @Scheduled}. The difference is
 * the whole of #134: the annotation fires on every replica and records nothing,
 * whereas a job registered here is claimed before it runs, counted when it fails,
 * and stopped when it has failed too often.
 *
 * <p><strong>Implemented by the module that owns the work, never by this package.</strong>
 * {@code shared} may not depend on {@code pledge} or {@code project} — that is
 * {@code ModuleBoundaryTests}' rule and it exists so that a module can be extracted
 * later — so the dependency points this way: a job knows about the scheduler and the
 * scheduler knows only about this interface. It is also the arrangement that keeps
 * the sweep and its trigger in the same file, which is where somebody looking for
 * "when does this run" will look.
 *
 * <p>Implementations are found by type. A {@code @Component} implementing this is on
 * the scheduler; nothing else has to be registered anywhere.
 */
public interface ScheduledJob {

    /**
     * §8.4's name for this job, verbatim: {@code outbox-relay},
     * {@code reservation-cleaner}.
     *
     * <p>The primary key of the row the lease is taken on, so it is an identity and
     * not a label: renaming it starts a new job with a fresh attempt count, and two
     * jobs sharing one would take the lease from each other.
     */
    String name();

    /**
     * When the trigger fires, as a UTC cron expression, or {@code -} to register the
     * job without scheduling it.
     *
     * <p>Every implementation reads this from its own configuration rather than
     * returning a literal, for the reason each of them already gave when it was an
     * annotation: the test profile sets the schedule to {@code -} and drives the work
     * directly, because a timer firing in the background of a test suite acts on the
     * very rows a test is about to assert on.
     *
     * <p>The cron decides how often the platform <em>asks</em>. Whether anything
     * happens is decided by the lease and by the backoff, which is why a job that is
     * failing does not need its schedule changed to stop hammering whatever it is
     * failing against.
     */
    String schedule();

    /**
     * One pass of the work, on the replica that won the claim.
     *
     * <p>Bounded rather than exhaustive, in every implementation: a backlog must not
     * become one pass that overlaps its own next tick. The remainder is one tick
     * away, and the lease is held until this returns.
     *
     * <p>Throwing is how a run reports that it failed. The runner counts the attempt,
     * releases the lease, and backs off; a job that swallows its own failures instead
     * will be recorded as having succeeded, which is worse than either.
     */
    void run();

    /**
     * Whether this job stands still while a maintenance window is in force — issue #214.
     *
     * <p><strong>True for the jobs that send money or messages out</strong>: charges,
     * refunds, reconciliation passes, notification fan-out and delivery, reminders. Those
     * are the ones whose effect leaves the platform and cannot be taken back if the
     * maintenance was for a problem in them. Everything else — sweeps, rollups,
     * retention — keeps running, because pausing it protects nobody and leaves a backlog.
     *
     * <p>A paused job is not claimed at all, so its attempt count and backoff are
     * untouched and it resumes on the first tick after the window ends. Inbound webhooks
     * are not a job and are still recorded throughout.
     */
    default boolean pausesDuringMaintenance() {
        return false;
    }

    /**
     * Whether a pass can take minutes rather than seconds — issue #331.
     *
     * <p><strong>Every other job shares one scheduler thread</strong> (Spring Boot's
     * {@code spring.task.scheduling.pool.size} is one), so a pass that held it for minutes
     * would stop the outbox, charges and reservation expiry for as long. A job answering
     * true is given a thread of its own instead, and nothing else changes: its trigger still
     * never overlaps itself, and it still takes the lease.
     */
    default boolean isLongRunning() {
        return false;
    }

    /**
     * How long a claim on this job lasts, when it should not be {@code ideanest.jobs.lock-lease}.
     *
     * <p>Longer than the longest pass, for a job whose pass can outlast the shared default:
     * a lease that expired mid-pass would let another replica start the same work, and the
     * first replica's outcome would go unrecorded.
     */
    default Optional<Duration> lease() {
        return Optional.empty();
    }
}
