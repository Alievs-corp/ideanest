package az.ideanest.analytics.domain;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * The span an audience report covers and the buckets it is drawn in — #633.
 *
 * <p><strong>The one place a period becomes instants.</strong> Every audience read takes
 * its window from {@link #of}, so the console, the owner's dashboard, the web and the
 * phone agree about where "today" starts and which thirty days "this month" is:
 *
 * <table>
 *   <caption>Windows, in the platform zone</caption>
 *   <tr><th>period</th><th>from</th><th>buckets</th></tr>
 *   <tr><td>day</td><td>today 00:00</td><td>24 hours</td></tr>
 *   <tr><td>week</td><td>six days ago, 00:00</td><td>7 days</td></tr>
 *   <tr><td>month</td><td>twenty-nine days ago, 00:00</td><td>30 days</td></tr>
 *   <tr><td>year</td><td>the first of the month eleven months ago</td><td>12 months</td></tr>
 * </table>
 *
 * <p><strong>Half-open, and whole buckets.</strong> {@link #to()} is the end of the last
 * bucket rather than the moment of the read, so the series always has the same number
 * of points for a period — today's hours that have not happened yet are zeros, not
 * missing — and an hour on the boundary belongs to exactly one bucket.
 *
 * <p>Built through {@link ZonedDateTime} rather than by adding hours to an instant.
 * Asia/Baku has had no daylight saving since 2016 and every day there is twenty-four
 * hours; the arithmetic is still done in the zone, so a zone that does change its clocks
 * would get a 23- or 25-hour day rather than a series shifted by one.
 *
 * @param starts the first instant of every bucket, oldest first; never empty
 */
public record AudienceWindow(
        AudiencePeriod period, ZoneId zone, Instant from, Instant to, List<Instant> starts) {

    public AudienceWindow {
        Objects.requireNonNull(period, "period");
        Objects.requireNonNull(zone, "zone");
        starts = List.copyOf(starts);
        if (starts.isEmpty() || !starts.getFirst().equals(from) || !from.isBefore(to)) {
            throw new IllegalArgumentException("An audience window starts at its first bucket and ends after it");
        }
    }

    /** The window a period names, read at {@code now} in {@code zone}. */
    public static AudienceWindow of(AudiencePeriod period, Instant now, ZoneId zone) {
        LocalDate today = now.atZone(zone).toLocalDate();
        return switch (period) {
            case DAY -> hourly(period, today, zone);
            case WEEK -> daily(period, today.minusDays(6), today, zone);
            case MONTH -> daily(period, today.minusDays(29), today, zone);
            case YEAR -> monthly(period, today.withDayOfMonth(1).minusMonths(11), today.withDayOfMonth(1), zone);
        };
    }

    public AudienceBucket bucket() {
        return period.bucket();
    }

    /**
     * The bucket an instant falls in, as its first instant, or null when it is outside
     * the window. What the reader uses to place a row it read.
     */
    public Instant bucketOf(Instant instant) {
        if (instant.isBefore(from) || !instant.isBefore(to)) {
            return null;
        }
        ZonedDateTime local = instant.atZone(zone);
        ZonedDateTime start = switch (bucket()) {
            case HOUR -> local.truncatedTo(ChronoUnit.HOURS);
            case DAY -> local.toLocalDate().atStartOfDay(zone);
            case MONTH -> local.toLocalDate().withDayOfMonth(1).atStartOfDay(zone);
        };
        return start.toInstant();
    }

    private static AudienceWindow hourly(AudiencePeriod period, LocalDate day, ZoneId zone) {
        ZonedDateTime start = day.atStartOfDay(zone);
        ZonedDateTime end = day.plusDays(1).atStartOfDay(zone);
        List<Instant> starts = new ArrayList<>();
        for (ZonedDateTime hour = start; hour.isBefore(end); hour = hour.plusHours(1)) {
            starts.add(hour.toInstant());
        }
        return new AudienceWindow(period, zone, start.toInstant(), end.toInstant(), starts);
    }

    private static AudienceWindow daily(AudiencePeriod period, LocalDate first, LocalDate last, ZoneId zone) {
        List<Instant> starts = new ArrayList<>();
        for (LocalDate day = first; !day.isAfter(last); day = day.plusDays(1)) {
            starts.add(day.atStartOfDay(zone).toInstant());
        }
        return new AudienceWindow(
                period,
                zone,
                first.atStartOfDay(zone).toInstant(),
                last.plusDays(1).atStartOfDay(zone).toInstant(),
                starts);
    }

    private static AudienceWindow monthly(AudiencePeriod period, LocalDate first, LocalDate last, ZoneId zone) {
        List<Instant> starts = new ArrayList<>();
        for (LocalDate month = first; !month.isAfter(last); month = month.plusMonths(1)) {
            starts.add(month.atStartOfDay(zone).toInstant());
        }
        return new AudienceWindow(
                period,
                zone,
                first.atStartOfDay(zone).toInstant(),
                last.plusMonths(1).atStartOfDay(zone).toInstant(),
                starts);
    }
}
