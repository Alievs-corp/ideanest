package az.ideanest.analytics.application;

/**
 * A {@code period} the audience reports do not offer — #633. A 400 naming the four that
 * exist, for {@link InvalidAnalyticsRangeException}'s reason: the caller can act on it,
 * and a named type keeps the advice from catching every {@link IllegalArgumentException}.
 */
public class InvalidAudiencePeriodException extends IllegalArgumentException {

    public InvalidAudiencePeriodException(String period) {
        super("A period is one of day, week, month or year, not " + period);
    }
}
