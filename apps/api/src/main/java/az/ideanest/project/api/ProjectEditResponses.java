package az.ideanest.project.api;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.CampaignVideo;
import az.ideanest.project.domain.LockedField;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.shared.money.Money;
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

    public ProjectEditResponses(ObjectMapper json, MediaLibrary media) {
        this.json = json;
        this.media = media;
    }

    public ProjectEdit of(Project project) {
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
                project.getLaunchedAt(),
                project.getDeadline(),
                storyOf(project),
                project.getRisks(),
                CoverImageBody.of(project.getCoverImage()),
                videoOf(project),
                project.isLatePledgeEnabled(),
                // Null until the creator opens the window (#81), and the pair is why
                // both are on this response: the switch is the creator's standing
                // decision and the instant is the one window it is currently open for,
                // and a screen that showed only the first would say a campaign takes
                // late pledges when nothing is accepting them.
                project.getLatePledgeEndsAt(),
                // §5.3, read off the one table rather than recomputed here, and
                // filtered to the fields this response's own PATCH body has: a
                // reward's price is frozen by the same rule and is not on this
                // screen. See ProjectEditLocks.
                ProjectEditLocks.lockedFieldNamesIn(project.getState(), LockedField.Resource.PROJECT),
                project.getCreatedAt(),
                project.getUpdatedAt());
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
