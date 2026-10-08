package az.ideanest.project.application;

import az.ideanest.project.domain.CoverImage;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.Patched;
import tools.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * A partial edit of a campaign's basics.
 *
 * <p>Every field is a {@link Patched} because the campaign editor autosaves: a
 * body containing only the title must leave the summary alone, and one containing
 * {@code "blurb": null} must clear it. See {@link Patched} for why
 * {@link java.util.Optional} cannot express that.
 *
 * <p>The story is a JSON tree rather than the text that reaches the column.
 * {@code StoryDocuments} validates it and {@code StoryVersionService} compares it
 * against the newest stored version, and both of those are questions about a
 * document rather than about a string — key order and whitespace are not edits.
 * The conversion to text happens once, in {@link ProjectEditingService}, at the
 * point the validated document is stored.
 *
 * <p>Fields that belong to other issues are deliberately absent: the pre-launch
 * page (#39) and collaborators (#38) are transitions and grants rather than
 * basics, and neither is edited through this record.
 */
public record ProjectPatch(
        Patched<String> title,
        Patched<String> blurb,
        Patched<UUID> categoryId,
        Patched<UUID> subcategoryId,
        Patched<Money> goal,
        Patched<Integer> durationDays,
        Patched<Instant> scheduledLaunchAt,
        Patched<JsonNode> story,
        Patched<String> risks,
        Patched<CoverImageSelection> coverImage,
        Patched<Boolean> latePledgeEnabled,
        Patched<UUID> videoMediaId) {

    public ProjectPatch {
        // Absence, not null, is the neutral value. Normalised here so that no
        // caller — including a Jackson version that stops consulting the absent
        // hook — can produce a patch that reads as "clear everything".
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
     * Whether the category and subcategory move together.
     *
     * <p>They have to: the database refuses a subcategory whose parent is not the
     * campaign's category, so a body that changes one without mentioning the other
     * is a body whose result depends on what was stored. The editor sends both.
     */
    public boolean refilesTheProject() {
        return categoryId.isPresent() || subcategoryId.isPresent();
    }
}
