package az.ideanest.project.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.project.ProjectProperties;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectRevision;
import az.ideanest.project.domain.RevisionContent;
import az.ideanest.project.domain.RevisionStatus;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.project.infrastructure.ProjectRevisionRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.outbox.Outbox;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The moderators' side of an edit to a launched campaign (#558): what is waiting, what it
 * would change, and the decision.
 *
 * <p>Approving applies the revision to the campaign, and to its reward tiers, in the same
 * transaction that records it, audits it and announces it, so a campaign never shows an approved edit that has no decision
 * behind it, nor a decision whose edit is missing. Rejecting changes only the revision, and
 * deletes the tiers created for it, which the public never saw (#569).
 *
 * <p>Authorised as the campaign's three outcomes are: reading asks for
 * {@code MODERATE_CONTENT}, and deciding goes through {@link ProjectAccess#requireModeratable},
 * which also locks the campaign.
 */
@Service
public class ProjectRevisionModeration {

    /** A waiting revision with enough about its campaign to choose which to open. */
    public record QueuedRevision(
            ProjectRevision revision, String title, String slug, UUID creatorId, String creatorName, List<String> changedFields) {}

    /**
     * One revision beside the campaign it would change.
     *
     * <p>{@code live} and {@code proposed} are the same campaign twice: the first as the public
     * sees it, the second a detached copy with the revision written on it. Neither is to be
     * saved. {@code rewards} are the reward tiers it creates, deletes, moves or changes (#559, #569),
     * and {@code rewardNames} the names of the items and shipping zones their lines refer to.
     */
    public record Review(
            ProjectRevision revision,
            Project live,
            Project proposed,
            List<String> changedFields,
            List<ProjectRevisionService.RewardChange> rewards,
            Map<UUID, String> rewardNames) {}

    private final ProjectRevisionRepository revisions;
    private final ProjectRepository projects;
    private final ProjectRevisionService revisionService;
    private final ProjectEditingService editing;
    private final ProjectAccess access;
    private final PlatformStaff staff;
    private final UserAccounts accounts;
    private final ProjectProperties properties;
    private final AuditLog audit;
    private final Outbox outbox;
    private final EntityManager entityManager;
    private final Clock clock;

    public ProjectRevisionModeration(
            ProjectRevisionRepository revisions,
            ProjectRepository projects,
            ProjectRevisionService revisionService,
            ProjectEditingService editing,
            ProjectAccess access,
            PlatformStaff staff,
            UserAccounts accounts,
            ProjectProperties properties,
            AuditLog audit,
            Outbox outbox,
            EntityManager entityManager,
            Clock clock) {
        this.revisions = revisions;
        this.projects = projects;
        this.revisionService = revisionService;
        this.editing = editing;
        this.access = access;
        this.staff = staff;
        this.accounts = accounts;
        this.properties = properties;
        this.audit = audit;
        this.outbox = outbox;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** The submitted revisions, oldest first. */
    @Transactional(readOnly = true)
    public List<QueuedRevision> queue(UUID moderatorId, Integer requested) {
        staff.requireCapability(moderatorId, StaffCapability.MODERATE_CONTENT);
        int limit = Math.clamp(
                requested == null ? properties.submissions().defaultPageSize() : requested,
                1,
                properties.submissions().maxPageSize());

        List<ProjectRevision> waiting =
                revisions.findByStatusOrderBySubmittedAtAsc(RevisionStatus.PENDING, PageRequest.of(0, limit));
        Map<UUID, Project> campaigns = projects
                .findAllById(waiting.stream().map(ProjectRevision::getProjectId).collect(Collectors.toSet()))
                .stream()
                .collect(Collectors.toMap(Project::getId, project -> project));
        Set<UUID> creatorIds = campaigns.values().stream().map(Project::getCreatorId).collect(Collectors.toSet());
        Map<UUID, UserAccount> creators = accounts.findAllById(creatorIds);

        return waiting.stream()
                .map(revision -> {
                    Project project = campaigns.get(revision.getProjectId());
                    UserAccount creator = creators.get(project.getCreatorId());
                    return new QueuedRevision(
                            revision,
                            project.getTitle(),
                            project.getSlug(),
                            project.getCreatorId(),
                            creator == null ? null : creator.name(),
                            revisionService.contentOf(revision).changedFrom(revisionService.liveContent(project)));
                })
                .toList();
    }

    @Transactional
    public Review review(UUID moderatorId, UUID revisionId) {
        staff.requireCapability(moderatorId, StaffCapability.MODERATE_CONTENT);
        ProjectRevision revision =
                revisions.findById(revisionId).orElseThrow(() -> new RevisionNotFoundException(revisionId));
        RevisionContent content = revisionService.contentOf(revision);

        Project proposed = projects.findById(revision.getProjectId())
                .orElseThrow(() -> new ProjectNotFoundException(revision.getProjectId()));
        entityManager.detach(proposed);
        content.copyOnto(proposed);
        Project live = projects.findById(revision.getProjectId())
                .orElseThrow(() -> new ProjectNotFoundException(revision.getProjectId()));
        RevisionContent liveContent = revisionService.liveContent(live);

        return new Review(
                revision,
                live,
                proposed,
                content.changedFrom(liveContent),
                revisionService.rewardChanges(live.getId(), content, liveContent),
                revisionService.rewardNames(live.getId()));
    }

    /** Applies the revision to the campaign. A note is optional. */
    @Transactional
    public ProjectRevision approve(UUID revisionId, UUID moderatorId, String note) {
        ProjectRevision revision = pendingFor(revisionId, moderatorId);
        Project project = projects.findById(revision.getProjectId())
                .orElseThrow(() -> new ProjectNotFoundException(revision.getProjectId()));
        RevisionContent content = revisionService.contentOf(revision);
        RevisionContent liveContent = revisionService.liveContent(project);
        List<String> changed = content.changedFrom(liveContent);

        editing.applyApproved(project, content, revision.getAuthorId());
        List<UUID> kept = revisionService.publishRewards(project.getId(), content, liveContent);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        revision.approve(moderatorId, now, blankAsNull(note));

        // A tier somebody backed after its deletion was proposed stays, as §5.3 requires of
        // any tier with backers; the record says so rather than the moderator finding out.
        audit.record(
                AuditAction.PROJECT_REVISION_APPROVED,
                project.getId(),
                AuditActor.moderator(moderatorId),
                AuditOutcome.SUCCEEDED,
                "revision " + revision.getId() + ": " + String.join(",", changed)
                        + (kept.isEmpty() ? "" : "; kept backed tiers " + kept));
        announce(project, revision, "APPROVED", now);
        return revision;
    }

    /** Refuses the revision. The reason is shown to the creator, so it is required. */
    @Transactional
    public ProjectRevision reject(UUID revisionId, UUID moderatorId, String reason) {
        if (reason == null || reason.isBlank()) {
            throw new ProjectFieldRejectedException("note", "A moderation decision the creator sees needs a reason.");
        }
        ProjectRevision revision = pendingFor(revisionId, moderatorId);
        Project project = projects.findById(revision.getProjectId())
                .orElseThrow(() -> new ProjectNotFoundException(revision.getProjectId()));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        revision.reject(moderatorId, now, reason.trim());
        revisionService.discardRewards(project.getId());

        audit.record(
                AuditAction.PROJECT_REVISION_REJECTED,
                project.getId(),
                AuditActor.moderator(moderatorId),
                AuditOutcome.SUCCEEDED,
                "revision " + revision.getId());
        announce(project, revision, "REJECTED", now);
        return revision;
    }

    /**
     * The revision, once the caller is known to be staff and the campaign is locked, and only
     * if it is still waiting. Locking the campaign first is what serialises this against the
     * creator's own saves and a second moderator.
     */
    private ProjectRevision pendingFor(UUID revisionId, UUID moderatorId) {
        UUID projectId = revisions.findById(revisionId)
                .orElseThrow(() -> new RevisionNotFoundException(revisionId))
                .getProjectId();
        access.requireModeratable(projectId, moderatorId);
        ProjectRevision revision =
                revisions.findByIdForUpdate(revisionId).orElseThrow(() -> new RevisionNotFoundException(revisionId));
        if (revision.getStatus() != RevisionStatus.PENDING) {
            throw new RevisionNotAvailableException(RevisionNotAvailableException.Reason.NOT_PENDING);
        }
        return revision;
    }

    private void announce(Project project, ProjectRevision revision, String outcome, Instant at) {
        outbox.record(
                ProjectRevisionDecidedEvent.AGGREGATE_TYPE,
                project.getId(),
                ProjectRevisionDecidedEvent.EVENT_TYPE,
                new ProjectRevisionDecidedEvent(
                        project.getId(), project.getCreatorId(), revision.getId(), outcome, revision.getReason(), at));
    }

    private static String blankAsNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
