package az.ideanest.project.domain;

import java.util.ArrayList;
import java.util.List;
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
 * @param story the story document, or null
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
        List<String> countries) {

    public static final String TITLE = "title";
    public static final String BLURB = "blurb";
    public static final String CATEGORY = "category";
    public static final String STORY = "story";
    public static final String RISKS = "risks";
    public static final String COVER_IMAGE = "coverImage";
    public static final String VIDEO = "videoMediaId";
    public static final String COUNTRIES = "countries";

    public RevisionContent {
        countries = List.copyOf(countries);
    }

    /** The content a campaign shows now. */
    public static RevisionContent of(Project project, JsonNode story) {
        return new RevisionContent(
                project.getTitle(),
                project.getBlurb(),
                project.getCategoryId(),
                project.getSubcategoryId(),
                story,
                project.getRisks(),
                project.getCoverImage(),
                project.getVideoMediaId(),
                project.getCountries());
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

    /** The names of the fields in which this content differs from {@code other}, in a stable order. */
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
        return List.copyOf(changed);
    }
}
