package az.ideanest.analytics.api;

import az.ideanest.analytics.application.ProjectAudience;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;

/**
 * One campaign's audience — #633: {@code GET /v1/projects/{id}/audience} for the people
 * running it and {@code GET /v1/admin/audience/projects/{id}} for staff, one shape.
 *
 * @param from the first instant of the first bucket
 * @param to the end of the last bucket, exclusive
 * @param timeZone the calendar the buckets are drawn in: {@code Asia/Baku}
 * @param allTimeViews daily unique viewers summed since counting began — the number on
 *     the campaign's card
 * @param series every bucket of the window, oldest first, zeros included
 * @param countries by ISO 3166-1 alpha-2 country, most viewed first; {@code ZZ} is unknown
 * @param surfaces clicks by where the card was, most first
 * @param platforms views by client, most first
 */
public record ProjectAudienceResponse(
        @Schema(allowableValues = {"day", "week", "month", "year"}) String period,
        Instant from,
        Instant to,
        String timeZone,
        @Schema(allowableValues = {"HOUR", "DAY", "MONTH"}) String bucket,
        Instant computedAt,
        long allTimeViews,
        ProjectAudienceTotals totals,
        List<ProjectAudiencePoint> series,
        List<ProjectAudienceCountry> countries,
        List<ProjectAudienceSurface> surfaces,
        List<ProjectAudiencePlatform> platforms) {

    public static ProjectAudienceResponse of(ProjectAudience audience) {
        return new ProjectAudienceResponse(
                audience.window().period().wireValue(),
                audience.window().from(),
                audience.window().to(),
                audience.window().zone().getId(),
                audience.window().bucket().name(),
                audience.computedAt(),
                audience.allTimeViews(),
                new ProjectAudienceTotals(audience.views(), audience.clicks()),
                audience.series().stream()
                        .map(point -> new ProjectAudiencePoint(point.start(), point.views(), point.clicks()))
                        .toList(),
                audience.countries().stream()
                        .map(country -> new ProjectAudienceCountry(country.country(), country.views(), country.clicks()))
                        .toList(),
                audience.surfaces().stream()
                        .map(surface -> new ProjectAudienceSurface(surface.label(), surface.count()))
                        .toList(),
                audience.platforms().stream()
                        .map(platform -> new ProjectAudiencePlatform(platform.label(), platform.count()))
                        .toList());
    }

    /**
     * @param views daily unique viewers, summed over the window's days
     * @param clicks daily unique card clickers, summed over the window's days
     */
    public record ProjectAudienceTotals(long views, long clicks) {
    }

    /** @param start the bucket's first instant */
    public record ProjectAudiencePoint(Instant start, long views, long clicks) {
    }

    public record ProjectAudienceCountry(String country, long views, long clicks) {
    }

    public record ProjectAudienceSurface(
            @Schema(allowableValues = {"HOME", "DISCOVER", "SEARCH", "CATEGORY", "COLLECTION", "PROFILE", "SAVED", "OTHER"})
                    String surface,
            long clicks) {
    }

    public record ProjectAudiencePlatform(
            @Schema(allowableValues = {"WEB", "IOS", "ANDROID"}) String platform, long views) {
    }
}
