package az.ideanest.shared.maintenance;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

/**
 * A maintenance window that is in force right now — issue #214.
 *
 * @param startsAt when it began
 * @param endsAt when it is announced to end, or null for "until further notice"
 */
public record ActiveMaintenance(Instant startsAt, Instant endsAt) {

    /** The shortest wait a client is told: shorter would be a poll storm against a 503. */
    static final long MIN_RETRY_AFTER_SECONDS = 30;

    /** The longest: a client told to go away for a day never notices the window ended early. */
    static final long MAX_RETRY_AFTER_SECONDS = 3600;

    /** What a client is told when nobody announced an end. */
    static final long UNKNOWN_END_RETRY_AFTER_SECONDS = 300;

    public ActiveMaintenance {
        Objects.requireNonNull(startsAt, "startsAt");
    }

    /**
     * The contract's {@code Retry-After}: seconds until the announced end, clamped to
     * 30 s – 1 h, and 300 when no end is announced.
     *
     * <p>Rounded up, so a window ending in 30.4 seconds is not advertised as ending in 30
     * — a client that retries on the dot would meet the same 503.
     */
    public long retryAfterSeconds(Instant now) {
        if (endsAt == null) {
            return UNKNOWN_END_RETRY_AFTER_SECONDS;
        }
        Duration remaining = Duration.between(now, endsAt);
        long seconds = remaining.getSeconds() + (remaining.getNano() > 0 ? 1 : 0);
        return Math.clamp(seconds, MIN_RETRY_AFTER_SECONDS, MAX_RETRY_AFTER_SECONDS);
    }
}
