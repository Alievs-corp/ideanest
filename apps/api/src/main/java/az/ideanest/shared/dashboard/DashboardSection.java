package az.ideanest.shared.dashboard;

import az.ideanest.shared.access.StaffCapability;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * One block of the console's front-page figures, answered by the module that owns the numbers
 * — #222.
 *
 * <h2>A published question, and why the dashboard knows no module</h2>
 *
 * <p>The dashboard pulls figures from eight places: analytics, campaigns, reports, support,
 * accounts and, later, every money queue. A dashboard that called each of them would depend on
 * all of them, and several already depend on each other through the console, so the first call
 * closes a cycle that {@code ModuleBoundaryTests} refuses. Instead each module implements this
 * interface for the figures it owns, and the dashboard module is handed every implementation by
 * the container and knows none of them by name. Adding a card is adding a class in the module
 * that has the data; nothing in the dashboard changes.
 *
 * <h2>The owner of the number is the one that decides who may see it</h2>
 *
 * <p>{@link #requiresAny()} is the capability the figure's own screen already asks for, stated
 * once, next to the query. The dashboard shows a section only to a caller who holds at least one
 * of them, so a moderator's front page holds the moderation queue and no revenue, and the
 * decision is made on the server from the account's roles and never from anything the browser
 * sends. A section the caller may not see is absent from the response, not present and empty.
 *
 * <h2>Figures, not rows</h2>
 *
 * <p>A reading holds sums, counts and one ratio, and an optional daily series. There is no
 * field for a transaction, a payer or a person, so no implementation can hand one on by
 * accident. The same property is what lets a later change scale a figure for a partner without
 * first having to find what else is in the payload.
 */
public interface DashboardSection {

    /** A stable identifier, such as {@code figures} or {@code campaigns}. The web keys its copy on it. */
    String key();

    /**
     * Where this section sits on the page, lowest first. Stated rather than left to the order the
     * container happens to list beans in, which is not something a page should depend on.
     */
    int order();

    /**
     * The caller must hold at least one of these. Never empty: a section with no requirement
     * would be shown to every member of staff, including a partner, and that is a decision to
     * make on purpose in a review, not by leaving a set blank.
     */
    Set<StaffCapability> requiresAny();

    /**
     * The figures for a window.
     *
     * <p>Called only for a caller who holds one of {@link #requiresAny()}. An implementation that
     * delegates to a service which checks the capability itself may pass {@code staffId} on.
     */
    Reading read(UUID staffId, Window window);

    /** What was asked about: whole days in Baku's calendar, from the first to the last inclusive. */
    record Window(LocalDate from, LocalDate to, ZoneId zone) {

        /** The first instant of the first day. */
        public Instant start() {
            return from.atStartOfDay(zone).toInstant();
        }

        /** The first instant after the last day, so a range is half-open and nothing is counted twice. */
        public Instant end() {
            return to.plusDays(1).atStartOfDay(zone).toInstant();
        }
    }

    /** What a section answered. */
    record Reading(List<Figure> figures, List<Point> series) {

        public Reading {
            figures = List.copyOf(figures);
            series = List.copyOf(series);
        }

        public static Reading of(List<Figure> figures) {
            return new Reading(figures, List.of());
        }
    }

    /**
     * One number.
     *
     * @param key a stable name such as {@code pledgeVolume}; the web's label is keyed on it
     * @param kind how {@code value} is to be read and formatted
     * @param value a decimal string, never a floating-point number: {@code "1200.00"} for money,
     *     {@code "17"} for a count, {@code "82.50"} for a ratio in per cent. Null when the figure
     *     cannot be computed, such as a success rate with nothing yet decided
     * @param currency the currency of a {@link Kind#MONEY} figure, otherwise null
     * @param since for a queue, when the oldest item in it arrived, so the page can say how long
     *     the longest wait is. Null for everything else
     */
    record Figure(String key, Kind kind, String value, String currency, Instant since) {

        public static Figure count(String key, long value) {
            return new Figure(key, Kind.COUNT, Long.toString(value), null, null);
        }

        public static Figure count(String key, long value, Instant since) {
            return new Figure(key, Kind.COUNT, Long.toString(value), null, since);
        }

        public static Figure money(String key, BigDecimal amount, String currency) {
            return new Figure(key, Kind.MONEY, amount.toPlainString(), currency, null);
        }

        public static Figure ratio(String key, BigDecimal percent) {
            return new Figure(key, Kind.RATIO, percent == null ? null : percent.toPlainString(), null, null);
        }
    }

    /** How a figure's value is read. */
    enum Kind {
        COUNT,
        MONEY,
        RATIO
    }

    /**
     * One day of a trend: what was pledged and how many pledges.
     *
     * @param amount money as a decimal string, in the section's currency
     */
    record Point(LocalDate date, String amount, long count) {}
}
