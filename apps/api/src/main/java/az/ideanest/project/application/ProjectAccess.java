package az.ideanest.project.application;

import az.ideanest.project.domain.ActorRole;
import az.ideanest.project.domain.Capability;
import az.ideanest.project.domain.Collaborator;
import az.ideanest.project.domain.Grants;
import az.ideanest.project.domain.Project;
import az.ideanest.project.infrastructure.CollaboratorRepository;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.ProjectAuthorisation;
import az.ideanest.shared.access.ProjectCapability;
import az.ideanest.shared.access.StaffCapability;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collector;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Who may do what to a campaign. The only place that question is answered.
 *
 * <p><strong>Two kinds of holder, and they are not the same kind.</strong> The
 * creator's authority comes from {@code projects.creator_id} and is implicit:
 * there is no {@code collaborators} row for them, because a row could be revoked
 * or edited, and either would be a way to lock somebody out of their own
 * campaign. Everybody else holds a set of {@link Capability} values granted by
 * somebody who held them first. {@link Grants} is that distinction as a value,
 * and it is what makes "only the creator may grant
 * {@link Capability#MANAGE_COLLABORATORS}" expressible at all.
 *
 * <p><strong>Loading and checking are one call.</strong> Every method here
 * returns the campaign, so there is no way to obtain one without having been
 * authorised for it. Had this class only answered {@code boolean canEdit(...)},
 * the load would have lived in the services and a new service method could have
 * loaded a campaign and forgotten to ask.
 *
 * <p><strong>Coarse and fine forms, deliberately both.</strong> The two-argument
 * methods answer "may this account administer this campaign at all" and are what
 * a caller uses when the request is not about one specific capability — reading
 * the editor projection, or an action that belongs to the creator alone. The
 * three-argument forms name the capability the request needs, and a caller that
 * knows which one it needs is expected to say so: a collaborator with
 * {@code EDIT_STORY} is not a collaborator with {@code EDIT_REWARDS}, and a
 * single coarse check would make those two grants the same grant.
 *
 * <p><strong>404 for a stranger, 403 for a collaborator.</strong> A caller with
 * no relationship to the campaign is told it does not exist — see
 * {@link ProjectNotFoundException} for why that is not evasiveness. A caller who
 * holds an active grant and is missing the capability this request needs gets
 * {@link CapabilityNotGrantedException} and a 403: they were invited, they can
 * already see the campaign, and there is nothing left to hide from them. A
 * <em>revoked</em> collaborator is a stranger again, and gets the 404 — the
 * confidentiality that 404 protects is exactly what a revocation withdraws.
 *
 * <p><strong>Other modules ask through {@link ProjectAuthorisation}.</strong> They may
 * not name {@link Capability}, which is this module's domain enum, so the vocabulary is
 * published as {@link ProjectCapability} and this class is the implementation that
 * turns one into the other. Before that contract existed, every out-of-module caller
 * could only ask the coarse "may this account edit this campaign at all", and four of
 * them did — which is how a collaborator granted only {@link Capability#EDIT_REWARDS}
 * came to be able to publish a project update and read the referral report. The
 * mapping is {@link Capability#of(ProjectCapability)} and it is total; nothing else in
 * the service needs to know there are two enums.
 */
@Service
public class ProjectAccess implements ProjectAuthorisation {

    /**
     * Any one of these means "this account works on the campaign".
     *
     * <p>What the coarse {@link #requireEditable(UUID, UUID)} accepts, because
     * that method serves both the editor's read and its autosave, and somebody
     * granted any editing capability needs to be able to open the editor to
     * exercise it. A collaborator granted only {@code VIEW_FINANCES} or
     * {@code RESPOND_TO_COMMENTS} is not an editor and is refused.
     *
     * <p><strong>This is the check for opening the editor, not for writing to
     * it.</strong> {@code PATCH /v1/projects/{id}} carries basics, the story, and
     * the risks section in one body, so accepting any editing capability on the
     * write path would make the grants indistinguishable in practice — a
     * collaborator invited to write the story could reprice the campaign. The
     * write path therefore asks {@link #requireEditableForAll} for exactly the
     * capabilities the fields in the body call for, which is what makes the
     * granularity real rather than nominal.
     */
    private static final Set<Capability> EDITING =
            EnumSet.of(Capability.EDIT_BASICS, Capability.EDIT_REWARDS, Capability.EDIT_STORY);

    /** No capability grants this; the campaign's creator and nobody else. */
    private static final Set<Capability> CREATOR_ONLY = EnumSet.noneOf(Capability.class);

    private final ProjectRepository projects;
    private final CollaboratorRepository collaborators;
    private final PlatformStaff moderators;

    public ProjectAccess(
            ProjectRepository projects, CollaboratorRepository collaborators, PlatformStaff moderators) {
        this.projects = projects;
        this.collaborators = collaborators;
        this.moderators = moderators;
    }

    /**
     * The campaign, for reading or editing by this account.
     *
     * <p>No lock: this serves the editor's reads and its autosaves, which are one
     * person typing into one form. Two of their own tabs writing different fields
     * is last-write-wins, which is what an autosaving editor means by design.
     *
     * <p>The creator, or a collaborator holding any of {@link #EDITING}.
     */
    public Project requireEditable(UUID projectId, UUID accountId) {
        return require(projects.findById(projectId), projectId, accountId, EDITING);
    }

    /**
     * Refuses unless this account holds this capability on this campaign.
     *
     * <p>The whole of {@link ProjectAuthorisation}: the sanctioned route for a module
     * that knows which capability its request needs and may not name
     * {@link Capability} to say so. It authorises exactly as
     * {@link #requireEditable(UUID, UUID, Capability)} does and deliberately answers
     * nothing, so that no campaign leaves this module through an authorisation call.
     */
    @Override
    public void requireCapability(UUID projectId, UUID accountId, ProjectCapability capability) {
        requireEditable(projectId, accountId, Capability.of(capability));
    }

    /**
     * What §5.3 has frozen on the campaign, for a caller that may not name one.
     *
     * <p>Authorises exactly as {@link #requireCapability} — same load, same refusals —
     * and answers with {@link EditLocks} instead of the entity. It exists for the
     * reward module, which enforces two of the five rules and cannot see a
     * {@code Project} to read the state off: {@code ModuleBoundaryTests} keeps this
     * module's domain package to this module. Handing it the answer here rather than
     * letting it ask a second time is what stops "has this campaign launched" from
     * being computed twice from two different loads.
     *
     * <p><strong>The capability is a parameter and there is no overload without
     * one.</strong> There was, and it asked the coarse question; the analytics module
     * found it, used it because it was the only thing it could reach, and the referral
     * report became readable by anybody granted any editing capability. A coarse
     * escape hatch on a published surface will be taken.
     */
    public EditLocks requireEditableLocks(UUID projectId, UUID accountId, ProjectCapability capability) {
        return EditLocks.of(requireEditable(projectId, accountId, Capability.of(capability)));
    }

    /**
     * The campaign, for a request that needs one named capability.
     *
     * <p>The creator — implicitly, without a row — or a collaborator whose active
     * grant includes {@code capability}. Anything else is refused, and which
     * refusal depends on whether the caller is party to the campaign at all.
     */
    public Project requireEditable(UUID projectId, UUID accountId, Capability capability) {
        return require(projects.findById(projectId), projectId, accountId, EnumSet.of(capability));
    }

    /**
     * The campaign, for a request that needs <em>every</em> capability in a set.
     *
     * <p>The write path for a partial edit, which is the one request whose body
     * decides what authority it needs: a patch touching the title and the story
     * needs both {@link Capability#EDIT_BASICS} and {@link Capability#EDIT_STORY},
     * and holding one of them is not holding the other. The "any of" form above
     * would let a collaborator invited to write the story reprice the campaign,
     * which is the difference between granular permissions and the appearance of
     * them.
     *
     * <p>An empty set falls back to "any editing capability" rather than to "the
     * creator alone": it means the body asked for nothing, and refusing a caller
     * who may edit the campaign because their patch was empty would be a refusal
     * about nothing. Nothing is written either way.
     *
     * @throws CapabilityNotGrantedException naming only what was missing, so the
     *     client can say which part of the change was refused rather than
     *     reporting the whole save as forbidden
     */
    public Project requireEditableForAll(UUID projectId, UUID accountId, Set<Capability> allOf) {
        if (allOf.isEmpty()) {
            return requireEditable(projectId, accountId);
        }

        Project project =
                projects.findById(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        Grants grants = grantsOf(project, accountId);

        if (grants.isEmpty()) {
            // Not party to the campaign at all, including a revoked grant and a
            // pending invitation. Neither is told the campaign exists.
            throw new ProjectNotFoundException(projectId);
        }
        if (grants.isCreator()) {
            return project;
        }

        Set<Capability> missing =
                allOf.stream().filter(capability -> !grants.holds(capability)).collect(toCapabilities());
        if (!missing.isEmpty()) {
            throw new CapabilityNotGrantedException(projectId, missing, grants.capabilities());
        }
        return project;
    }

    private static Collector<Capability, ?, Set<Capability>> toCapabilities() {
        return Collectors.toCollection(() -> EnumSet.noneOf(Capability.class));
    }

    /**
     * The campaign, locked until the transaction ends, for a state change by this
     * account.
     *
     * <p>Locked because a state change reads the current state, decides whether
     * the edge is allowed, and writes an audit row that claims that edge happened.
     * Two of those interleaving would produce a history that does not describe
     * any sequence of events that occurred. See
     * {@code ProjectRepository#findByIdForUpdate}.
     *
     * <p><strong>The creator alone.</strong> This is the form for the transitions
     * no grant confers: going live starts taking money from the public, and
     * cancelling abandons commitments people have already made with their card
     * details on file. Both stay with the account that owns the campaign, and a
     * caller that means "submit for review" asks for
     * {@link Capability#SUBMIT_FOR_REVIEW} through the overload below instead of
     * inheriting an authority nobody granted.
     */
    public Project requireTransitionable(UUID projectId, UUID accountId) {
        return require(projects.findByIdForUpdate(projectId), projectId, accountId, CREATOR_ONLY);
    }

    /** The campaign, locked, for a state change this capability confers. */
    public Project requireTransitionable(UUID projectId, UUID accountId, Capability capability) {
        return require(projects.findByIdForUpdate(projectId), projectId, accountId, EnumSet.of(capability));
    }

    /**
     * The campaign, locked, for a moderation decision by this account.
     *
     * <p><strong>{@link StaffCapability#MODERATE_CONTENT}, not "is staff".</strong>
     * This is the only thing that keeps "state transitions are enforced server-side
     * and cannot be bypassed" true for the edges a creator may not take: without it
     * these endpoints require a valid access token and nothing else, which is a
     * creator approving their own campaign. #295 replaced the configured list behind
     * {@link PlatformStaff} with a role model, and this method went on asking the
     * list's old question — whether the caller works here at all — so a partner,
     * a curator or the finance team could publish a draft or halt a live campaign
     * while the queue those decisions come from refused to show them one (#574).
     * Every caller decides a campaign's fate as a moderator — approve, reject,
     * request changes, suspend, and the same three for an edit — and the capability
     * says it includes the suspension.
     *
     * <p><strong>Checked before the campaign is loaded</strong>, so a caller who
     * may not moderate learns nothing about which identifiers exist: a stranger and
     * a member of staff without the capability get their 403 whether or not the
     * campaign is there.
     */
    public Project requireModeratable(UUID projectId, UUID accountId) {
        moderators.requireCapability(accountId, StaffCapability.MODERATE_CONTENT);
        return projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
    }

    /**
     * In what capacity this account is acting, for the audit row.
     *
     * <p>{@link ActorRole#CREATOR} for the owner and {@link ActorRole#COLLABORATOR}
     * for an account acting under a grant. The transition service asks rather than
     * assuming because the audit trail has to say which of the two a person was:
     * "the creator submitted this campaign" and "somebody the creator trusted with
     * one capability submitted it" are different facts, and a year later the row is
     * the only place either of them still exists.
     */
    public ActorRole roleOf(Project project, UUID accountId) {
        Grants grants = grantsOf(project, accountId);
        if (grants.isCreator()) {
            return ActorRole.CREATOR;
        }
        if (!grants.isEmpty()) {
            return ActorRole.COLLABORATOR;
        }
        // Unreachable through any of the require* methods above, which is the
        // point: reaching it means a caller obtained a campaign some other way.
        throw new ProjectNotFoundException(project.getId());
    }

    /**
     * What this account holds on this campaign: everything as its creator, an
     * active grant's capabilities as a collaborator, nothing otherwise.
     *
     * <p>Public because both the escalation rule and the People tab need the
     * answer, and because a second implementation of "what may this person do
     * here" is the thing this class exists to prevent.
     */
    public Grants grantsOf(Project project, UUID accountId) {
        if (project.isCreatedBy(accountId)) {
            return Grants.ofCreator();
        }
        return collaborators
                .findActiveGrant(project.getId(), accountId)
                .map(Grants::of)
                .orElseGet(Grants::none);
    }

    /**
     * Refuses a grant the granter is not entitled to issue.
     *
     * <p>The rule is {@link Grants#ungrantable(Set)}: nobody may grant more than
     * they hold, and only the creator may grant
     * {@link Capability#MANAGE_COLLABORATORS}. Checked here rather than in the
     * collaborator service so that authorisation stays in one file — the service
     * decides what an invitation <em>is</em>, this decides whether the person
     * issuing it may.
     *
     * @throws CapabilityNotGrantedException naming the capabilities that were
     *     beyond the granter's authority, so the refusal can be shown against the
     *     checkboxes that caused it rather than as "forbidden". Read as "you would
     *     have to hold these to confer them" — which is exact for all but one of
     *     them, and for {@link Capability#MANAGE_COLLABORATORS} understates the
     *     rule: holding it is not enough, only the creator may confer it
     */
    public void requireGrantable(Project project, UUID granterId, Set<Capability> requested) {
        Grants grants = grantsOf(project, granterId);
        Set<Capability> beyond = grants.ungrantable(requested);
        if (!beyond.isEmpty()) {
            throw new CapabilityNotGrantedException(project.getId(), beyond, grants.capabilities());
        }
    }

    /**
     * The one implementation of "may this account act on this campaign".
     *
     * @param anyOf the capabilities that would authorise this request, any one of
     *     which is enough. Empty means no capability does and the creator alone may
     *     act — which is a stronger statement than "all of them", and the reason
     *     this parameter is a set rather than a single value
     */
    private Project require(Optional<Project> loaded, UUID projectId, UUID accountId, Set<Capability> anyOf) {
        Project project = loaded.orElseThrow(() -> new ProjectNotFoundException(projectId));
        Grants grants = grantsOf(project, accountId);

        if (grants.isEmpty()) {
            // Not party to this campaign — including somebody whose grant was
            // revoked, and somebody whose invitation is still pending. Neither is
            // told the campaign exists.
            throw new ProjectNotFoundException(projectId);
        }
        if (grants.isCreator()) {
            return project;
        }
        if (anyOf.stream().noneMatch(grants::holds)) {
            throw new CapabilityNotGrantedException(projectId, anyOf, grants.capabilities());
        }
        return project;
    }

    /**
     * A collaborator row, for the endpoints that change one.
     *
     * <p>Here rather than in the service for the reason the rest of this class
     * exists: the row identifies its own campaign, so loading it and deciding
     * whether the caller may manage that campaign's team is one question, and
     * splitting it would let a future endpoint load a grant and forget to ask.
     *
     * @return the row, and the campaign it belongs to, once the caller has been
     *     established as somebody who may manage collaborators on it
     */
    public ManagedCollaborator requireManageable(UUID collaboratorId, UUID accountId) {
        Collaborator collaborator = collaborators
                .findById(collaboratorId)
                .orElseThrow(() -> new CollaboratorNotFoundException(collaboratorId));
        Project project =
                requireEditable(collaborator.getProjectId(), accountId, Capability.MANAGE_COLLABORATORS);
        return new ManagedCollaborator(project, collaborator);
    }

    /** A collaborator row together with the campaign the caller was authorised for. */
    public record ManagedCollaborator(Project project, Collaborator collaborator) {
    }
}
