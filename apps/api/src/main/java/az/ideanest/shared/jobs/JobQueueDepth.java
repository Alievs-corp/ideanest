package az.ideanest.shared.jobs;

import az.ideanest.shared.observability.QueueDepthSource;
import org.springframework.stereotype.Component;

/**
 * The scheduler's dead jobs, as a gauge — #316.
 *
 * <p><strong>Its dead count is what this is for.</strong> {@code PlatformMetrics} publishes
 * it as {@code ideanest_queue_dead{queue="scheduled-jobs"}}, and {@code QueueDeadLetters}
 * pages somebody when a job has run out of attempts.
 *
 * <p><strong>It waits for nothing, and says so.</strong> This used to count every
 * {@code READY} job whose {@code next_attempt_at} had passed. A run that succeeds writes
 * the instant it finished there, and the cron decides when the job next runs, so nearly
 * every healthy job was counted: the health screen showed about two dozen "waiting" on a
 * platform where nothing was behind. A scheduler is one row per job, not a backlog, and
 * whether a job is late depends on its own trigger — which {@code SystemHealthService}
 * grades row by row. So the screen does not list this as a queue at all.
 */
@Component
public class JobQueueDepth implements QueueDepthSource {

    private final JobRecordRepository jobs;

    public JobQueueDepth(JobRecordRepository jobs) {
        this.jobs = jobs;
    }

    /**
     * The queue's name as an identifier, not as a sentence — issue #405.
     *
     * <p>This used to answer "Scheduled jobs", which the console rendered verbatim under an
     * Azerbaijani heading and directly above a section headed "Planlaşdırılmış işlər" — the
     * Azerbaijani for the same three words. One concept, two languages, one screen.
     *
     * <p>A queue name is a machine value: it is a metric tag, and it is the key the console
     * looks a translated label up under. That is the rule §21.1 and {@code HealthDashboard}
     * already follow for a job's state and for a capability — the wire word stays the wire
     * word and the sentence beside it is the reader's. A name a screen can render without a
     * catalogue is one that can only ever be in one language.
     */
    @Override
    public String queueName() {
        return "scheduled-jobs";
    }

    /** Nothing: see the class comment. Lateness is per job, graded on the health screen. */
    @Override
    public long waiting() {
        return 0;
    }

    @Override
    public boolean listedAsQueue() {
        return false;
    }

    @Override
    public long dead() {
        return jobs.countByState(JobState.DEAD);
    }
}
