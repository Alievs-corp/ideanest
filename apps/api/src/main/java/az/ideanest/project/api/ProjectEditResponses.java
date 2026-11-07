package az.ideanest.project.api;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditTrail;
import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.CampaignVideo;
import az.ideanest.project.application.ProjectRevisionService;
import az.ideanest.project.application.RewardWriting;
import az.ideanest.project.domain.LockedField;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

/**
 * The one place a campaign becomes a {@link ProjectEdit}.
 *
 * <p>Nine endpoints across two controllers return this response. Mapped in one
 * place so that a field added to the projection appears in all nine, rather than
 * in the ones somebody remembered — the failure that makes a client's state depend
 * on which request it happened to make last.
 *
 * <p>It is also where {@code lockedFields} is filled in: one method, one list, and
 * no endpoint to revisit. Every response that changes a campaign therefore carries
 * the current answer, including the one to the request that launched it — which is
 * the moment a client most needs to be told that the goal has just frozen.
 */
@Component
public class ProjectEditResponses {

    private final ObjectMapper json;

    /** Where the campaign's video is served from is the media module's to say (#331). */
    private final MediaLibrary media;

    private final ProjectRevisionService revisions;

    /** Where the clock's refusal to open a campaign is already written (#589). */
    private final AuditTrail audit;

    public ProjectEditResponses(
            ObjectMapper json, MediaLibrary media, ProjectRevisionService revisions, AuditTrail audit) {
        this.json = json;
        this.media = media;
        this.revisions = revisions;
        this.audit = audit;
    }

    public ProjectEdit of(Project project) {
        boolean launched = ProjectEditLocks.isLaunched(project.getState());
        return new ProjectEdit(
                project.getId(),
                project.getSlug(),
                project.getState().name(),
                project.getTitle(),
                project.getBlurb(),
                project.getCategoryId(),
                project.getSubcategoryId(),
                Money.orNull(project.getGoalAmount(), project.getCurrency()),
                project.getDurationDays(),
                project.getScheduledLaunchAt(),
                scheduledLaunchRefusedAt(project),
                project.getLaunchedAt(),
                project.getDeadline(),
                storyOf(project),
                project.getRisks(),
                CoverImageBody.of(project.getCoverImage()),
                videoOf(project),
                project.getCountries(),
                // §5.3, read off the one table rather than recomputed here, and
                // filtered to the fields this response's own PATCH body has: a
                // reward's price is frozen by the same rule and is not on this
                // screen. See ProjectEditLocks.
                ProjectEditLocks.lockedFieldNamesIn(project.getState(), LockedField.Resource.PROJECT),
                launched ? revisions.summaryOf(project.getId()).map(RevisionBody::of).orElse(null) : null,
                launched ? revisions.latestRejection(project.getId()).map(RevisionRejectionBody::of).orElse(null) : null,
                project.getCreatedAt(),
                project.getUpdatedAt());
    }

    /**
     * When the clock last refused to open this campaign at its launch time, while that is still why
     * it is not opening — #589.
     *
     * <p>The refusal clears the launch time and leaves the campaign approved (#587), so the editor
     * sees a campaign that simply has no launch time any more. The notification says why once; this
     * is what lets the review tab keep saying it for as long as it is true.
     *
     * <p><strong>Read from the audit row, not stored on the campaign.</strong> The refusal is
     * recorded in the transaction that clears the time, so the row exists exactly when the
     * refusal happened, and a column would be a second copy of it. What the row cannot say is
     * whether the creator has answered it, and the campaign can: a launch time set again, or a
     * campaign opened, is the answer, and either ends this. A creator who sets a time and clears
     * it again by hand is shown the refusal again — still true, and still the last thing that
     * stopped the campaign opening on its own.
     *
     * <p>Asked only of an approved campaign with no launch time, so the autosaves of every other
     * campaign do not pay for a query whose answer is known to be null.
     */
    private Instant scheduledLaunchRefusedAt(Project project) {
        ProjectState state = project.getState();
        if ((state != ProjectState.APPROVED && state != ProjectState.SCHEDULED)
                || project.getScheduledLaunchAt() != null) {
            return null;
        }
        return audit.lastRecorded(AuditAction.PROJECT_SCHEDULED_LAUNCH_REFUSED, project.getId())
                .orElse(null);
    }

