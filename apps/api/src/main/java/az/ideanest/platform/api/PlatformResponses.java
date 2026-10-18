package az.ideanest.platform.api;

import az.ideanest.platform.application.MaintenanceWindows;
import az.ideanest.platform.application.SystemHealth;
import az.ideanest.platform.domain.FeatureFlag;
import az.ideanest.platform.domain.MaintenanceWindow;
import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * AD-12, AD-16 and maintenance windows, as the service describes them — issues #312, #316
 * and #214.
 */
public final class PlatformResponses {

    private PlatformResponses() {
    }

    /**
     * One switch.
     *
     * <p>Named in the published contract, as the health records below are: springdoc names a
     * schema after its class, and several modules have a record called {@code Flag},
     * {@code Queue} or {@code Job}. Two schemas with one name collapse into whichever was
     * read last, and the generated client then describes this endpoint with another
     * module's shape.
     *
     * @param version what an edit sends back, so that one made from a stale list is refused
     *     rather than applied over somebody else's
     */
    @Schema(name = "FeatureFlag")
    public record Flag(
            String key,
            String description,
            boolean enabled,
            short rolloutPercentage,
            List<UUID> enabledAccounts,
            Instant updatedAt,
            UUID updatedBy,
            long version) {

        public static Flag of(FeatureFlag flag) {
            return new Flag(
                    flag.key(),
                    flag.description(),
                    flag.enabled(),
                    flag.rolloutPercentage(),
                    flag.enabledAccounts(),
                    flag.updatedAt(),
                    flag.updatedBy(),
                    flag.version());
        }
    }

    /**
     * What is switched on for the caller: every flag's name, and whether they see it.
     *
     * <p>A flag missing from the map is off, which is what a client must assume — the same
     * fail-closed default {@code FeatureFlags.isOn} gives a name with no row.
     */
    @Schema(name = "FeatureFlagAnswers")
    public record FlagAnswers(Map<String, Boolean> flags) {
    }

    /** Every flag. Unpaged — there are tens of rows and the screen is a list. */
    public record FlagList(List<Flag> flags) {

        public static FlagList of(List<FeatureFlag> flags) {
            return new FlagList(flags.stream().map(Flag::of).toList());
        }
    }

    /**
     * The health screen.
     *
     * <p><strong>{@code monitored} is false and is sent anyway.</strong> It is what the
     * screen renders its own disclaimer from: this page is read when somebody opens it and
     * alerts nobody, and #138 is what will. A screen that looked like monitoring without
     * saying it was not would make the gap look filled — {@code SystemHealth} has the
     * argument. When #138 lands, this field becomes true and the disclaimer disappears
     * without a change to the console.
     */
    @Schema(name = "PlatformHealth")
    public record Health(
            Instant at,
            @Schema(allowableValues = {"HEALTHY", "DEGRADED", "CRITICAL"}) String status,
            boolean monitored,
            List<Queue> queues,
            List<Job> jobs,
            List<Provider> providers) {

        public static Health of(SystemHealth health) {
            return new Health(
                    health.at(),
                    health.status().name(),
                    false,
                    health.queues().stream().map(Queue::of).toList(),
                    health.jobs().stream().map(Job::of).toList(),
                    health.providers().stream().map(Provider::of).toList());
        }
    }

    /** One queue. See {@code QueueDepthSource} on why waiting and dead are never summed. */
    @Schema(name = "HealthQueue")
    public record Queue(
            String name,
            long waiting,
            long dead,
            @Schema(allowableValues = {"HEALTHY", "DEGRADED", "CRITICAL"}) String status) {

        public static Queue of(SystemHealth.QueueDepth depth) {
            return new Queue(depth.name(), depth.waiting(), depth.dead(), depth.status().name());
        }
    }

