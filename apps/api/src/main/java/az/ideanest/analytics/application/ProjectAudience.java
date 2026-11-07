package az.ideanest.analytics.application;

import az.ideanest.analytics.domain.AudienceWindow;
import java.time.Instant;
import java.util.List;

/**
 * One campaign's audience over a window — #633: the owner's dashboard and the console's
 * per-campaign breakdown.
 *
 * @param allTimeViews {@code projects.view_count}: daily unique viewers summed since the
 *     campaign was first counted, which is the number on its card
 * @param series one point per bucket of the window, zeros included
 * @param countries by country, most viewed first, {@code ZZ} included
 * @param surfaces clicks by the surface the card was on, most first
 * @param platforms views by platform, most first
 */
public record ProjectAudience(
        AudienceWindow window,
        Instant computedAt,
        long allTimeViews,
        long views,
        long clicks,
        List<Point> series,
        List<Country> countries,
        List<Labelled> surfaces,
        List<Labelled> platforms) {

    public record Point(Instant start, long views, long clicks) {
    }

    public record Country(String country, long views, long clicks) {
    }

    /** A surface or a platform, and its count. */
    public record Labelled(String label, long count) {
    }
}
