package az.ideanest.project.application;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.domain.Capability;
import az.ideanest.project.domain.CoverImage;
import az.ideanest.project.domain.LockedField;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.StoryDocuments;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.project.infrastructure.SubcategoryRepository;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.Patched;
import az.ideanest.shared.Slugs;
import tools.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creating a campaign and editing its basics.
 *
 * <p>Everything except the state, which is {@link ProjectTransitionService} and
 * only that. The split is the point: a service that could both edit a field and
 * move a state would eventually do both in one method, and the audit row would
 * become a thing that describes some of the change.
 *
 * <p><strong>Validation is here as well as in the database.</strong> Every rule
 * below is also a check constraint on {@code projects}. The constraint is what
 * holds against a support query, a bulk import, and a bug; this is what turns the
 * same rule into a 400 naming the field, because a constraint violation reaches
 * the client as a 500 and tells them nothing they can act on.
 *
 * <p><strong>Which fields are editable in which state is not decided here.</strong>
 * {@link ProjectEditLocks} is the table, in {@code domain}, and this service asks
 * it — the same table {@code RewardService} asks about a tier's price, and the same
 * one {@code ProjectEditResponses} turns into the {@code lockedFields} a client
 * reads. A launched campaign's goal, duration, and scheduled launch are refused
 * here with a 409 before a single field is applied; see
 * {@link #requireNothingLocked}.
 */
@Service
public class ProjectEditingService {

    /** §5.3. Also {@code projects_title_length}. */
    private static final int TITLE_MAX = 60;

    /** §5.3. Also {@code projects_blurb_length}. */
    private static final int BLURB_MAX = 135;

    /** §5.3: 1-60 days, 30 recommended. Also {@code projects_duration_in_range}. */
    private static final int DURATION_MIN = 1;

    private static final int DURATION_MAX = 60;

    /**
     * How many numbered slugs to try before falling back to a random suffix. The
     * same reasoning as {@code UserAccounts}: a creator with ten drafts called
     * "Untitled" gets readable URLs, and the eleventh gets an unreadable one
     * rather than a query loop that grows with their indecision.
     */
    private static final int SLUG_ATTEMPTS = 10;

    /** Leaves room for a suffix inside the eighty-character column limit. */
    private static final int SLUG_BASE_LIMIT = 60;

    /** When a title folds to nothing this can transliterate. */
    private static final String SLUG_FALLBACK = "project";

    /**
     * The only currency the platform settles in today. A creator-selectable
     * currency needs a rate source, a payout account per currency, and a decision
     * about which one the fee is taken in; none of that exists, so the goal's
     * currency is accepted from the client and refused if it is anything else,
     * rather than being silently ignored.
     */
    private static final String SUPPORTED_CURRENCY = "AZN";

    private final ProjectRepository projects;
    private final CategoryRepository categories;
    private final SubcategoryRepository subcategories;
    private final ProjectAccess access;
    private final ProjectTransitionService transitions;
    private final StoryVersionService storyVersions;

    /**
     * The media module, reached through its application layer -- which is the only part of it
     * this module may name. {@code ModuleBoundaryTests} refuses a reference to its
     * {@code domain} or {@code infrastructure} packages, and that rule is why the cover is
     * resolved through a service call rather than a JPA association.
     */
    private final MediaLibrary media;

    public ProjectEditingService(
            ProjectRepository projects,
            CategoryRepository categories,
            SubcategoryRepository subcategories,
            ProjectAccess access,
            ProjectTransitionService transitions,
            StoryVersionService storyVersions,
            MediaLibrary media) {
        this.projects = projects;
        this.categories = categories;
        this.subcategories = subcategories;
        this.access = access;
        this.transitions = transitions;
        this.storyVersions = storyVersions;
        this.media = media;
    }

    /**
     * Opens a draft with a title and nothing else.
     *
     * <p>The editor is reached by creating the campaign, so this is the one write
     * that cannot demand a complete campaign. Everything §5.3 requires is filled in
     * afterwards, and the checklist (#37) is what refuses to submit an incomplete
     * one.
     *
     * <p>The creation audit row is written in this transaction, by the transition
     * service, so a campaign and the first line of its history exist together or
     * not at all.
     */
    @Transactional
    public Project create(UUID creatorId, String title) {
        String trimmed = requireTitle(title);
        Project project = Project.open(creatorId, trimmed, allocateSlug(creatorId, trimmed), SUPPORTED_CURRENCY);

        Project saved = projects.save(project);
        transitions.recordCreation(saved);
        return saved;
    }

    /** The campaign as its creator edits it. Refuses anybody else; see {@link ProjectAccess}. */
    @Transactional(readOnly = true)
    public Project forEdit(UUID projectId, UUID accountId) {
        return access.requireEditable(projectId, accountId);
    }

    /**
     * Applies a partial edit.
     *
     * <p>Field by field, and only the fields the client mentioned. The slug is
     * deliberately <em>not</em> recomputed when the title changes: it is in the
     * campaign's public URL, and a URL that changes when a typo is fixed breaks
     * every link anybody has already shared.
     *
     * <p>The locked fields are checked before anything is applied, so a body that
     * moves the title and the goal of a live campaign changes neither. A patch is
     * one save in the creator's mind; half of one is worse than none.
     */
    @Transactional
    public Project edit(UUID projectId, UUID accountId, ProjectPatch patch) {
        Project project = access.requireEditableForAll(projectId, accountId, capabilitiesFor(patch));
        requireNothingLocked(project, patch);

        patch.title().ifPresent(title -> project.setTitle(requireTitle(title)));
        patch.blurb().ifPresent(blurb -> project.setBlurb(withinLength("blurb", blurb, BLURB_MAX)));
        patch.risks().ifPresent(risks -> project.setRisks(blankAsNull(risks)));
        patch.story().ifPresent(story -> applyStory(project, accountId, story));
        patch.scheduledLaunchAt().ifPresent(project::setScheduledLaunchAt);
        patch.coverImage().ifPresent(selection -> project.setCoverImage(resolveCover(selection, accountId)));
        patch.videoMediaId().ifPresent(mediaId -> replaceVideo(project, accountId, mediaId));
        patch.latePledgeEnabled()
                .ifPresent(enabled -> project.setLatePledgeEnabled(requireBoolean(enabled)));
        patch.durationDays().ifPresent(days -> project.setDurationDays(validDuration(days)));
        patch.goal().ifPresent(goal -> applyGoal(project, goal));

        if (patch.refilesTheProject()) {
            refile(project, patch);
        }

        return project;
    }

    /**
     * Turns what the creator chose into the cover that is stored.
     *
     * <p>For an upload this is where the numbers come from. {@code MediaLibrary} answers with
     * the identifiers that are <em>this creator's</em> and have <em>finished processing</em>,
     * and anything else is refused as a field error rather than silently ignored — a cover
     * that quietly did not change is worse than one that would not save, because the creator
     * finds out when the campaign is live.
     *
     * <p>Refusing an upload that is still processing rather than waiting for it is
     * deliberate. The editor polls the media endpoint and knows when the image is ready; a
     * save that blocked on a transcode would hold a transaction open for the length of one.
     *
     * @throws ProjectFieldRejectedException when the upload is not this creator's, does not
     *     exist, or has not finished
     */
    private CoverImage resolveCover(CoverImageSelection selection, UUID accountId) {
        if (selection == null) {
            /*
             * `{"coverImage": null}` -- the creator removed the cover, which is a present
             * field with a null value rather than an absent one. `Patched` keeps the two
             * apart and this is the whole reason it does.
             *
             * The null check is not defensive. A `switch` over a sealed type throws on null
             * in Java 21, so before this line removing a cover answered 500 -- caught by
             * ProjectChecklistApiTests, which patches `coverImage` to null to break the
             * COVER_IMAGE rule.
             */
            return null;
        }
        return switch (selection) {
            case CoverImageSelection.FromUrl typed ->
                new CoverImage(typed.url(), typed.width(), typed.height());
            case CoverImageSelection.FromUpload upload -> {
                if (!media.claimForOwner(accountId, Set.of(upload.mediaId())).contains(upload.mediaId())) {
                    throw new ProjectFieldRejectedException(
                            "coverImage", "That upload is not available. It may still be processing.");
                }
                MediaLibrary.MediaView view = media.viewOf(upload.mediaId())
                        .orElseThrow(() -> new ProjectFieldRejectedException(
                                "coverImage", "That upload is not available. It may still be processing."));
                yield new CoverImage(view.url(), view.width(), view.height(), view.id());
            }
        };
    }

    /**
     * Attaches, replaces or removes the campaign's video — issue #331.
     *
     * <p>Refused unless the upload is this caller's, is a video, and has finished
     * processing, for {@link #resolveCover}'s reasons.
     *
     * <p><strong>The video it replaces is deleted</strong>, once this edit commits and only
     * if no other campaign refers to it. One campaign has one video; keeping the previous one
     * would be storage spent on a file nobody can reach. Media rows are created before they
     * are attached, so a reupload of the same campaign is the ordinary way an orphan appears.
     */
    private void replaceVideo(Project project, UUID accountId, UUID mediaId) {
        UUID previous = project.getVideoMediaId();
        if (Objects.equals(previous, mediaId)) {
            return;
        }
        if (mediaId != null && !media.claimVideoForOwner(accountId, mediaId)) {
            throw new ProjectFieldRejectedException(
                    "videoMediaId", "That video is not available. It may still be processing.");
        }
        project.setVideoMediaId(mediaId);

        if (previous != null && !projects.existsByVideoMediaIdAndIdNot(previous, project.getId())) {
            media.discardAfterCommit(previous);
        }
    }

    /**
     * What a patch has to be authorised for, read off the fields it mentions.
     *
     * <p>One endpoint carries the basics, the story, and the risks section, so the
     * body is the only thing that says which grant a request needs. Without this
     * the three editing capabilities would be one capability with three names: a
     * collaborator invited to write the story could move the funding goal, and the
     * checkboxes an inviter ticked would not mean what they say.
     *
     * <p>The risks section counts as the story rather than as the basics. It is
     * prose, it sits in the story tab, and §5.3 pairs the two as the writing a
     * submission needs.
     *
     * <p>Derived from {@link Patched#isPresent()}, which is "the client mentioned
     * this field" — including mentioning it as null to clear it. Clearing a blurb
     * is editing the basics.
     */
    private static Set<Capability> capabilitiesFor(ProjectPatch patch) {
        Set<Capability> needed = EnumSet.noneOf(Capability.class);

        if (patch.story().isPresent() || patch.risks().isPresent()) {
            needed.add(Capability.EDIT_STORY);
        }
        if (patch.title().isPresent()
                || patch.blurb().isPresent()
                || patch.categoryId().isPresent()
                || patch.subcategoryId().isPresent()
                || patch.goal().isPresent()
                || patch.durationDays().isPresent()
                || patch.scheduledLaunchAt().isPresent()
                || patch.coverImage().isPresent()
                || patch.videoMediaId().isPresent()
                || patch.latePledgeEnabled().isPresent()) {
            needed.add(Capability.EDIT_BASICS);
        }
        return needed;
    }

    /**
     * The story: validated, preserved, then stored.
     *
     * <p><strong>In that order, and all three on the autosave path.</strong> The
     * story arrives through {@code PATCH /v1/projects/{id}} like every other field
     * (contract §5), so this is the only place a story is written and therefore the
     * only place the three have to be arranged correctly.
     *
     * <p>Validation first, because a document the service will not store is not
     * worth a version. Preservation second, while {@link Project#getStory()} still
     * holds the previous document, since {@code recordIfDue} decides by comparing
     * what is arriving against what was last kept. Storage last.
     *
     * <p>{@code StoryDocuments} is a pure type in {@code domain} rather than a check
     * written inline here: the schema is a table of rules, and a table of rules is
     * worth testing without a Spring context, a database, and an HTTP request in
     * front of it.
     */
    private void applyStory(Project project, UUID accountId, JsonNode story) {
        StoryDocuments.validate(story);
        storyVersions.recordIfDue(project, story, accountId);
        // Text into a jsonb column, exactly as it arrived. Serialising the tree
        // rather than the raw request body means what is stored is what was
        // validated, with nothing between the two.
        project.setStory(story == null ? null : story.toString());
    }

    /**
     * The goal, which is an amount and the currency it is in at once.
     *
     * <p>One field rather than two because they only mean anything together: a
     * currency changed without the amount reprices the campaign, and §10.3 sends
     * money as a pair for exactly that reason.
     */
    private void applyGoal(Project project, Money goal) {
        if (goal == null) {
            // Clearing it is a change to it, and a launched campaign was refused
            // before any of this ran. What reaches here is a draft being emptied.
            project.setGoalAmount(null);
            return;
        }
        if (goal.amount().compareTo(BigDecimal.ZERO) <= 0) {
            // A goal of zero is met before it is announced. §5.3 leaves the real
            // minimum and maximum to configuration, and #37 checks the campaign
            // against them; this is the bound below which the number is not a goal
            // at all.
            throw new ProjectFieldRejectedException("goal", "A funding goal is more than zero.");
        }
        if (!SUPPORTED_CURRENCY.equals(goal.currency())) {
            throw new ProjectFieldRejectedException(
                    "goal", "Campaigns are funded in " + SUPPORTED_CURRENCY + " for now.");
        }
        project.setGoalAmount(goal.amount());
        project.setCurrency(goal.currency());
    }

    private static Integer validDuration(Integer days) {
        if (days == null) {
            // As with the goal: a launched campaign never reaches here.
            return null;
        }
        if (days < DURATION_MIN || days > DURATION_MAX) {
            throw new ProjectFieldRejectedException(
                    "durationDays", "A campaign runs for between " + DURATION_MIN + " and " + DURATION_MAX + " days.");
        }
        return days;
    }

    /**
     * Files the campaign, keeping the category and the subcategory consistent.
     *
     * <p>A body that changes the category without mentioning the subcategory clears
     * the subcategory. The alternative — keeping it — would leave "Tabletop games"
     * under "Technology", which the database refuses outright; and silently keeping
     * a subcategory the creator did not re-choose is worse than clearing one they
     * can see is gone.
     */
    private void refile(Project project, ProjectPatch patch) {
        UUID categoryId =
                patch.categoryId().isPresent() ? patch.categoryId().value() : project.getCategoryId();

        UUID subcategoryId;
        if (patch.subcategoryId().isPresent()) {
            subcategoryId = patch.subcategoryId().value();
        } else if (patch.categoryId().isPresent()) {
            subcategoryId = null;
        } else {
            subcategoryId = project.getSubcategoryId();
        }

        if (categoryId == null && subcategoryId != null) {
            throw new ProjectFieldRejectedException(
                    "subcategoryId", "A subcategory needs the category it belongs to.");
        }
        if (categoryId != null && !categories.existsById(categoryId)) {
            throw new ProjectFieldRejectedException("categoryId", "That category does not exist.");
        }
        if (subcategoryId != null && !subcategories.existsByIdAndParentId(subcategoryId, categoryId)) {
            // Checked rather than left to the composite foreign key, which would
            // answer the same question with a 500.
            throw new ProjectFieldRejectedException(
                    "subcategoryId", "That subcategory is not part of the selected category.");
        }

        project.file(categoryId, subcategoryId);
    }

    /**
     * §5.3, for a whole patch, before any of it is applied.
     *
     * <p><strong>Mentioning a locked field is enough.</strong> A body carrying
     * {@code "goal": {"amount": "5000.00", ...}} on a live campaign is refused even
     * when that is the goal it already has. Merge-patch says a key that is present
     * is a write, and the alternative — comparing the value against the stored one —
     * would make the rule depend on how a number was serialised, so that
     * {@code "5000"} and {@code "5000.00"} were different edits. The editor sends one
     * field at a time and never sends a field it has been told is locked, so this
     * costs a well-behaved client nothing.
     *
     * <p>This subsumes the older check that a launched campaign could not have its
     * goal or duration <em>removed</em> — the case
     * {@code projects_public_states_are_fully_specified} refuses outright, which
     * would otherwise have reached the client as a 500. Clearing a field is a change
     * to it, so the general rule covers the narrow one, and the two are not left to
     * drift apart.
     */
    private static void requireNothingLocked(Project project, ProjectPatch patch) {
        ProjectState state = project.getState();

        if (patch.goal().isPresent() && ProjectEditLocks.locks(state, LockedField.GOAL)) {
            throw new ProjectFieldLockedException(LockedField.GOAL, state);
        }
        if (patch.durationDays().isPresent() && ProjectEditLocks.locks(state, LockedField.DURATION_DAYS)) {
            throw new ProjectFieldLockedException(LockedField.DURATION_DAYS, state);
        }
        if (patch.scheduledLaunchAt().isPresent()
                && ProjectEditLocks.locks(state, LockedField.SCHEDULED_LAUNCH_AT)) {
            throw new ProjectFieldLockedException(LockedField.SCHEDULED_LAUNCH_AT, state);
        }
    }

    private static String requireTitle(String title) {
        String trimmed = title == null ? "" : title.trim();
        if (trimmed.isEmpty()) {
            // Not clearable: the column is NOT NULL, and a campaign with no title
            // cannot be listed anywhere. A client sending null here is trying to
            // clear a required field, which is a different mistake from omitting it.
            throw new ProjectFieldRejectedException("title", "A campaign needs a title.");
        }
        return withinLength("title", trimmed, TITLE_MAX);
    }

    private static String withinLength(String field, String value, int max) {
        String normalised = blankAsNull(value);
        if (normalised != null && normalised.length() > max) {
            throw new ProjectFieldRejectedException(
                    field, "That is longer than " + max + " characters.");
        }
        return normalised;
    }

    /**
     * Treats an empty string as an absent value.
     *
     * <p>A creator who empties a textarea sends {@code ""}, not {@code null}. The
     * database refuses a blank summary — a zero-length string is not a summary —
     * and answering an autosave with a 400 for clearing a field is a worse
     * experience than storing what the creator plainly meant.
     */
    private static String blankAsNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static boolean requireBoolean(Boolean value) {
        if (value == null) {
            throw new ProjectFieldRejectedException("latePledgeEnabled", "Late pledging is either on or off.");
        }
        return value;
    }

    /**
     * A readable slug that is free for this creator.
     *
     * <p>Scoped to the creator because the unique index is: two creators may both
     * launch a "coffee-table-book". Past the numbered attempts this stops asking and
     * appends randomness — the unique index is still the check that cannot lose a
     * race, so the pathological case is a retry rather than a duplicate.
     */
    private String allocateSlug(UUID creatorId, String title) {
        String base = Slugs.slugify(title);
        if (base.isEmpty()) {
            // A title written entirely in a script Slugs does not transliterate.
            base = SLUG_FALLBACK;
        }
        if (base.length() > SLUG_BASE_LIMIT) {
            base = trimTrailingHyphen(base.substring(0, SLUG_BASE_LIMIT));
        }

        // A reserved word is never free: it is a route, not an address (Slugs.RESERVED).
        if (!Slugs.isReserved(base) && !projects.existsByCreatorIdAndSlug(creatorId, base)) {
            return base;
        }
        for (int suffix = 2; suffix <= SLUG_ATTEMPTS; suffix++) {
            String candidate = base + "-" + suffix;
            if (!projects.existsByCreatorIdAndSlug(creatorId, candidate)) {
                return candidate;
            }
        }
        return base + "-" + Long.toString(Math.abs(UUID.randomUUID().getMostSignificantBits()), 36);
    }

    private static String trimTrailingHyphen(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '-') {
            end--;
        }
        return value.substring(0, end);
    }
}
