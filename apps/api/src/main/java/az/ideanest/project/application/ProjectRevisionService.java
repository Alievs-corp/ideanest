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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.UnaryOperator;
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
 *
 * <p><strong>A reward tier's writing goes into the same revision (#559).</strong> Its title,
 * description, picture and clip are staged by {@link #stageReward} and read back by
 * {@link #heldRewardWriting}; the tier keeps what the public sees until approval, and
 * {@link #publishRewards} writes it. The tier's price, stock and the rest are the reward
 * module's and are not held.
 */
@Service
public class ProjectRevisionService {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final ProjectRevisionRepository revisions;
    private final ProjectRepository projects;
    private final ProjectAccess access;
    private final RewardWritings rewardWritings;
    private final EntityManager entityManager;
    private final Clock clock;

    public ProjectRevisionService(
            ProjectRevisionRepository revisions,
            ProjectRepository projects,
            ProjectAccess access,
            RewardWritings rewardWritings,
            EntityManager entityManager,
            Clock clock) {
        this.revisions = revisions;
        this.projects = projects;
        this.access = access;
        this.rewardWritings = rewardWritings;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** What the editor needs to know about the revision a campaign has open. */
    public record Summary(
            UUID id, RevisionStatus status, List<String> changedFields, Instant submittedAt, Instant updatedAt) {}

    /** The refusal a moderator gave to the creator's latest revision. */
    public record Rejection(UUID id, String reason, Instant decidedAt) {}

    /** One reward tier whose writing a revision changes, as the public sees it and as proposed. */
    public record RewardChange(UUID rewardId, RewardWriting live, RewardWriting proposed) {}

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
        Optional<ProjectRevision> open = openAfterLock(live.getId());
        Map<UUID, RevisionContent.Reward> heldRewards =
                open.map(revision -> contentOf(revision).rewards()).orElse(Map.of());

        keep(live, liveContent(live), open, RevisionContent.of(workingCopy, storyOf(workingCopy), heldRewards), authorId);
    }

    /**
     * Applies an edit to one reward tier's writing in the open revision, opening one if there
     * is none, and answers the writing the tier now has in it.
     *
     * <p>{@code edit} is given the tier's writing as the revision holds it, or as the tier shows
     * it, read after the campaign is locked, so two editors saving different fields of one tier
     * do not undo each other. It validates as it goes and may throw. An edit that changes
     * nothing leaves the revision alone, so an autosave does not take a submitted revision back
     * to a draft.
     */
    @Transactional
    public RewardWriting stageReward(UUID projectId, UUID rewardId, UUID authorId, UnaryOperator<RewardWriting> edit) {
        Project live = projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        Optional<ProjectRevision> open = openAfterLock(projectId);
        RevisionContent liveContent = liveContent(live);
        RevisionContent.Reward shown = liveContent.rewards().get(rewardId);
        if (shown == null) {
            throw new IllegalStateException("Reward " + rewardId + " is not a tier of project " + projectId);
        }

        RevisionContent current = open.map(this::contentOf).orElse(liveContent);
        RewardWriting before = RewardWriting.of(current.rewards().getOrDefault(rewardId, shown));
        RewardWriting after = edit.apply(before);
        if (!after.equals(before)) {
            keep(live, liveContent, open, current.withReward(rewardId, after.held()), authorId);
        }
        return after;
    }

    /**
     * The writing the open revision holds for the campaign's tiers, by tier: the ones it
     * changes, and none of the others. Empty when nothing is open.
     */
    @Transactional(readOnly = true)
    public Map<UUID, RewardWriting> heldRewardWriting(UUID projectId) {
        return revisions.findOpenByProjectId(projectId)
                .map(open -> writings(contentOf(open).rewards()))
                .orElse(Map.of());
    }

    /** The tiers a revision would change, beside what they show now, in display order. */
    public List<RewardChange> rewardChanges(RevisionContent proposed, RevisionContent live) {
        return proposed.changedRewardsFrom(live).stream()
                .map(rewardId -> new RewardChange(
                        rewardId,
                        RewardWriting.of(live.rewards().get(rewardId)),
                        RewardWriting.of(proposed.rewards().get(rewardId))))
                .toList();
    }

    /** Writes an approved revision's tier writing onto the tiers. Part of approving it. */
    public void publishRewards(UUID projectId, RevisionContent approved, RevisionContent live) {
        Map<UUID, RevisionContent.Reward> held = approved.heldAgainst(live).rewards();
        if (!held.isEmpty()) {
            rewardWritings.publish(projectId, writings(held));
        }
    }

    /**
     * The open revision, read again now that the campaign is locked: the editor may have loaded
     * it earlier in this transaction, before another save committed.
     */
    private Optional<ProjectRevision> openAfterLock(UUID projectId) {
        Optional<ProjectRevision> open = revisions.findOpenByProjectId(projectId);
        open.ifPresent(entityManager::refresh);
        return open;
    }

    /**
     * Keeps {@code proposed} as the open revision, or closes the revision when it has come back
     * to what the campaign shows: an unsent draft is deleted and a submitted one is withdrawn,
     * so a moderator is never asked to approve nothing.
     */
    private void keep(
            Project live,
            RevisionContent liveContent,
            Optional<ProjectRevision> open,
            RevisionContent proposed,
            UUID authorId) {
        RevisionContent held = proposed.heldAgainst(liveContent);
        if (held.changedFrom(liveContent).isEmpty()) {
            open.ifPresent(revision -> {
                if (revision.getStatus() == RevisionStatus.DRAFT) {
                    revisions.delete(revision);
                } else {
                    revision.withdraw();
                }
            });
            return;
        }

        String content = write(held);
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
        // A revision whose only change was to a reward tier deleted since changes nothing.
        Project live = projects.findById(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        if (contentOf(open).changedFrom(liveContent(live)).isEmpty()) {
            throw new RevisionNotAvailableException(RevisionNotAvailableException.Reason.NO_CHANGES);
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

    /** The content a campaign shows the public now, with every reward tier's writing. */
    public RevisionContent liveContent(Project live) {
        Map<UUID, RevisionContent.Reward> rewards = new LinkedHashMap<>();
        rewardWritings.liveWritingOf(live.getId()).forEach((rewardId, writing) -> rewards.put(rewardId, writing.held()));
        return RevisionContent.of(live, storyOf(live), rewards);
    }

    private static Map<UUID, RewardWriting> writings(Map<UUID, RevisionContent.Reward> rewards) {
        Map<UUID, RewardWriting> writings = new LinkedHashMap<>();
        rewards.forEach((rewardId, reward) -> writings.put(rewardId, RewardWriting.of(reward)));
        return writings;
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
