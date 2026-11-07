package az.ideanest.analytics.application;

import az.ideanest.analytics.AnalyticsProperties;
import az.ideanest.analytics.domain.AudienceCountry;
import az.ideanest.analytics.domain.BotUserAgents;
import az.ideanest.analytics.domain.VisitorKey;
import az.ideanest.analytics.infrastructure.AudienceRepository;
import az.ideanest.analytics.infrastructure.AudienceRepository.Counts;
import az.ideanest.project.application.CampaignViews;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Counting people — #633.
 *
 * <h2>What one event does</h2>
 *
 * <table>
 *   <caption>Per kind, in the Baku hour the event arrived in</caption>
 *   <tr><th>kind</th><th>every time</th><th>first of the day for this visitor</th></tr>
 *   <tr><td>VISIT</td><td>page views + 1</td><td>visitors + 1</td></tr>
 *   <tr><td>VIEW</td><td>nothing</td><td>views + 1, and {@code projects.view_count} + 1</td></tr>
 *   <tr><td>CLICK</td><td>nothing</td><td>clicks + 1, under the surface of that first click</td></tr>
 * </table>
 *
 * <p>"First of the day" is decided by V124's marker table: the event inserts a marker for
 * (day, visitor, kind, campaign) and only an inserted marker counts. The unique index
 * decides it, so two tabs opening the same campaign in the same millisecond still count
 * one person. Everything an event writes is in one transaction, so a first view moves
 * the hourly figure and the card's total together or not at all.
 *
 * <h2>What writes nothing</h2>
 *
 * <p>A machine's user agent ({@link BotUserAgents}), and a campaign the public may not
 * see. Both answer exactly as a counted event does — the endpoint must not be a way to
 * learn which campaign identifiers exist, or which agents are filtered.
 *
 * <h2>What is never stored</h2>
 *
 * <p>The address and the user agent. They are hashed with the day's salt into the
 * visitor key and dropped; {@link VisitorKey} has the argument for why the key itself is
 * not a way back to them.
 */
@Service
public class AudienceEventService {

    private final AudienceRepository audience;
    private final CampaignViews campaigns;
    private final CountryLookup countries;
    private final Clock clock;
    private final ZoneId zone;

    public AudienceEventService(
            AudienceRepository audience,
            CampaignViews campaigns,
            CountryLookup countries,
            AnalyticsProperties properties,
            Clock clock) {
        this.audience = audience;
        this.campaigns = campaigns;
        this.countries = countries;
        this.clock = clock;
        this.zone = ZoneId.of(properties.reporting().timeZone());
    }

    @Transactional
    public void record(AudienceEvent event) {
        if (BotUserAgents.isMachine(event.userAgent())) {
            return;
        }
        UUID projectId = event.projectId();
        if (event.kind().isAboutACampaign() && !campaigns.isPublic(projectId)) {
            return;
        }

        ZonedDateTime local = clock.instant().atZone(zone);
        LocalDate day = local.toLocalDate();
        Instant hour = local.truncatedTo(ChronoUnit.HOURS).toInstant();
        byte[] visitor = VisitorKey.of(saltFor(day), event.address(), event.userAgent());
        boolean first = audience.markFirst(day, visitor, event.kind().code(), projectId);
        String country = countryOf(event);
        String platform = event.platform().name();

        switch (event.kind()) {
            case VISIT -> audience.addToHour(
                    hour, null, country, platform, "NONE", new Counts(first ? 1 : 0, 1, 0, 0));
            case VIEW -> {
                if (first) {
                    audience.addToHour(hour, projectId, country, platform, "NONE", new Counts(0, 0, 1, 0));
                    campaigns.countView(projectId);
                }
            }
            case CLICK -> {
                if (first) {
                    audience.addToHour(
                            hour, projectId, country, platform, event.surface().name(), new Counts(0, 0, 0, 1));
                }
            }
        }
    }

    /**
     * Deletes the salts and markers of every day before yesterday — {@code audience-cleanup}.
     *
     * <p>Yesterday is kept as grace: an event that left the client at 23:59:59 and arrives
     * after midnight is counted on the day it arrived, but a pass running at 00:00:01 must
     * not take the salt from under a request still writing yesterday's marker.
     *
     * @return how many rows were deleted
     */
    @Transactional
    public int forgetPassedDays() {
        LocalDate yesterday = clock.instant().atZone(zone).toLocalDate().minusDays(1);
        return audience.forgetDaysBefore(yesterday);
    }

    /**
     * The day's salt, created by whichever request needs it first.
     *
     * <p>Read, and inserted only when missing. Two replicas racing to create it both
     * insert with {@code ON CONFLICT DO NOTHING}; the second waits for the first to commit
     * and then reads the first's salt back, so a day has one salt platform-wide.
     */
    private byte[] saltFor(LocalDate day) {
        return audience.saltOf(day).orElseGet(() -> {
            audience.insertSaltIfAbsent(day, VisitorKey.newSalt());
            return audience.saltOf(day).orElseThrow();
        });
    }

    /** Cloudflare's country when it gave one, else the GeoIP database's, else unknown. */
    private String countryOf(AudienceEvent event) {
        return AudienceCountry.fromHeader(event.cloudflareCountry())
                .or(() -> countries.countryOf(event.address()))
                .orElse(AudienceCountry.UNKNOWN);
    }
}
