package az.ideanest.dashboard.application;

import az.ideanest.shared.dashboard.DashboardSection;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * The front page for one caller and one window — #222.
 *
 * @param from the first day, inclusive, in {@code timeZone}
 * @param to the last day, inclusive
 * @param computedAt when it was read
 * @param timeZone the calendar the days are in
 * @param sections only the sections the caller's capabilities allow, in page order. Empty for a
 *     member of staff who holds none of them, which is not an error
 */
public record Dashboard(
        LocalDate from, LocalDate to, Instant computedAt, String timeZone, List<Served> sections) {

    public Dashboard {
        sections = List.copyOf(sections);
    }

    /** One section, served or failed. A failed one carries no figures and does not stop the others. */
    public record Served(String key, Status status, DashboardSection.Reading reading) {

        public static Served ready(String key, DashboardSection.Reading reading) {
            return new Served(key, Status.READY, reading);
        }

        public static Served unavailable(String key) {
            return new Served(key, Status.UNAVAILABLE, DashboardSection.Reading.of(List.of()));
        }
    }

    /** Whether a section could be read. */
    public enum Status {
        READY,
        UNAVAILABLE
    }
}
