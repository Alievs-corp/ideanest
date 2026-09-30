package az.ideanest.shared.jobs;

import az.ideanest.shared.maintenance.MaintenanceGate;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * What happens when a trigger fires: claim, run, record.
 *
 * <p>Three lines, because everything difficult is on either side of them —
 * {@link JobRecordRepository#claim} decides who runs, and {@link JobLease} decides
 * where the transactions are. This is the part that must not have a transaction of
 * its own, so that the work happens with nothing held open.
 *
 * <p><strong>A tick that claims nothing is not an error.</strong> On a fleet of
 * three replicas, two of every three ticks do exactly nothing, which is the design
 * working: sixteen jobs on three replicas is forty-eight timers and sixteen runs.
 */
@Component
public class JobRunner {

    private static final Logger log = LoggerFactory.getLogger(JobRunner.class);

    private final JobLease lease;
    private final JobProperties properties;
    private final MaintenanceGate maintenance;
    private final Clock clock;

    public JobRunner(JobLease lease, JobProperties properties, MaintenanceGate maintenance, Clock clock) {
        this.lease = lease;
        this.properties = properties;
        this.maintenance = maintenance;
        this.clock = clock;
    }

    /**
     * One tick of one job.
     *
     * <p>The outcome is judged against a second reading of the clock rather than the
     * one the claim used, because the run is the thing in between and a backoff
     * measured from before it would be short by however long the work took.
     *
     * <p>Only {@link RuntimeException} is caught. An {@link Error} is not a failed
     * pass — it is a process that is no longer trustworthy — so it propagates, the
     * lease is left where it is, and another replica takes the job when it expires.
     * That is the same path a killed process takes, which is the point of the lease
     * having an expiry at all.
     *
     * @return whether this replica ran the work
     */
    public boolean run(ScheduledJob job) {
        // Before the claim, not inside the job: a claimed-and-skipped pass would be
        // recorded as a success and move the job's next attempt on, and a job that
        // checked for itself would be one more place to forget. Asked from a cached
        // snapshot, so the question costs nothing on the ticks that are not paused.
        if (job.pausesDuringMaintenance() && maintenance.active().isPresent()) {
            log.debug("Job {} is paused for maintenance on this tick.", job.name());
            return false;
        }

        String holder = properties.holder();
        if (!lease.claim(job.name(), holder, now())) {
            log.debug("Job {} was not claimed on this tick.", job.name());
            return false;
        }

        try {
            job.run();
        } catch (RuntimeException e) {
            // Recorded rather than logged and forgotten: the count is what eventually
            // stops the job, and the stack goes here because JobLease keeps only the
            // sentence.
            log.error("Job {} threw.", job.name(), e);
            lease.failed(job.name(), holder, now(), e);
            return true;
        }

        lease.succeeded(job.name(), holder, now());
        return true;
    }

    /** The clock, at the resolution PostgreSQL stores instants at. */
    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
