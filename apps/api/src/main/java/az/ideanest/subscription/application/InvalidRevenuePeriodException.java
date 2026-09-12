package az.ideanest.subscription.application;

/**
 * A period the revenue report will not answer for: ends the wrong way round, or a window
 * longer than {@link RevenuePeriod#MAX_DAYS}.
 *
 * <p>Its own type rather than an {@code IllegalArgumentException}, because this module's
 * advice maps that to {@code INVALID_PLAN} — a refusal about a plan, which this is not,
 * shown beside a date picker rather than a price field.
 *
 * <p>Refused rather than clamped. A clamped window returns a total for a period the caller
 * did not ask about, and every figure on a revenue screen is one somebody is about to act
 * on; a number whose bounds nobody can name is worse than an error.
 */
public class InvalidRevenuePeriodException extends RuntimeException {

    public InvalidRevenuePeriodException(String message) {
        super(message);
    }
}
