package az.ideanest.subscription.application;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

/**
 * The window a revenue figure is about — #23.
 *
 * <p><strong>Half-open: {@code from} inclusive, {@code to} exclusive.</strong> Every other
 * window on this platform is ({@code FeeSchedule.coversInstant}, {@code Subscription
 * .entitlesAt}, the audit trail's own bounds), so no reader has to remember which boundary
 * belongs to which table. It also makes consecutive months add up: a payment at midnight
 * on 1 September is in September and in nothing else, where two inclusive bounds would put
 * it in August as well and make twelve monthly totals exceed the year.
 *
 * <h2>Why a missing period is a month rather than everything</h2>
 *
 * <p>An unbounded report is "every payment the platform has ever taken", and it arrives as
 * one absent query parameter rather than as a decision. So a request that names no period
 * gets the current month in {@link #ZONE} — which is the period somebody opening a revenue
 * screen means, and small enough that the default is never the expensive query.
 *
 * <h2>Why the month is Baku's and not UTC's</h2>
 *
 * <p>{@code project_analytics_daily} takes this decision for the same reason and states it
 * at length: Baku is UTC+4, so a UTC month begins at four in the morning on the 1st
 * locally, and the last four hours of the previous month fall into it. An operator closing
 * September against a bank statement would find a figure that disagrees with the statement
 * by whatever arrived on the evening of the 30th, and nothing on the screen would explain
 * why.
 *
 * <p>An explicit {@code from}/{@code to} pair is taken as given, in UTC as it arrived. The
 * zone is for deciding what "this month" means, not for reinterpreting a bound somebody
 * sent.
 */
public record RevenuePeriod(Instant from, Instant to) {

    /**
     * The platform's zone, the one {@code ideanest.analytics.aggregation.zone} names.
     *
     * <p>A constant rather than a property here, deliberately: that property configures an
     * aggregation whose rows are stamped with the zone they were computed in, so a change
     * is visible in the data. This decides the default bounds of a query, where a
     * configured zone would mean two deployments disagreeing about which payments are in
     * September with nothing recorded either way.
     */
    public static final ZoneId ZONE = ZoneId.of("Asia/Baku");

    /** The longest window one request may ask for. See {@link #of}. */
    public static final int MAX_DAYS = 400;

    public RevenuePeriod {
        if (from == null || to == null) {
            throw new IllegalArgumentException("A period has two ends");
        }
        if (!to.isAfter(from)) {
            // Equal ends are the case worth refusing rather than allowing: half-open, they
            // describe an empty window, and a screen would show a month of zeroes for what
            // was actually a mistyped date.
            throw new InvalidRevenuePeriodException("A period ends after it begins");
        }
        if (from.plus(MAX_DAYS, ChronoUnit.DAYS).isBefore(to)) {
            throw new InvalidRevenuePeriodException(
                    "A period covers at most " + MAX_DAYS + " days; ask for a year at a time");
        }
        from = from.truncatedTo(ChronoUnit.MICROS);
        to = to.truncatedTo(ChronoUnit.MICROS);
    }

    /**
     * The period a request asked for, or the current month when it asked for none.
     *
     * <p>One end may be given without the other, and each missing end is filled from the
     * month the given one falls in — "from 1 September" means September rather than
     * September onwards, because the unbounded reading is the expensive one and nobody
     * asks for it by omission.
     *
     * @throws InvalidRevenuePeriodException when the ends are the wrong way round, or when
     *     the window is longer than {@link #MAX_DAYS}. Refused rather than clamped: a
     *     clamped period returns a figure for a window the caller did not ask about, and a
     *     revenue total nobody can name the bounds of is a number they will act on anyway
     */
    public static RevenuePeriod of(Instant from, Instant to, Clock clock) {
        if (from == null && to == null) {
            return monthOf(clock.instant());
        }
        if (from == null) {
            return new RevenuePeriod(startOfMonth(to), to);
        }
        if (to == null) {
            return new RevenuePeriod(from, startOfNextMonth(from));
        }
        return new RevenuePeriod(from, to);
    }

    /** The calendar month, in {@link #ZONE}, that this instant falls in. */
    public static RevenuePeriod monthOf(Instant instant) {
        return new RevenuePeriod(startOfMonth(instant), startOfNextMonth(instant));
    }

    /** How the file a period is exported to is named, and how a log line says which window. */
    public String label() {
        LocalDate first = LocalDate.ofInstant(from, ZONE);
        // The last instant of the window rather than the exclusive bound, because a period
        // ending at midnight on 1 October is September's and a label saying October is one
        // somebody files under the wrong month.
        LocalDate last = LocalDate.ofInstant(to.minusMillis(1), ZONE);
        return first.equals(last) ? first.toString() : first + "_" + last;
    }

    private static Instant startOfMonth(Instant instant) {
        return LocalDate.ofInstant(instant, ZONE)
                .withDayOfMonth(1)
                .atStartOfDay(ZONE)
                .toInstant();
    }

    private static Instant startOfNextMonth(Instant instant) {
        return LocalDate.ofInstant(instant, ZONE)
                .withDayOfMonth(1)
                .plusMonths(1)
                .atStartOfDay(ZONE)
                .toInstant();
    }
}
