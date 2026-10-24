package az.ideanest.project.application;

import az.ideanest.project.ProjectProperties;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.StoryDocuments;
import az.ideanest.project.domain.StoryVersion;
import az.ideanest.project.infrastructure.StoryVersionRepository;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The story's editing history: writing it, reading it, and restoring from it.
 *
 * <p><strong>The write is not an endpoint.</strong> The story is saved through
 * {@code PATCH /v1/projects/{id}} like every other field (contract §5), so
 * {@link #recordIfDue} is called by {@link ProjectEditingService} on that path.
 * A separate "save a version" call would be a second way to write a story, and
 * the two would eventually disagree about which document version 7 holds.
 *
 * <p><strong>Why a version is not written on every save.</strong> The editor
 * autosaves a few hundred milliseconds after somebody stops typing, so a version
 * per save is one row per sentence — several thousand {@code jsonb} documents for
 * an afternoon's work, and a history whose entries differ by one word each. The
 * rule is therefore: a version is written when the story actually changed
 * <em>and</em> the newest version is older than
 * {@code ideanest.project.story.version-interval}. That turns continuous typing
 * into one row every five minutes, which is a list a person can read and a loss of
 * at most five minutes of writing.
 *
 * <p>The comparison is between documents rather than between strings — see
 * {@link StoryDocuments#isSameDocument} — so a client that reordered two keys has
 * not changed anything and does not gain a row claiming it did.
 *
 * <p><strong>A version holds the document as it now is</strong>, not the one it
 * replaced. The newest version is therefore usually a copy of
 * {@code projects.story}, and restoring version <em>n</em> means "make the story
 * what it was at version <em>n</em>". Storing the previous document instead would
 * be off by one everywhere it is read: the number beside a timestamp would
 * describe the writing that existed before that moment, which is not what
 * "version 7, 14:32" means to anybody looking at a list.
 */
@Service
public class StoryVersionService {

    /**
     * A mapper for reading stored documents back into trees.
     *
     * <p>Its own instance rather than the application's injected one. This reads
     * text PostgreSQL has already validated as JSON, and it has to behave
     * identically regardless of how the HTTP layer's mapper is configured — a
     * shared mapper whose features changed for a serialisation reason would
     * silently change what counts as "the same document", and with it whether a
     * version gets written.
     */
    private static final ObjectMapper JSON_TREES = new ObjectMapper();

    private final StoryVersionRepository versions;
    private final ProjectAccess access;
    private final ProjectProperties properties;
    private final ProjectRevisionService revisions;
    private final Clock clock;

    public StoryVersionService(
            StoryVersionRepository versions,
            ProjectAccess access,
            ProjectProperties properties,
            ProjectRevisionService revisions,
            Clock clock) {
        this.versions = versions;
        this.access = access;
        this.properties = properties;
        this.revisions = revisions;
        this.clock = clock;
    }

    /**
     * The history of one campaign's story, newest first.
     *
     * <p>Authorised through {@link ProjectAccess}, like every other read of a
     * campaign: a draft's story is an unreleased product, and #38 widens who may
     * see it by changing that one class.
     */
    @Transactional(readOnly = true)
    public List<StoryVersion> list(UUID projectId, UUID accountId) {
        Project project = access.requireEditable(projectId, accountId);
        return versions.findByProjectIdOrderByVersionNumberDesc(project.getId());
    }

    /** One version, whole, so the editor can show it before replacing anything with it. */
    @Transactional(readOnly = true)
    public StoryVersion get(UUID projectId, UUID accountId, int number) {
        Project project = access.requireEditable(projectId, accountId);
        return version(project, number);
    }

    /**
     * Makes an older draft the current story.
     *
     * <p><strong>Restoring is a write, and it is destructive.</strong> Whatever is in
     * the editor is replaced, which makes it the one action in the editor with no
     * undo unless this method provides one — so the current story is preserved as a
     * version first.
     *
     * <p><strong>Preserved unconditionally, ignoring the interval.</strong> This is
     * {@link #recordNow} and not {@link #recordIfDue}, and the difference is the
     * whole reason both exist. The interval throttles autosave, which fires every
     * few seconds whether anybody asked for it; a restore is one deliberate act, and
     * a creator who has been typing for a minute — so the last version is a minute
     * old and no new one is "due" — is exactly the creator most likely to reach for
     * the history. Applying the throttle here would discard the minute of writing
     * they were trying to get away from, in the one operation that has no way back.
     *
     * <p>The restored document is validated on the way in, even though it was
     * validated on the way out. A document stored before a rule tightened would
     * otherwise be reinstated into a campaign that the checklist (#37) and the
     * public page now consider malformed, by a request that looked like it worked.
     */
    @Transactional
    public Project restore(UUID projectId, UUID accountId, int number) {
        Project project = access.requireEditable(projectId, accountId);
        StoryVersion version = version(project, number);

        JsonNode document = parse(version.getDocument());
        StoryDocuments.validate(document);

        if (ProjectEditLocks.isLaunched(project.getState())) {
            // The public story stays as it is until a moderator approves the revision.
            revisions.workingCopy(project);
            project.setStory(version.getDocument());
            revisions.stage(project, accountId);
            return project;
        }

        recordNow(project, storyOf(project), accountId);

        project.setStory(version.getDocument());
        return project;
    }

    /**
     * Preserves the story as a version, if one is due.
     *
     * <p>Called from the editing service's transaction, so a story and the version
     * recording it commit together or not at all. Nothing here decides whether the
     * story is valid — {@link StoryDocuments} does, before this is reached —
     * because a version of a document the campaign was not allowed to hold would be
     * a draft nobody could restore.
     *
     * <p><strong>A lost race is harmless.</strong> The next number is read and then
     * inserted without a lock, so two tabs of the same creator saving in the same
     * instant can both compute it and the unique index refuses the second. That
     * transaction's autosave fails, the client retries with the same body — which
     * is what {@code useAutosave} guarantees — and the retry finds a version
     * written moments ago, so the window is closed and no version is written. The
     * outcome is the correct one. Locking the project row to prevent it would put a
     * lock on the path of every keystroke to protect a case whose failure mode is
     * already right.
     *
     * @param authorId who was editing: the authenticated caller, never a value from
     *     a request body
     */
    void recordIfDue(Project project, JsonNode document, UUID authorId) {
        write(project, document, authorId, true);
    }

    /**
     * Preserves the story as a version now, whatever the interval says.
     *
     * <p>For a deliberate destructive act — today, restoring. Still skipped when the
     * newest version already holds this exact document: two numbers for one document
     * would make the history longer without making anything more recoverable, and
     * would push a genuinely different draft out of the retention window to do it.
     */
    private void recordNow(Project project, JsonNode document, UUID authorId) {
        write(project, document, authorId, false);
    }

    /**
     * @param honourInterval whether the throttle applies. See {@link #recordIfDue}
     *     for why autosave needs it and {@link #restore} for why a restore must not
     *     have it
     */
    private void write(Project project, JsonNode document, UUID authorId, boolean honourInterval) {
        if (document == null || document.isNull()) {
            // Clearing the story is a legitimate edit and there is nothing to
            // preserve. The versions already written still hold what was cleared,
            // which is exactly the recovery this feature exists for.
            return;
        }

        Optional<StoryVersion> newest = versions.findFirstByProjectIdOrderByVersionNumberDesc(project.getId());
        if (newest.isPresent() && !isDue(newest.get(), document, honourInterval)) {
            return;
        }

        int number = newest.map(StoryVersion::getVersionNumber).orElse(0) + 1;
        versions.save(StoryVersion.record(project.getId(), number, document.toString(), authorId));

        prune(project.getId(), number);
    }

    /**
     * Whether the story has moved on, and — for an autosave — long enough ago, to be
     * worth another row.
     *
     * <p>Both conditions for an autosave, not either. Time alone would write a
     * version every five minutes of a session in which nothing was typed, and the
     * editor sends the whole document on every save so an unchanged one happens
     * routinely; change alone is the thousand-rows-per-afternoon problem the interval
     * exists to avoid.
     *
     * <p>The change condition holds in both modes. A version identical to the newest
     * is never worth writing, whoever asked for it.
     */
    private boolean isDue(StoryVersion newest, JsonNode document, boolean honourInterval) {
        if (StoryDocuments.isSameDocument(parse(newest.getDocument()), document)) {
            return false;
        }
        if (!honourInterval) {
            return true;
        }
        Instant threshold = clock.instant().minus(properties.story().versionInterval());
        return newest.getCreatedAt().isBefore(threshold);
    }

    /**
     * Drops everything below the retention window.
     *
     * <p>On every write rather than on a schedule, because the table only grows
     * when somebody writes to it. A nightly job would do the same work later, with
     * a second place for the retention number to live and a window during which the
     * table is larger than the configuration says it is.
     */
    private void prune(UUID projectId, int newestNumber) {
        int oldestKept = newestNumber - properties.story().versionsKept() + 1;
        if (oldestKept > 1) {
            versions.deleteOlderThan(projectId, oldestKept);
        }
    }

    private StoryVersion version(Project project, int number) {
        return versions.findByProjectIdAndVersionNumber(project.getId(), number)
                .orElseThrow(() -> new StoryVersionNotFoundException(project.getId(), number));
    }

    private static JsonNode storyOf(Project project) {
        return project.getStory() == null ? null : parse(project.getStory());
    }

    /**
     * A stored document as a tree, or null when it cannot be read as one.
     *
     * <p>Null rather than an exception. Every caller here is deciding whether two
     * documents differ or whether one is worth preserving, and both questions have
     * a safe answer for an unreadable row — "different", so the current story is
     * preserved rather than assumed to be already saved. The column is
     * {@code jsonb}, so reaching this at all means something bypassed the column
     * type.
     */
    private static JsonNode parse(String document) {
        try {
            return JSON_TREES.readTree(document);
        } catch (JacksonException e) {
            return null;
        }
    }
}
