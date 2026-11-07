package az.ideanest.analytics.application;

import az.ideanest.analytics.domain.AudienceWindow;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The platform's audience over a window — #633, {@code GET /v1/admin/audience}.
 *
 * @param series one point per bucket of the window, zeros included
 * @param countries site visitors by country, most first, {@code ZZ} included
 * @param platforms site visitors by platform, most first
 * @param topCampaigns the campaigns with the most views, at most twenty
 */
public record PlatformAudience(
        AudienceWindow window,
        Instant computedAt,
        Totals totals,
        List<Point> series,
        List<Labelled> countries,
        List<Labelled> platforms,
        List<TopCampaign> topCampaigns) {

    /**
     * @param visitors daily unique visitors, summed over the days of the window
     * @param pageViews every page view
     * @param campaignViews daily unique viewers of a campaign, summed over campaigns and days
     * @param campaignClicks daily unique card clickers, summed over campaigns and days
     */
    public record Totals(long visitors, long pageViews, long campaignViews, long campaignClicks) {
    }

    public record Point(Instant start, long visitors, long pageViews, long campaignViews, long campaignClicks) {
    }

    /** A country or platform, and its site visitors. */
    public record Labelled(String label, long visitors) {
    }

    /** {@code title}, {@code slug} and {@code creatorSlug} are null if the campaign could not be read. */
    public record TopCampaign(UUID projectId, String title, String slug, String creatorSlug, long views, long clicks) {
    }
}