    /**
     * The reward tiers a revision touches, with their pictures and clips resolved in two
     * queries and their items and zones named.
     */
    public List<RevisionRewardBody> rewardsOf(List<ProjectRevisionService.RewardChange> changes, Map<UUID, String> names) {
        List<RewardWriting> writings = changes.stream()
                .flatMap(change -> Stream.of(change.live(), change.proposed()))
                .filter(Objects::nonNull)
                .toList();
        Map<UUID, MediaLibrary.MediaView> images = media.viewsOf(writings.stream()
                .map(RewardWriting::imageMediaId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
        Map<UUID, MediaLibrary.VideoView> videos = media.videoViewsOf(writings.stream()
                .map(RewardWriting::videoMediaId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
        return changes.stream()
                .map(change -> new RevisionRewardBody(
                        change.rewardId(),
                        change.changes(),
                        change.livePosition(),
                        change.proposedPosition(),
                        change.price(),
                        change.changedFields(),
                        writingOf(change.live(), images, videos, names),
                        writingOf(change.proposed(), images, videos, names)))
                .toList();
    }

    private static RevisionRewardBody.RevisionRewardWriting writingOf(
            RewardWriting writing,
            Map<UUID, MediaLibrary.MediaView> images,
            Map<UUID, MediaLibrary.VideoView> videos,
            Map<UUID, String> names) {
        if (writing == null) {
            return null;
        }
        MediaLibrary.MediaView image = writing.imageMediaId() == null ? null : images.get(writing.imageMediaId());
        MediaLibrary.VideoView video = writing.videoMediaId() == null ? null : videos.get(writing.videoMediaId());
        return new RevisionRewardBody.RevisionRewardWriting(
                writing.title(),
                writing.description(),
                image == null
                        ? null
                        : new RevisionRewardBody.RevisionRewardImage(
                                image.id(), image.url(), image.width(), image.height(), image.blurDataUrl()),
                video == null ? null : CampaignVideoBody.of(CampaignVideo.of(video)),
                writing.estimatedDelivery(),
                writing.limitQuantity(),
                writing.shippingType(),
                writing.earlyBird(),
                writing.featured(),
                writing.secret(),
                writing.addon(),
                writing.availableFrom(),
                writing.availableUntil(),
                writing.items().stream()
                        .map(line -> new RevisionRewardBody.RevisionRewardItem(
                                line.itemId(), names.get(line.itemId()), line.quantity()))
                        .toList(),
                writing.shippingRules().stream()
                        .map(rate -> new RevisionRewardBody.RevisionShippingRule(
                                rate.countryCode(), rate.amount(), rate.additionalItemAmount(), rate.perKilogramAmount()))
                        .toList(),
                writing.zoneRates().stream()
                        .map(rate -> new RevisionRewardBody.RevisionShippingZoneRate(
                                rate.zoneId(),
                                names.get(rate.zoneId()),
                                rate.amount(),
                                rate.additionalItemAmount(),
                                rate.perKilogramAmount()))
                        .toList());
    }

    private CampaignVideoBody videoOf(Project project) {
        if (project.getVideoMediaId() == null) {
            return null;
        }
        return media.videoViewOf(project.getVideoMediaId())
                .map(view -> CampaignVideoBody.of(CampaignVideo.of(view)))
                .orElse(null);
    }

    /**
     * The story document as JSON, not as a string containing JSON.
     *
     * <p>The column is {@code jsonb} and the entity holds it as text, so this is a
     * parse rather than a conversion. Returning the text would put a quoted,
     * escaped document in the response and make every client parse it a second
     * time — and the first client to forget would render the escapes.
     */
    private JsonNode storyOf(Project project) {
        String story = project.getStory();
        if (story == null) {
            return null;
        }
        try {
            return json.readTree(story);
        } catch (JacksonException e) {
            // Unreachable: PostgreSQL validates jsonb on the way in, so a row that
            // fails here has been written by something that bypassed the column
            // type. Serving it as though it were fine would spread the problem.
            throw new IllegalStateException("Project " + project.getId() + " holds a story that is not JSON", e);
        }
    }
}
