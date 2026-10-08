package az.ideanest.shared.jobs;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The transactional half of the scheduler: taking a job, and writing down how it
 * went.
 *
 * <p><strong>Three short transactions around one run, and never a transaction that
 * spans it.</strong> The obvious implementation — {@code SELECT … FOR UPDATE} held
 * until the work finishes — would be simpler and is the wrong shape: the run's
 * duration would become a transaction's duration, pinning a pool connection and a
 * snapshot for the whole pass, and PostgreSQL cannot vacuum past the oldest open
 * transaction. A sweep that takes a minute would hold the horizon back by a minute,
 * every minute. So the lock is a lease written into a row and committed
 * immediately, and the run happens with nothing held open.
 *
 * <p>A separate bean from {@link JobRunner} rather than methods on it, because
 * Spring's {@code @Transactional} is a proxy and a self-call carries no transaction
 * at all — which, for a class whose entire job is where the transaction boundaries
 * are, would leave them nowhere. {@code OutboxDispatch} is split from
 * {@code OutboxRelay} for the same reason.
 *
 * <p><strong>Every write checks that the lease is still ours.</strong> That is what
 * makes an expiring lease safe rather than merely convenient: a replica paused past
 * its expiry — a long stop-the-world pause, a stalled disk — must not come back and
 * clear a lease that now belongs to somebody else, because the replica that took the
 * job is still in it and a third one would then start the same work.
 */
@Component
public class JobLease {

    private static final Logger log = LoggerFactory.getLogger(JobLease.class);

    /**
     * How much of a failure is worth keeping. Long enough for a driver's message,
     * short enough that a stack trace in a text column does not become the table.
     */
    private static final int LONGEST_RECORDED_ERROR = 1000;

    private final JobRecordRepository jobs;
    private final JobProperties properties;

    public JobLease(JobRecordRepository jobs, JobProperties properties) {
        this.jobs = jobs;
        this.properties = properties;
    }

    /**
     * Makes sure the job has a row, without disturbing one it already has.
     *
     * @param now the instant the job becomes eligible from, which for a new row is
     *     immediately — there is nothing to wait for until something has failed
     */
    @Transactional
    public void register(String name, Instant now) {
        if (jobs.register(name, now) == 1) {
            log.info("Job {} registered with the scheduler.", name);
        }
    }

    /**
     * Takes the job for {@code holder}, if it is free.
     *
     * @return whether this caller now holds it, and may run the work. False means
     *     somebody else has it, its backoff has not elapsed, or it has given up —
     *     three states that are one instruction to a trigger, which is to stop
     */
    @Transactional
    public boolean claim(String name, String holder, Instant now) {
        return claim(name, holder, now, properties.lockLease());
    }

    /** The same, for a job whose pass needs a lease of its own length. */
    @Transactional
    public boolean claim(String name, String holder, Instant now, Duration lease) {
        return jobs.claim(name, holder, now, now.plus(lease)) == 1;
    }

    /** The run finished. The lease goes back and the failure history behind it is cleared. */
    @Transactional
    public void succeeded(String name, String holder, Instant now) {
        JobRecord job = stillOurs(name, holder);
        if (job == null) {
            return;
        }
        if (job.getAttempts() > 0) {
            log.info("Job {} succeeded after {} consecutive failures.", name, job.getAttempts());
        }
        job.succeeded(now);
    }

    /**
     * The run threw. Counts the attempt and decides whether there is another one.
     *
     * <p>The exception is the work's answer and not this transaction's failure, so it
     * is recorded rather than propagated: letting it out would roll back the very row
     * that says the attempt happened, and the job would be retried on the next tick,
     * for ever, with {@code attempts} never moving off zero.
     */
    @Transactional
    public void failed(String name, String holder, Instant now, RuntimeException failure) {
        JobRecord job = stillOurs(name, holder);
        if (job == null) {
            return;
        }

        int attempt = job.getAttempts() + 1;
        String reason = describe(failure);

        if (attempt >= properties.maxAttempts()) {
            job.gaveUp(now, reason);
            // ERROR, and it should page somebody: this is work the platform was
            // supposed to keep doing and will now not do at all until a person looks
            // at it. V20 carries the statement that puts it back.
            log.error(
                    "Job {} has given up after {} consecutive failures and will not run again until it is reset: {}",
                    name,
                    attempt,
                    reason);
            return;
        }

        job.retryAfter(now, properties.backoffAfter(attempt), reason);
        // WARN rather than ERROR: a failed pass is the case this design exists to
        // absorb, and the job is still on the schedule.
        log.warn(
                "Job {} failed on attempt {} of {}; next attempt after {}: {}",
                name,
                attempt,
                properties.maxAttempts(),
                job.getNextAttemptAt(),
                reason);
    }

    /**
     * The row, locked, if this holder still owns the lease on it.
     *
     * <p>Null rather than an exception when it does not: losing a lease is not a bug
     * in the caller, it is what a lease is for. What it is, though, is a run that
     * took longer than the lease allows, which is either a job that has outgrown
     * {@code ideanest.jobs.lock-lease} or a replica that was paused — and both are
     * worth a line, because the visible symptom otherwise is a job that ran twice.
     */
    private JobRecord stillOurs(String name, String holder) {
        JobRecord job = jobs.findAndLock(name).orElse(null);
        if (job == null) {
            log.warn("Job {} finished a run but has no row; its outcome was not recorded.", name);
            return null;
        }
        if (!job.isHeldBy(holder)) {
            log.warn(
                    "Job {} was held by {} when it finished but the lease is now {}'s;"
                            + " the outcome of that run was not recorded.",
                    name,
                    holder,
                    job.getLockHolder());
            return null;
        }
        return job;
    }

    /**
     * The failure, as a sentence somebody can act on.
     *
     * <p>The type and the message, not the stack: the stack is in the log for the
     * attempt that produced it, and what a dead job needs to carry is what refused it
     * and what it said.
     */
    private static String describe(RuntimeException failure) {
        String message = failure.getMessage();
        String described = failure.getClass().getSimpleName() + (message == null ? "" : ": " + message);
        return described.length() <= LONGEST_RECORDED_ERROR
                ? described
                : described.substring(0, LONGEST_RECORDED_ERROR);
    }
}
