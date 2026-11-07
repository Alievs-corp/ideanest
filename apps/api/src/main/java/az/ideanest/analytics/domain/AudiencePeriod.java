package az.ideanest.analytics.domain;

import java.util.Locale;
import java.util.Optional;

/**
 * The four windows every audience screen offers — #633: Günlük, Həftəlik, Aylıq, İllik.
 *
 * <p>Fixed windows rather than a free range. The owner asked for exactly these four on
 * every screen, web and mobile, console and dashboard, and a fixed set means the
 * windows and their buckets are decided once, here, by {@link AudienceWindow}, rather
 * than by four clients each computing "the last thirty days" in their own zone.
 *
 * <p>Lower-case on the wire ({@code ?period=week}), which is how a query parameter
 * reads; the enum's own names stay Java's.
 */
public enum AudiencePeriod {

    /** Today, by the hour. */
    DAY(AudienceBucket.HOUR),

    /** The last seven days including today, by the day. */
    WEEK(AudienceBucket.DAY),

    /** The last thirty days including today, by the day. */
    MONTH(AudienceBucket.DAY),

    /** The last twelve calendar months including this one, by the month. */
    YEAR(AudienceBucket.MONTH);

    private final AudienceBucket bucket;

    AudiencePeriod(AudienceBucket bucket) {
        this.bucket = bucket;
    }

    public AudienceBucket bucket() {
        return bucket;
    }

    /** {@code day}, {@code week}, {@code month} or {@code year}. */
    public String wireValue() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** The period a query parameter names, or empty for anything else. Case-sensitive, as the contract is. */
    public static Optional<AudiencePeriod> fromWire(String value) {
        for (AudiencePeriod period : values()) {
            if (period.wireValue().equals(value)) {
                return Optional.of(period);
            }
        }
        return Optional.empty();
    }
}