    /**
     * One scheduled job.
     *
     * @param state the scheduler's own: {@code READY}, or {@code DEAD} once it has run out
     *     of attempts and will not restart itself
     * @param hold why a job that is not dead is deliberately not running, or absent:
     *     {@code MAINTENANCE} while a window holds the jobs that send money or messages out,
     *     {@code UNSCHEDULED} for one with no trigger on this deployment
     */
    @Schema(name = "HealthJob")
    public record Job(
            String name,
            @Schema(allowableValues = {"READY", "DEAD"}) String state,
            Instant lastRunAt,
            Instant nextAttemptAt,
            long overdueBySeconds,
            int attempts,
            String lastError,
            @Schema(allowableValues = {"MAINTENANCE", "UNSCHEDULED"}) String hold,
            @Schema(allowableValues = {"HEALTHY", "DEGRADED", "CRITICAL"}) String status) {

        public static Job of(SystemHealth.JobHealth job) {
            return new Job(
                    job.name(),
                    job.state(),
                    job.lastRunAt(),
                    job.nextAttemptAt(),
                    job.overdueBySeconds(),
                    job.attempts(),
                    job.lastError(),
                    job.hold(),
                    job.status().name());
        }
    }

    /**
     * One third party the platform calls. Not configured is not the same as not working.
     *
     * @param kind what the screen groups by and words — {@code payments}. A mail relay would
     *     arrive under its own heading with no change here
     * @param provider the provider as the platform names it — {@code PAYRIFF}; the screen
     *     gives it its proper name
     * @param reason why it is not available, or absent while it is
     */
    @Schema(name = "HealthProvider")
    public record Provider(
            String kind,
            String provider,
            boolean configured,
            boolean available,
            @Schema(allowableValues = {"NOT_CONFIGURED", "CIRCUIT_OPEN"}) String reason,
            @Schema(allowableValues = {"HEALTHY", "DEGRADED", "CRITICAL"}) String status) {

        public static Provider of(SystemHealth.ProviderHealth provider) {
            return new Provider(
                    provider.kind(),
                    provider.provider(),
                    provider.configured(),
                    provider.available(),
                    provider.reason(),
                    provider.status().name());
        }
    }

    /**
     * One maintenance window as the console sees it — #214.
     *
     * <p>Every field is sent, nulls included: the console reads a null {@code endsAt} as
     * "until further notice" and must not have to tell that apart from a field that is
     * missing.
     *
     * @param state judged when the response was built: {@code SCHEDULED}, {@code ANNOUNCED},
     *     {@code ACTIVE}, {@code ENDED} or {@code CANCELLED}
     * @param note internal only; never in the public status response
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record MaintenanceWindowView(
            UUID id,
            @Schema(allowableValues = {"SCHEDULED", "ANNOUNCED", "ACTIVE", "ENDED", "CANCELLED"}) String state,
            Instant startsAt,
            Instant endsAt,
            Instant announceFrom,
            String note,
            UUID createdBy,
            Instant createdAt,
            Instant endedAt,
            Instant cancelledAt) {

        public static MaintenanceWindowView of(MaintenanceWindow window, Instant now) {
            return new MaintenanceWindowView(
                    window.id(),
                    window.stateAt(now).name(),
                    window.startsAt(),
                    window.endsAt(),
                    window.announceFrom(),
                    window.note(),
                    window.createdBy(),
                    window.createdAt(),
                    window.endedAt(),
                    window.cancelledAt());
        }
    }

    /**
     * The console's maintenance screen.
     *
     * @param current the window in force, or null
     * @param upcoming every window still to come, announced or not, soonest first
     * @param recent the last twenty that are over, the most recently finished first
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record MaintenanceOverview(
            MaintenanceWindowView current, List<MaintenanceWindowView> upcoming, List<MaintenanceWindowView> recent) {

        public static MaintenanceOverview of(MaintenanceWindows.Overview overview, Instant now) {
            return new MaintenanceOverview(
                    overview.current().map(window -> MaintenanceWindowView.of(window, now)).orElse(null),
                    overview.upcoming().stream().map(window -> MaintenanceWindowView.of(window, now)).toList(),
                    overview.recent().stream().map(window -> MaintenanceWindowView.of(window, now)).toList());
        }
    }
}
