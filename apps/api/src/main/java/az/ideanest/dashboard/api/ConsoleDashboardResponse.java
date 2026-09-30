package az.ideanest.dashboard.api;

import az.ideanest.dashboard.application.Dashboard;
import az.ideanest.shared.dashboard.DashboardSection;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * The front page over the wire — #222.
 *
 * <p>Every value is a decimal <strong>string</strong>: money, counts and the one ratio. A client
 * that parsed {@code 1200.10} into a binary double and summed a column would be producing the
 * rounding error the platform's rule against floating-point money exists to keep out.
 *
 * <p>There is no field in any type here that could carry a transaction, a payer or a person.
 *
 * @param from the first day, inclusive, in {@code timeZone}
 * @param to the last day, inclusive
 * @param sections only what the caller's capabilities allow, in page order; empty for staff who
 *     hold none of them
 */
public record ConsoleDashboardResponse(
        LocalDate from, LocalDate to, Instant computedAt, String timeZone, List<ConsoleDashboardSection> sections) {

    static ConsoleDashboardResponse of(Dashboard dashboard) {
        return new ConsoleDashboardResponse(
                dashboard.from(),
                dashboard.to(),
                dashboard.computedAt(),
                dashboard.timeZone(),
                dashboard.sections().stream().map(ConsoleDashboardSection::of).toList());
    }

    /**
     * One block.
     *
     * @param status {@code READY}, or {@code UNAVAILABLE} when this section could not be read,
     *     in which case it has no figures and the rest of the page is unaffected
     * @param series a daily trend where the section has one, otherwise empty
     */
    public record ConsoleDashboardSection(String key, Dashboard.Status status, List<ConsoleDashboardFigure> figures, List<ConsoleDashboardPoint> series) {

        static ConsoleDashboardSection of(Dashboard.Served served) {
            return new ConsoleDashboardSection(
                    served.key(),
                    served.status(),
                    served.reading().figures().stream().map(ConsoleDashboardFigure::of).toList(),
                    served.reading().series().stream().map(ConsoleDashboardPoint::of).toList());
        }
    }

    /**
     * One number.
     *
     * @param kind {@code COUNT}, {@code MONEY} or {@code RATIO}
     * @param value a decimal string, or null when the figure cannot be computed
     * @param currency for {@code MONEY}, otherwise null
     * @param since for a queue, when its oldest item arrived
     */
    public record ConsoleDashboardFigure(String key, DashboardSection.Kind kind, String value, String currency, Instant since) {

        static ConsoleDashboardFigure of(DashboardSection.Figure figure) {
            return new ConsoleDashboardFigure(figure.key(), figure.kind(), figure.value(), figure.currency(), figure.since());
        }
    }

    /** One day of a trend. */
    public record ConsoleDashboardPoint(LocalDate date, String amount, long count) {

        static ConsoleDashboardPoint of(DashboardSection.Point point) {
            return new ConsoleDashboardPoint(point.date(), point.amount(), point.count());
        }
    }
}
