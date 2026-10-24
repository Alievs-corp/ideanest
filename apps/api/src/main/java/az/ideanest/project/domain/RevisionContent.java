package az.ideanest.project.domain;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * The writing on a campaign that a creator may change after launch, as one document.
 *
 * <p>A revision holds all of it rather than the fields that changed: the editor shows a
 * whole campaign, a moderator compares a whole campaign, and approval copies a whole
 * campaign across. Nothing else writes these fields while a revision is open, so there is
 * no later state for a diff to be replayed against.
 *
 * <p>The goal, duration, launch time and reward prices are not here. They are frozen at
 * launch ({@link ProjectEditLocks}) and never need a reviewer.
 *
 * <p><strong>The reward tiers are the exception to "all of it" (#559).</strong> A tier can be
 * created, deleted and reordered while a revision is open, so a revision cannot hold the
 * whole list. It holds the writing of the tiers the creator changed, by tier, and nothing for
 * the others; the live content holds every tier's. A tier that has gone since is ignored.
 *
 * @param story the story document, or null
 * @param rewards the writing of reward tiers, by tier: in a revision, the tiers it changes;
 *     in the live content, every tier, in display order. Absent from revisions written
 *     before #559
 */
public record RevisionContent(
        String title,
        String blurb,
        UUID categoryId,
        UUID subcategoryId,
        JsonNode story,
        String risks,
        CoverImage coverImage,
        UUID videoMediaId,
        List<String> countries,
        Map<UUID, Reward> rewards) {

    public static final String TITLE = "title";
    public static final String BLURB = "blurb";
    public static final String CATEGORY = "category";
    public static final String STORY = "story";
    public static final String RISKS = "risks";
    public static final String COVER_IMAGE = "coverImage";
    public static final String VIDEO = "videoMediaId";
    public static final String COUNTRIES = "countries";
    public static final String REWARDS = "rewards";

    /**
     * What a backer reads and sees on a reward tier. Its price, quantity, shipping and the
     * rest are the tier's own and change without review; the price and a lower quantity do
     * not change at all.
     */
    public record Reward(String title, String description, UUID imageMediaId, UUID videoMediaId) {}

    public RevisionContent {
        countries = List.copyOf(countries);
        rewards = rewards == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(rewards));
    }

    /** The content a campaign shows now, with every tier's writing. */
    public static RevisionContent of(Project project, JsonNode story, Map<UUID, Reward> rewards) {
        return new RevisionContent(
                project.getTitle(),
                project.getBlurb(),
                project.getCategoryId(),
                project.getSubcategoryId(),
                story,
                project.getRisks(),
                project.getCoverImage(),
                project.getVideoMediaId(),
                project.getCountries(),
                rewards);
    }

    /** This content with one tier's writing replaced. */
    public RevisionContent withReward(UUID rewardId, Reward reward) {
        Map<UUID, Reward> changed = new LinkedHashMap<>(rewards);
        changed.put(rewardId, reward);
        return new RevisionContent(
                title, blurb, categoryId, subcategoryId, story, risks, coverImage, videoMediaId, countries, changed);
    }

    /**
     * This content keeping only the tier writing that would change {@code live}: a tier that
     * has been deleted, or whose writing is what it shows already, is dropped.
     */
    public RevisionContent heldAgainst(RevisionContent live) {
        Map<UUID, Reward> held = new LinkedHashMap<>();
        for (UUID rewardId : changedRewardsFrom(live)) {
            held.put(rewardId, rewards.get(rewardId));
        }
        return new RevisionContent(
                title, blurb, categoryId, subcategoryId, story, risks, coverImage, videoMediaId, countries, held);
    }

    /** The tiers, among those {@code live} has, whose writing this content changes, in {@code live}'s order. */
    public List<UUID> changedRewardsFrom(RevisionContent live) {
        return live.rewards.entrySet().stream()
                .filter(entry -> rewards.containsKey(entry.getKey())
                        && !rewards.get(entry.getKey()).equals(entry.getValue()))
                .map(Map.Entry::getKey)
                .toList();
    }

    /**
     * Writes this content onto the campaign's fields, and nothing else.
     *
     * <p>Plain assignment: the checks happened when the creator saved, and the side effects
     * of a change (a story version, releasing a replaced video) belong to the caller, which
     * knows whether the instance it holds is the campaign or a copy of it.
     */
    public void copyOnto(Project project) {
        project.setTitle(title);
        project.setBlurb(blurb);
        project.file(categoryId, subcategoryId);
        project.setStory(story == null || story.isNull() ? null : story.toString());
        project.setRisks(risks);
        project.setCoverImage(coverImage);
        project.setVideoMediaId(videoMediaId);
        project.setCountries(countries);
    }

    /**
     * The names of the fields in which this content differs from {@code other}, in a stable order.
     * {@code rewards} compares as {@link #changedRewardsFrom} does, so {@code other} is the live
     * content.
     */
    public List<String> changedFrom(RevisionContent other) {
        List<String> changed = new ArrayList<>();
        if (!Objects.equals(title, other.title)) {
            changed.add(TITLE);
        }
        if (!Objects.equals(blurb, other.blurb)) {
            changed.add(BLURB);
        }
        if (!Objects.equals(categoryId, other.categoryId) || !Objects.equals(subcategoryId, other.subcategoryId)) {
            changed.add(CATEGORY);
        }
        if (!StoryDocuments.isSameDocument(story, other.story)) {
            changed.add(STORY);
        }
        if (!Objects.equals(risks, other.risks)) {
            changed.add(RISKS);
        }
        if (!Objects.equals(coverImage, other.coverImage)) {
            changed.add(COVER_IMAGE);
        }
        if (!Objects.equals(videoMediaId, other.videoMediaId)) {
            changed.add(VIDEO);
        }
        if (!countries.equals(other.countries)) {
            changed.add(COUNTRIES);
        }
        if (!changedRewardsFrom(other).isEmpty()) {
            changed.add(REWARDS);
        }
        return List.copyOf(changed);
    }
}
