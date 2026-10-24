package az.ideanest.project.application;

import az.ideanest.project.domain.Capability;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.ProjectRevision;
import az.ideanest.project.domain.RevisionContent;
import az.ideanest.project.domain.RevisionStatus;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.project.infrastructure.ProjectRevisionRepository;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * A launched campaign's writing is edited in a revision and published by a moderator (#558).
 *
 * <p>Once the public has seen a campaign, an edit to its title, summary, story, risks, cover,
 * video, countries or category is not written to {@code projects}. It goes into the one open
 * revision, which the creator keeps working on, submits, and may discard; the public page shows
 * the last approved version until a moderator applies it. The fields §5.3 freezes are not part
 * of it and are refused as before.
 *
 * <p><strong>The editor is handed a copy of the campaign.</strong> {@link #workingCopy} detaches
 * the entity and writes the draft onto it, so the editing code that validates and assigns fields
 * runs unchanged and nothing it assigns is flushed. {@link #stage} then reads the result back
 * into the revision. The entity must not be used as the campaign after that.
 */
@Service
public class ProjectRevisionService {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final ProjectRevisionRepository revisions;
    private final ProjectRepository projects;
    private final ProjectAccess access;
    private final EntityManager entityManager;
    private final Clock clock;

    public ProjectRevisionService(
            ProjectRevisionRepository revisions,
            ProjectRepository projects,
            ProjectAccess access,
            EntityManager entityManager,
            Clock clock) {
        this.revisions = revisions;
        this.projects = projects;
        this.access = access;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** What the editor needs to know about the revision a campaign has open. */
    public record Summary(
            UUID id, RevisionStatus status, List<String> changedFields, Instant submittedAt, Instant updatedAt) {}

    /** The refusal a moderator gave to the creator's latest revision. */
    public record Rejection(UUID id, String reason, Instant decidedAt) {}

    /**
     * The campaign as its creator is editing it: the entity itself for a campaign nobody has
     * seen, and a detached copy with the open draft written onto it for one they have.
     */
    @Transactional
    public Project workingCopy(Project project) {
        if (!ProjectEditLocks.isLaunched(project.getState())) {
            return project;
        }
        entityManager.detach(project);
        revisions.findOpenByProjectId(project.getId()).ifPresent(open -> contentOf(open).copyOnto(project));
        return project;
    }

    /**
     * Keeps what the creator has made of the working copy as the open revision.
     *
     * <p>A copy that has come back to what the campaign shows closes the revision instead: an
     * unsent draft is deleted and a submitted one is withdrawn, so a moderator is never asked to
     * approve nothing.
     */
    @Transactional
    public void stage(Project workingCopy, UUID authorId) {
        Project live = projects.findByIdForUpdate(workingCopy.getId())
                .orElseThrow(() -> new ProjectNotFoundException(workingCopy.getId()));
        RevisionContent proposed = RevisionContent.of(workingCopy, storyOf(workingCopy));
        Optional<ProjectRevision> open = revisions.findOpenByProjectId(live.getId());

        if (proposed.changedFrom(liveContent(live)).isEmpty()) {
            open.ifPresent(revision -> {
                if (revision.getStatus() == RevisionStatus.DRAFT) {
                    revisions.delete(revision);
                } else {
                    revision.withdraw();
                }
            });
            return;
        }

        String content = write(proposed);
        if (open.isPresent()) {
            open.get().rewrite(content, authorId);
        } else {
            revisions.save(ProjectRevision.draft(live.getId(), content, authorId));
        }
    }

    /** Sends the open draft to the moderators. */
    @Transactional
    public ProjectRevision submit(UUID projectId, UUID accountId) {
        access.requireEditableForAll(projectId, accountId, Set.of(Capability.SUBMIT_FOR_REVIEW));
        ProjectRevision open = revisions.findOpenByProjectId(projectId)
                .orElseThrow(() -> new RevisionNotAvailableException(RevisionNotAvailableException.Reason.NO_OPEN_REVISION));
        if (open.getStatus() == RevisionStatus.PENDING) {
            throw new RevisionNotAvailableException(RevisionNotAvailableException.Reason.ALREADY_SUBMITTED);
        }
        open.submit(clock.instant().truncatedTo(ChronoUnit.MICROS));
        return open;
    }

    /** Throws the open revision away. The campaign is unchanged. */
    @Transactional
    public void discard(UUID projectId, UUID accountId) {
        access.requireEditable(projectId, accountId);
        ProjectRevision open = revisions.findOpenByProjectId(projectId)
                .orElseThrow(() -> new RevisionNotAvailableException(RevisionNotAvailableException.Reason.NO_OPEN_REVISION));
        open.withdraw();
    }

    /** The open revision, described against what the campaign shows now. */
    @Transactional(readOnly = true)
    public Optional<Summary> summaryOf(UUID projectId) {
        return revisions.findOpenByProjectId(projectId).flatMap(open -> projects.findById(projectId)
                .map(live -> new Summary(
                        open.getId(),
                        open.getStatus(),
                        contentOf(open).changedFrom(liveContent(live)),
                        open.getSubmittedAt(),
                        open.getUpdatedAt())));
    }

    /** The newest closed revision, when it was refused and nothing has been started since. */
    @Transactional(readOnly = true)
    public Optional<Rejection> latestRejection(UUID projectId) {
        if (revisions.findOpenByProjectId(projectId).isPresent()) {
            return Optional.empty();
        }
        return revisions.findHistory(projectId, PageRequest.of(0, 1)).stream()
                .filter(revision -> revision.getStatus() == RevisionStatus.REJECTED)
                .map(revision -> new Rejection(revision.getId(), revision.getReason(), revision.getDecidedAt()))
                .findFirst();
    }

    /** The content a campaign shows the public now. */
    public RevisionContent liveContent(Project live) {
        return RevisionContent.of(live, storyOf(live));
    }

    public RevisionContent contentOf(ProjectRevision revision) {
        try {
            return JSON.readValue(revision.getContent(), RevisionContent.class);
        } catch (JacksonException e) {
            throw new IllegalStateException("Revision " + revision.getId() + " holds content that cannot be read", e);
        }
    }

    private static String write(RevisionContent content) {
        try {
            return JSON.writeValueAsString(content);
        } catch (JacksonException e) {
            throw new IllegalStateException("Revision content could not be written", e);
        }
    }

    private static JsonNode storyOf(Project project) {
        if (project.getStory() == null) {
            return null;
        }
        try {
            return JSON.readTree(project.getStory());
        } catch (JacksonException e) {
            throw new IllegalStateException("Project " + project.getId() + " holds a story that is not JSON", e);
        }
    }
}
