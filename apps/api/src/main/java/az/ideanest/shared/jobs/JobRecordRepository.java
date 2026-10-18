package az.ideanest.shared.jobs;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Scheduler rows, by the three questions a trigger asks of them. */
public interface JobRecordRepository extends JpaRepository<JobRecord, String> {

    /**
     * Writes the job down if it is not there already.
     *
     * <p>Called by every replica on the way up, so it has to be both idempotent and
     * harmless. {@code ON CONFLICT DO NOTHING} rather than an upsert for the second
     * of those: an upsert would reset {@code attempts} and {@code next_attempt_at}
     * every time a process started, and a rolling restart is exactly the moment
     * somebody is trying to recover a job that has been failing.
     *
     * <p>Here rather than seeded in V20 so that adding a job is a class and not a
     * migration, and so that a mixed fleet mid-deploy — half the replicas knowing
     * about a new job, half not — still ends with one row for it.
     *
     * @return 1 if this call created the row, 0 if it already existed
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            value =
                    """
                    INSERT INTO scheduled_jobs (name, next_attempt_at)
                    VALUES (:name, :now)
                    ON CONFLICT (name) DO NOTHING
                    """,
            nativeQuery = true)
    int register(@Param("name") String name, @Param("now") Instant now);

    /**
     * Takes the job, if it is free to be taken.
     *
     * <p><strong>One statement, because everything difficult about this is decided
     * inside it.</strong> A claim written as a read followed by an update cannot be
     * made correct: two replicas read a row whose lease has expired, both conclude it
     * is theirs, and both run the job — and the second run is not a duplicate
     * anybody chose, it is a duplicate nobody can see. So the condition lives in the
     * statement and PostgreSQL serialises it. Under {@code READ COMMITTED} the second
     * writer blocks on the row lock, re-reads the row the first one committed, finds
     * a lease that has not expired, and matches nothing — which is the same mechanism
     * {@code VerificationTokenRepository#claim} and {@code ReservationExpiry} rely on,
     * and the reason neither of them needs a lock either.
     *
     * <p>Three conditions, and each of them is a different way of not running:
     *
     * <ul>
     *   <li>{@code state = 'READY'} — the job has not given up. A dead job is not
     *       triggered at all, so a poisoned sweep stops costing a database round trip
     *       per tick per replica.
     *   <li>{@code next_attempt_at <= :now} — its backoff has elapsed. This is what
     *       makes a failing job quieten down without anybody editing its cron.
     *   <li>the lease is absent or elapsed — nobody else is in it. An elapsed lease is
     *       reclaimed on the spot, which is the whole answer to a holder that died
     *       mid-run: the job resumes by itself, at most one lease late.
     * </ul>
     *
     * <p>Native rather than JPQL because the row has to be judged against the values
     * it holds now, not against an entity somebody loaded a moment ago — and because
     * a JPQL update on a locked row would still be a read and a write from the
     * persistence context's point of view.
     *
     * @return 1 if this caller now holds the job, 0 if it does not — and the caller
     *     cannot tell which of the three reasons applied, deliberately: all three mean
     *     the same thing to a trigger, which is to do nothing until the next tick
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            value =
                    """
                    UPDATE scheduled_jobs
                       SET lock_holder = :holder,
                           lock_expires_at = :leaseUntil,
                           last_run_at = :now
                     WHERE name = :name
                       AND state = 'READY'
                       AND next_attempt_at <= :now
                       AND (lock_expires_at IS NULL OR lock_expires_at <= :now)
                    """,
            nativeQuery = true)
    int claim(
            @Param("name") String name,
            @Param("holder") String holder,
            @Param("now") Instant now,
            @Param("leaseUntil") Instant leaseUntil);

    /**
     * The row, locked, so that the outcome of a run can be written onto it.
     *
     * <p>{@code FOR UPDATE} rather than a plain read, because recording an outcome is
     * a read and then a write — the next backoff is derived from the attempts already
     * on the row — and the holder could have changed between the two. Waiting rather
     * than skipping, unlike the outbox relay's claim: there is exactly one row to
     * write and whoever holds it is about to release it, so queueing is measured in
     * milliseconds and skipping would mean silently losing the attempt count.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT j FROM JobRecord j WHERE j.name = :name")
    Optional<JobRecord> findAndLock(@Param("name") String name);

    /**
     * Every registered job, for AD-16's screen — #316.
     *
     * <p>Ordered by name so the screen is stable between reloads: a dashboard whose rows
     * move is one where somebody reads the wrong line.
     *
     * <p>Unpaged, and it will stay that way. A job is registered by a bean at start-up, so
     * the row count is the number of scheduled jobs in the codebase.
     */
    @Query("SELECT j FROM JobRecord j ORDER BY j.name ASC")
    List<JobRecord> allJobs();

    /** How many jobs are in one state. {@code DEAD} is the number worth looking at. */
    @Query("SELECT COUNT(j) FROM JobRecord j WHERE j.state = :state")
    long countByState(@Param("state") JobState state);
}
