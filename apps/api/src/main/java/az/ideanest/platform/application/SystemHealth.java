package az.ideanest.platform.application;

import az.ideanest.platform.PlatformProperties;
import java.time.Instant;
import java.util.List;

/**
 * What the platform looks like right now — §4.11's AD-16 and §18, issue #316.
 *
 * <p><strong>#316 said this was blocked on #138, the observability work, and it was not
 * quite.</strong> §18 is about metrics, traces and alerting — a system that watches
 * continuously and wakes somebody. This screen is the other thing: a page a member of
 * staff opens when a creator says their update never arrived, to see whether the queue is
 * moving. Every number on it is a {@code COUNT} over a table this service already owns,
 * so it needs no collector, no exporter and no #138.
 *
 * <p>What it deliberately does not do is alert. A dashboard nobody is watching is not
 * monitoring, and pretending otherwise is worse than an honest gap — so the screen says
 * in as many words that #138 is still what pages somebody.
 *
 * @param at when this was measured, so a stale tab cannot be mistaken for a healthy
 *     platform
 * @param queues the work waiting to be done
 * @param jobs the scheduled work, and whatever has stopped
 * @param providers every third party the platform calls, and whether it is answering
 * @param status the worst of the above, so the screen can be read in one glance
 */
public record SystemHealth(
        Instant at, List<QueueDepth> queues, List<JobHealth> jobs, List<ProviderHealth> providers,
        HealthStatus status) {

    /**
     * One queue and how much is in it.
     *
     * @param name the queue, as an identifier — {@code outbox}.
     *     Not a sentence: see {@link az.ideanest.shared.observability.QueueDepthSource#queueName()}
     *     and issue #405
     * @param waiting rows not yet handled
     * @param dead rows that ran out of attempts. <strong>Counted separately and never
     *     added into {@code waiting}</strong>: a deep queue is a platform under load and a
     *     dead row is a platform that has given up, and a single number would let a
     *     thousand-item backlog hide one message that will never be sent
     */
    public record QueueDepth(String name, long waiting, long dead, HealthStatus status) {

        /** Grades a depth against the configured thresholds. */
        public static QueueDepth of(String name, long waiting, long dead, PlatformProperties.Health thresholds) {
            HealthStatus status;
            if (dead > 0 || waiting >= thresholds.queueDepthCritical()) {
                // Any dead row is critical regardless of depth. It is not going to clear
                // on its own, which is exactly what distinguishes it from a backlog.
                status = HealthStatus.CRITICAL;
            } else if (waiting >= thresholds.queueDepthWarning()) {
                status = HealthStatus.DEGRADED;
            } else {
                status = HealthStatus.HEALTHY;
            }
            return new QueueDepth(name, waiting, dead, status);
        }
    }

    /**
     * One scheduled job.
     *
     * @param overdueBySeconds how far past its next attempt it is, or zero when it is not
     *     due yet — and zero for a job that is not expected to run: one that has given up
     *     ({@code DEAD}) and one that is {@code hold}. Lateness measured from a run that is
     *     never coming grew by a minute every minute and said nothing the state did not.
     *     Seconds rather than a duration because the screen renders it and a client that
     *     had to parse ISO-8601 to sort a column is a client that will sort it as text
     * @param lastError the last failure's message, truncated by the query. Present even
     *     on a job that has since recovered — "it failed twice this morning and is fine
     *     now" is the sentence somebody is trying to reconstruct
     * @param hold why a job that is not dead is deliberately not running, or null when it
     *     runs on its schedule: {@link #MAINTENANCE} or {@link #UNSCHEDULED}. Either is
     *     healthy, and the screen says which in words
     */
    public record JobHealth(
            String name,
            String state,
            Instant lastRunAt,
            Instant nextAttemptAt,
            long overdueBySeconds,
            int attempts,
            String lastError,
            String hold,
            HealthStatus status) {

        /** One of the jobs that send money or messages out, standing still for a maintenance window. */
        public static final String MAINTENANCE = "MAINTENANCE";

        /** Registered with no trigger on this deployment — its schedule is {@code -}. */
        public static final String UNSCHEDULED = "UNSCHEDULED";
    }

    /**
     * One third party the platform calls.
     *
     * @param kind what sort of thing it is, as the identifier the screen groups by and
     *     words — {@code payments}. Present so that a mail relay or a media provider can
     *     appear on the same screen without the screen learning what either is
     * @param configured whether the deployment has credentials for it at all. A provider
     *     that is not configured is not unhealthy — it is switched off, and a screen that
     *     painted it red would teach people that red is normal
     * @param available what the owning module's own circuit breaker currently answers
     * @param reason why it is not available, as a code — {@code NOT_CONFIGURED} or
     *     {@code CIRCUIT_OPEN}. Null while it is
     */
    public record ProviderHealth(
            String kind,
            String provider,
            boolean configured,
            boolean available,
            String reason,
            HealthStatus status) {
    }

    /** Three levels, and no more. See {@code HealthStatus} on why not five. */
    public enum HealthStatus {

        HEALTHY,

        /** Worth looking at. Nobody is woken. */
        DEGRADED,

        /** Something has stopped and will not restart itself. */
        CRITICAL;

        /**
         * The worse of two.
         *
         * <p>Used to roll the whole screen up into one word. Worst-wins rather than an
         * average, because an average of one broken queue and nine healthy ones is
         * "mostly fine", which is true and useless.
         */
        public HealthStatus or(HealthStatus other) {
            return compareTo(other) >= 0 ? this : other;
        }
    }
}
