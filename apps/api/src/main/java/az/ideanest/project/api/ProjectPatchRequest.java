package az.ideanest.project.api;

import az.ideanest.project.application.ProjectPatch;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.Patched;
import tools.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * A partial edit of a campaign, with JSON Merge-Patch semantics (RFC 7396).
 *
 * <p>Every field is a {@link Patched}: a field the client did not mention is left
 * alone and a field explicitly set to {@code null} is cleared. The campaign editor
 * autosaves one field at a time, so a body containing only a title is the normal
 * case — and reading that as "set the title, clear everything else" would delete a
 * creator's work in a request that looks entirely ordinary in a log.
 *
 * <p>Bean validation annotations are deliberately absent. They cannot see inside a
 * {@code Patched}, and a rule enforced here as well as in
 * {@code ProjectEditingService} would be two rules that can disagree — with the
 * service's version being the one that also holds for every other caller. The
 * lengths and ranges of §5.3 are checked there, and in the database beneath it.
 *
 * @param story the rich-text document, as a tree. Validated against contract §5 by
 *     {@code StoryDocuments} on the editing service's path rather than here, so
 *     that the rule holds for every caller of that service and not only for
 *     requests that arrive through this controller
 * @param videoMediaId a ready video upload of the caller's, or null to remove the campaign's
 *     video — issue #331. An identifier only: the location, the poster and the length are
 *     facts the server measured
 */
public record ProjectPatchRequest(
        Patched<String> title,
        Patched<String> blurb,
        Patched<UUID> categoryId,
        Patched<UUID> subcategoryId,
        Patched<Money> goal,
        Patched<Integer> durationDays,
        Patched<Instant> scheduledLaunchAt,
        Patched<JsonNode> story,
        Patched<String> risks,
        Patched<CoverImageBody> coverImage,
        Patched<Boolean> latePledgeEnabled,
        Patched<UUID> videoMediaId) {

    public ProjectPatchRequest {
        // Absence is the neutral value, so a null component becomes absent rather
        // than "clear this field". See Patched: Jackson's absent hook already does
        // this, and this is the belt to its braces.
        title = Patched.orAbsent(title);
        blurb = Patched.orAbsent(blurb);
        categoryId = Patched.orAbsent(categoryId);
        subcategoryId = Patched.orAbsent(subcategoryId);
        goal = Patched.orAbsent(goal);
        durationDays = Patched.orAbsent(durationDays);
        scheduledLaunchAt = Patched.orAbsent(scheduledLaunchAt);
        story = Patched.orAbsent(story);
        risks = Patched.orAbsent(risks);
        coverImage = Patched.orAbsent(coverImage);
        latePledgeEnabled = Patched.orAbsent(latePledgeEnabled);
        videoMediaId = Patched.orAbsent(videoMediaId);
    }

    /**
     * The same edit, in the shape the application layer works in.
     *
     * <p>One conversion happens here: the cover image becomes the value object that
     * keeps its three columns together. It preserves the difference between
     * "absent" and "cleared", which is what {@link Patched#map} exists for.
     *
     * <p>The story crosses unchanged, as a tree. It used to be flattened to text
     * here, with a check that it was at least a JSON object; both moved to
     * {@code StoryDocuments}, which validates the whole document on the editing
     * service's path. Validating in this record would have put the rule in the HTTP
     * layer, where it holds for requests that arrive through this controller and for
     * nothing else.
     */
    public ProjectPatch toPatch() {
        return new ProjectPatch(
                title,
                blurb,
                categoryId,
                subcategoryId,
                goal,
                durationDays,
                scheduledLaunchAt,
                story,
                risks,
                coverImage.map(CoverImageBody::toSelection),
                latePledgeEnabled,
                videoMediaId);
    }
}
