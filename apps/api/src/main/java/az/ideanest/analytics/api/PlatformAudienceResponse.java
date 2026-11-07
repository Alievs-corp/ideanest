package az.ideanest.analytics.api;

import az.ideanest.analytics.application.PlatformAudience;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /v1/admin/audience} — #633.
 *
 * <p>Nested types carry an {@code Audience} prefix because springdoc names a schema by its
 * simple name and {@code Totals} is already {@code PlatformAnalyticsResponse}'s.
 *
 * @param from the first instant of the first bucket
 * @param to the end of the last bucket, exclusive. For {@code day} that is tonight's
 *     midnight, so the hours still to come are zeros in {@code series}
 * @param timeZone the calendar the buckets are drawn in: {@code Asia/Baku}
 * @param series every bucket of the window, oldest first, zeros included
 * @param countries site visitors by ISO 3166-1 alpha-2 country, most first; {@code ZZ} is
 *     unknown
 * @param platforms site visitors by client, most first
 * @param topCampaigns the twenty campaigns with the most views
 */
public record PlatformAudienceResponse(
        @Schema(allowableValues = {"day", "week", "month", "year"}) String period,
        Instant from,
        Instant to,
        String timeZone,
        @Schema(allowableValues = {"HOUR", "DAY", "MONTH"}) String bucket,
        Instant computedAt,
        AudienceTotals totals,
        List<AudiencePoint> series,
        List<AudienceCountryVisitors> countries,
        List<AudiencePlatformVisitors> platforms,
        List<AudienceTopCampaign> topCampaigns) {

    public static PlatformAudienceResponse of(PlatformAudience audience) {
        return new PlatformAudienceResponse(
                audience.window().period().wireValue(),
                audience.window().from(),
                audience.window().to(),
                audience.window().zone().getId(),
                audience.window().bucket().name(),
                audience.computedAt(),
                new AudienceTotals(
                        audience.totals().visitors(),
                        audience.totals().pageViews(),
                        audience.totals().campaignViews(),
                        audience.totals().campaignClicks()),
                audience.series().stream()
                        .map(point -> new AudiencePoint(
                                point.start(),
                                point.visitors(),
                                point.pageViews(),
                                point.campaignViews(),
                                point.campaignClicks()))
                        .toList(),
                audience.countries().stream()
                        .map(country -> new AudienceCountryVisitors(country.label(), country.visitors()))
                        .toList(),
                audience.platforms().stream()
                        .map(platform -> new AudiencePlatformVisitors(platform.label(), platform.visitors()))
                        .toList(),
                audience.topCampaigns().stream()
                        .map(campaign -> new AudienceTopCampaign(
                                campaign.projectId(),
                                campaign.title(),
                                campaign.slug(),
                                campaign.creatorSlug(),
                                campaign.views(),
                                campaign.clicks()))
                        .toList());
    }

    /**
     * @param visitors daily unique visitors, summed over the window's days: somebody who
     *     came on two days counts twice
     * @param pageViews every page shown
     * @param campaignViews daily unique campaign viewers, summed over campaigns and days
     * @param campaignClicks daily unique card clickers, summed over campaigns and days
     */
    public record AudienceTotals(long visitors, long pageViews, long campaignViews, long campaignClicks) {
    }

    /** @param start the bucket's first instant */
    public record AudiencePoint(
            Instant start, long visitors, long pageViews, long campaignViews, long campaignClicks) {
    }

    public record AudienceCountryVisitors(String country, long visitors) {
    }

    public record AudiencePlatformVisitors(
            @Schema(allowableValues = {"WEB", "IOS", "ANDROID"}) String platform, long visitors) {
    }

    /** {@code title}, {@code slug} and {@code creatorSlug} are absent if the campaign could not be read. */
    public record AudienceTopCampaign(
            UUID projectId, String title, String slug, String creatorSlug, long views, long clicks) {
    }
}
