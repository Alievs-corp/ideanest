package az.ideanest.analytics.application;

import az.ideanest.analytics.domain.AudienceWindow;
import az.ideanest.analytics.infrastructure.AudienceRepository;
import az.ideanest.analytics.infrastructure.AudienceRepository.CampaignTotals;
import az.ideanest.analytics.infrastructure.AudienceRepository.Counts;
import az.ideanest.analytics.infrastructure.AudienceRepository.HourTotals;
import az.ideanest.project.application.CampaignViews;
import az.ideanest.shared.project.ProjectSummaries;
import az.ideanest.shared.project.ProjectSummary;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The audience reads, for whichever service has already decided the caller may see them —
 * #633.
 *
 * <p>Authorisation and auditing are the callers' ({@link PlatformAudienceService},
 * {@link ProjectAudienceService}); this is the arithmetic, in one place, so the console
 * and the owner's dashboard cannot disagree about a campaign.
 *
 * <p><strong>Bucketed here rather than in SQL.</strong> The store is hourly; the read asks
 * for the window's hours and folds them into its buckets with
 * {@link AudienceWindow#bucketOf}, the same function that drew the buckets. A year is at
 * most 8,784 hourly sums, and doing the zone arithmetic again in {@code AT TIME ZONE}
 * would be a second statement of where a day starts.
 *
 * <p>{@code REPEATABLE_READ}, so the totals, the series and the breakdowns are one
 * snapshot: an event landing between two statements would otherwise be in the chart and
 * not in the countries.
 */
@Service
public class AudienceReports {

    /** How many campaigns the console's table lists. */
    static final int TOP_CAMPAIGNS = 20;

    private final AudienceRepository audience;
    private final ProjectSummaries summaries;
    private final CampaignViews campaigns;

    public AudienceReports(AudienceRepository audience, ProjectSummaries summaries, CampaignViews campaigns) {
        this.audience = audience;
        this.summaries = summaries;
        this.campaigns = campaigns;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PlatformAudience platform(AudienceWindow window, Instant computedAt) {
        Map<Instant, Counts> buckets = fold(window, audience.platformHours(window.from(), window.to()));
        List<PlatformAudience.Point> series = buckets.entrySet().stream()
                .map(entry -> new PlatformAudience.Point(
                        entry.getKey(),
                        entry.getValue().visitors(),
                        entry.getValue().pageViews(),
                        entry.getValue().views(),
                        entry.getValue().clicks()))
                .toList();
        Counts total = buckets.values().stream().reduce(Counts.NONE, Counts::plus);

        return new PlatformAudience(
                window,
                computedAt,
                new PlatformAudience.Totals(total.visitors(), total.pageViews(), total.views(), total.clicks()),
                series,
                audience.siteVisitorsByCountry(window.from(), window.to()).stream()
                        .map(count -> new PlatformAudience.Labelled(count.label(), count.total()))
                        .toList(),
                audience.siteVisitorsByPlatform(window.from(), window.to()).stream()
                        .map(count -> new PlatformAudience.Labelled(count.label(), count.total()))
                        .toList(),
                topCampaigns(window));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ProjectAudience project(UUID projectId, AudienceWindow window, Instant computedAt) {
        Map<Instant, Counts> buckets = fold(window, audience.projectHours(projectId, window.from(), window.to()));
        List<ProjectAudience.Point> series = buckets.entrySet().stream()
                .map(entry -> new ProjectAudience.Point(
                        entry.getKey(), entry.getValue().views(), entry.getValue().clicks()))
                .toList();
        Counts total = buckets.values().stream().reduce(Counts.NONE, Counts::plus);

        return new ProjectAudience(
                window,
                computedAt,
                campaigns.viewsOf(projectId),
                total.views(),
                total.clicks(),
                series,
                audience.projectByCountry(projectId, window.from(), window.to()).stream()
                        .map(row -> new ProjectAudience.Country(row.country(), row.views(), row.clicks()))
                        .toList(),
                audience.projectClicksBySurface(projectId, window.from(), window.to()).stream()
                        .map(count -> new ProjectAudience.Labelled(count.label(), count.total()))
                        .toList(),
                audience.projectViewsByPlatform(projectId, window.from(), window.to()).stream()
                        .map(count -> new ProjectAudience.Labelled(count.label(), count.total()))
                        .toList());
    }

    /**
     * Every bucket of the window, in order, with the hours that fell in it added up and
     * zeros for the rest. A series with gaps is one every consumer has to fill before it
     * can draw it, and the one that forgets draws Monday next to Friday.
     */
    static Map<Instant, Counts> fold(AudienceWindow window, List<HourTotals> hours) {
        Map<Instant, Counts> buckets = new LinkedHashMap<>();
        for (Instant start : window.starts()) {
            buckets.put(start, Counts.NONE);
        }
        for (HourTotals hour : hours) {
            Instant bucket = window.bucketOf(hour.hour());
            if (bucket != null) {
                buckets.merge(bucket, hour.counts(), Counts::plus);
            }
        }
        return buckets;
    }

    private List<PlatformAudience.TopCampaign> topCampaigns(AudienceWindow window) {
        List<CampaignTotals> top = audience.topCampaigns(window.from(), window.to(), TOP_CAMPAIGNS);
        if (top.isEmpty()) {
            return List.of();
        }
        Map<UUID, ProjectSummary> named = summaries
                .summariesOf(top.stream().map(CampaignTotals::projectId).toList())
                .stream()
                .collect(Collectors.toMap(ProjectSummary::id, Function.identity(), (first, second) -> first));
        return top.stream()
                .map(row -> {
                    ProjectSummary summary = named.get(row.projectId());
                    return new PlatformAudience.TopCampaign(
                            row.projectId(),
                            summary == null ? null : summary.title(),
                            summary == null ? null : summary.slug(),
                            summary == null ? null : summary.creatorSlug(),
                            row.views(),
                            row.clicks());
                })
                .toList();
    }
}
