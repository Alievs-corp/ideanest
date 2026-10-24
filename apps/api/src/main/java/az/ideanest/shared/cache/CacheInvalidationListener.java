package az.ideanest.shared.cache;

import az.ideanest.shared.outbox.OutboxMessage;
import az.ideanest.shared.project.ProjectSummaries;
import az.ideanest.shared.project.ProjectSummary;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Which published events make a cached public page wrong — issue #127.
 *
 * <h2>It reads one field by name, and does not import a single event class</h2>
 *
 * <p>Every event below belongs to a different module, and a cross-cutting concern that
 * imported {@code PledgeConfirmed}, {@code CommentPostedEvent} and four of {@code ProjectEvents}
 * would be a package with a dependency on half the service — which {@code ModuleBoundaryTests}
 * refuses, and rightly: nothing about invalidating a cache needs to know what a pledge is.
 *
 * <p>So this reads the payload as a tree and takes {@code projectId} if it is there, falling
 * back to the aggregate identifier when the aggregate <em>is</em> the campaign. That is
 * deliberately stringly-typed, and the reason it is acceptable is the same reason the whole
 * feature is a hint rather than a guarantee: a field that is renamed stops producing an
 * invalidation, and the far side's sixty-second window is what the page falls back to. The
 * failure mode is a page that is briefly stale, not a page that is wrong and a service that
 * crashed telling somebody about it.
 *
 * <h2>Which events, and why not the others</h2>
 *
 * <p>A campaign's public page is a statement about how much has been raised, by how many
 * people, and what its team has said. So: money arriving ({@code pledge.confirmed},
 * {@code pledge.collected}), the team speaking ({@code project.update_published}), the audience
 * speaking ({@code comment.posted}), and the campaign's own state changing.
 *
 * <p><strong>{@code project.approved} is not here</strong>, because the event is not the
 * publication. An approval that publishes the campaign (#552) also records
 * {@code project.launched}, which is, and one waiting for a launch time leaves a page that does
 * not exist yet and has no cache entry to drop.
 *
 * <p><strong>{@code pledge.edited} and the payment failures are not here either.</strong> A
 * pledge that changed or failed alters a total the public page shows, so on paper they qualify;
 * in practice they are the events most likely to arrive in bursts, and each one would evict a
 * campaign page for a change of a few manat in a figure rounded to the nearest whole one on
 * screen. The window covers them. The two that are here are the ones a backer watches for:
 * their own pledge appearing, and their own money moving.
 *
 * <h2>The feed is invalidated by membership, never by ordering</h2>
 *
 * <p>{@link CacheTags#DISCOVERY} goes with the three events that change which campaigns are in
 * the feed at all — a launch, and the two ways a campaign ends. Not with a pledge, which
 * changes only where a campaign sits in it: see {@link CacheTags#forCampaign} for what evicting
 * the feed on every pledge would cost.
 */
@Component
public class CacheInvalidationListener {

    private static final Logger log = LoggerFactory.getLogger(CacheInvalidationListener.class);

    /** Events about one campaign, where the public page is the only thing that goes stale. */
    private static final Set<String> CAMPAIGN_EVENTS = Set.of(
            "pledge.confirmed", "pledge.collected", "comment.posted", "project.update_published",
            "project.goal_reached");

    /** Events that change which campaigns are in the feed, rather than their order in it. */
    private static final Set<String> FEED_EVENTS =
            Set.of("project.launched", "project.succeeded", "project.unsuccessful");

    private final CacheInvalidator invalidator;
    private final ProjectSummaries campaigns;
    private final ObjectMapper json;

    public CacheInvalidationListener(
            CacheInvalidator invalidator, ProjectSummaries campaigns, ObjectMapper json) {
        this.invalidator = invalidator;
        this.campaigns = campaigns;
        this.json = json;
    }

    /**
     * Translates one event into tags and hands them over, ignoring every other event.
     *
     * <p>Synchronous like every other listener on this message, and safe to be: {@link
     * CacheInvalidator} queues rather than calls, and never throws. See its comment for why
     * throwing here would re-deliver an event whose real consumers had already succeeded.
     */
    @EventListener
    public void on(OutboxMessage message) {
        boolean campaign = CAMPAIGN_EVENTS.contains(message.eventType());
        boolean feed = FEED_EVENTS.contains(message.eventType());
        if (!campaign && !feed) {
            return;
        }

        UUID projectId = projectOf(message);
        if (projectId == null) {
            // Not an error worth failing over: the tag would have named a campaign nobody
            // could identify. Logged because a whole event type losing its `projectId` is a
            // contract change, and this is where it would first be visible.
            log.debug("No campaign on {}, so nothing to invalidate", message);
            return;
        }

        List<String> tags = new ArrayList<>(
                CacheTags.forCampaign(projectId, campaigns.summaryOf(projectId).orElse(null)));
        if (feed) {
            tags.add(CacheTags.DISCOVERY);
        }

        invalidator.invalidate(tags);
    }

    /**
     * The campaign this event is about, or null.
     *
     * <p>{@code projectId} from the payload first, because a pledge event's aggregate is the
     * pledge. The aggregate identifier second, for the events whose aggregate is already the
     * campaign — {@code CommentPostedEvent} explains why comments are keyed that way.
     */
    private UUID projectOf(OutboxMessage message) {
        UUID fromPayload = payloadProject(message);
        if (fromPayload != null) {
            return fromPayload;
        }
        return "project".equals(message.aggregateType()) ? message.aggregateId() : null;
    }

    private UUID payloadProject(OutboxMessage message) {
        /*
         * `tools.jackson`, not `com.fasterxml.jackson`. Spring Boot 4 ships Jackson 3 and
         * registers the bean under the new package; the old one is on the classpath as a
         * transitive dependency and is not a bean, so importing it takes the whole context
         * down at start-up with `ObjectMapper` reported missing.
         */
        try {
            JsonNode field = json.readTree(message.payload()).get("projectId");
            // `isString`/`stringValue`, not the Jackson 2 spellings: `isTextual` and `asText`
            // are deprecated in Jackson 3 and this build treats a warning as an error.
            return field == null || !field.isString() ? null : UUID.fromString(field.stringValue());
        } catch (JacksonException | IllegalArgumentException unreadable) {
            // A payload this cannot parse is one some other consumer can, and taking the
            // dispatch down over a cache hint is the failure this whole class avoids.
            return null;
        }
    }
}
