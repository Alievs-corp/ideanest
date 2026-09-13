package az.ideanest.project.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.project.ProjectProperties;
import az.ideanest.project.domain.ActorRole;
import az.ideanest.project.domain.CampaignOutcome;
import az.ideanest.project.domain.Capability;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.ProjectStateMachine;
import az.ideanest.project.domain.ProjectStateTransition;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.project.infrastructure.ProjectStateTransitionRepository;
import az.ideanest.shared.compliance.LegalSubjects;
import az.ideanest.shared.outbox.Outbox;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The only way a campaign's state changes.
 *
 * <p><strong>Three things happen together or not at all:</strong> the edge is
 * checked against §6.1, the state is written, and a row is appended to
 * {@code project_state_transitions}. One transaction, one method, and no other
 * path — {@link Project} has no state setter, the repository has no update that
 * touches the column, and every endpoint that changes a state calls one of the
 * methods here.
 *
 * <p>That constraint is the whole design. Split across the seven endpoints that
 * perform transitions, the audit row becomes something each of them remembers to
 * write, and the first one that forgets produces a campaign whose history has a
 * hole in it — discovered months later, by somebody trying to establish who
 * approved a campaign that should not have been approved.
 *
 * <p><strong>Completeness is re-checked on submission, by the class the
 * checklist endpoint uses.</strong> {@code ProjectChecklistService} evaluates
 * §5.3 for both, which is why {@code GET /v1/projects/{id}/checklist} and this
 * service cannot disagree about whether a campaign is ready. A second, partial
 * version of those rules written inline here would be the bug that arrangement
 * exists to prevent — and the endpoint is advice to a client that may be old or
 * may not be ours, so this is where "state transitions are enforced server-side
 * and cannot be bypassed" is actually true.
 *
 * <p><strong>Publishing is also gated on the creator agreement and on a
 * subscription.</strong> {@link CreatorAgreementGate} and {@link PublishingGate} are
 * asked on submission, between the edge check and the checklist: the first refuses a
 * creator who has not accepted §22.2's creator agreement (#426), the second one who has
 * not paid or whose plan does not stretch to this campaign (#368). They are collaborators
 * here rather than inline conditions for the reason the checklist is: this class exists
 * so that the edge, the write and the history stay one legible guarantee, and every rule
 * inlined into it makes that harder to see.
 *
 * <p><strong>What is not here.</strong> Transitions driven by time rather than by
 * a person — a scheduled launch arriving, a deadline passing — are scheduled work
 * (§8.4) and belong to the epics that own them; they will call these same methods
 * with {@link ActorRole#SYSTEM}, which is why the actor is a parameter and not the
 * current user.
 */
@Service
public class ProjectTransitionService {

    private static final Logger log = LoggerFactory.getLogger(ProjectTransitionService.class);

    private final ProjectAccess access;
    private final ProjectRepository projects;
    private final ProjectStateTransitionRepository transitions;
    private final ProjectChecklistService checklist;
    private final PublishingGate publishing;
    private final CreatorAgreementGate agreement;
    private final LegalSubjects legalSubjects;
    private final ApplicationEventPublisher events;
    private final Outbox outbox;
    private final AuditLog audit;
    private final ProjectProperties properties;
    private final Clock clock;

    public ProjectTransitionService(
            ProjectAccess access,
            ProjectRepository projects,
            ProjectStateTransitionRepository transitions,
            ProjectChecklistService checklist,
            PublishingGate publishing,
            CreatorAgreementGate agreement,
            LegalSubjects legalSubjects,
            ApplicationEventPublisher events,
            Outbox outbox,
            AuditLog audit,
            ProjectProperties properties,
            Clock clock) {
        this.access = access;
        this.projects = projects;
        this.transitions = transitions;
        this.checklist = checklist;
        this.publishing = publishing;
        this.agreement = agreement;
        this.legalSubjects = legalSubjects;
        this.events = events;
        this.outbox = outbox;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Records a campaign coming into existence.
     *
     * <p>Called by {@link ProjectEditingService#create} inside its transaction,
     * not on its own: the campaign and the first row of its history are one write,
     * and a project whose history starts at its first submission would be a
     * project nobody can tell was created by the account that owns it.
     *
     * <p>Not {@code @Transactional} on purpose. It has no meaning outside the
     * transaction that inserted the campaign, and an annotation here would suggest
     * it could be called on its own.
     */
    public void recordCreation(Project project) {
        transitions.save(ProjectStateTransition.creation(project.getId(), project.getCreatorId()));
    }

    /**
     * Sends a campaign for review: {@code DRAFT} or {@code PRELAUNCH} or
     * {@code CHANGES_REQUESTED} → {@code SUBMITTED}.
     *
     * <p>All three sources are the same edge as far as this method is concerned,
     * which is what the table is for: the difference between a first submission and
     * a resubmission is in the history, not in the code performing it.
     *
     * <p><strong>The one transition a collaborator can be granted.</strong> #38 gave
     * {@link Capability#SUBMIT_FOR_REVIEW} its own capability, so this asks for it by
     * name rather than using the coarse "may administer this campaign" check that
     * {@link #launch} and {@link #cancel} use — those two are irreversible money
     * decisions and stay with the creator. The audit row then says
     * {@link ActorRole#COLLABORATOR} when somebody else submitted, which is exactly
     * the fact {@code roleOf} exists to record.
     *
     * <p><strong>§5.3 is re-checked here.</strong> The same
     * {@code ProjectChecklistService} the checklist endpoint reads, so a client
     * that showed a complete checklist and a service that refuses the submission
     * is not a state this service can reach. What the endpoint gives is advice;
     * this is the rule, and it holds for a client that skipped the endpoint, cached
     * its answer, or is not ours.
     */
    @Transactional
    public Project submit(UUID projectId, UUID accountId) {
        Project project = access.requireTransitionable(projectId, accountId, Capability.SUBMIT_FOR_REVIEW);

        // The edge first, then the contents — the same order as launch, and for the
        // same reason. A rejected campaign is refused for being rejected, not for
        // having no cover image: the state is the thing the creator cannot fix, and
        // reporting the second failure would send them to upload a picture that
        // would change nothing.
        requireEdge(project.getState(), ProjectState.SUBMITTED);
        // Then whether they may publish at all, before whether this campaign is
        // finished. Same order, same reason, one step further out: a creator with no
        // subscription is not sent to write a longer risks section they will still not
        // be allowed to submit.
        //
        // The agreement before the subscription, and that order is deliberate. The
        // creator agreement states the payout terms and the fee, so a platform that
        // sent somebody to a price list before telling them the terms they would be
        // operating under would be selling before disclosing. Accepting it is also
        // free and takes a minute, where the other refusal may cost money -- the
        // cheaper of the two to be told about first.
        agreement.requireAccepted(project);
        publishing.requireEntitled(project);
        checklist.requireSubmittable(project);

        // #430: freeze who the creator legally is, onto the campaign, at the moment
        // the submission is made. §5.6 snapshots a subscription's price for the same
        // reason and V42 freezes a retry window for the same reason: everything
        // downstream -- withholding, which party the agreement binds, #429's name
        // match -- was decided about the person who submitted, and a live read would
        // let an edit made afterwards change a decision that has already been taken.
        //
        // Records nothing when the creator has no subject, which is every submission
        // until #424 sets a threshold. An unfrozen campaign is one the rule did not
        // apply to, and #424's third point is that a campaign is decided under the
        // rule in force when it was submitted.
        legalSubjects.freezeFor(project.getId(), project.getCreatorId());

        return apply(project, ProjectState.SUBMITTED, access.roleOf(project, accountId), accountId, null);
    }

    /**
     * Opens the campaign's pre-launch page: {@code DRAFT} → {@code PRELAUNCH}.
     *
     * <p><strong>Not in §10.2's endpoint list</strong>, and required by #39's
     * definition of done — the same gap {@link #requestChanges} has, recorded the
     * same way. §6.1 has had the edge since the state machine was written and
     * nothing performed it, so a creator could reach {@code PRELAUNCH} only by a
     * hand-written {@code UPDATE}. §4.6 lists a pre-launch page under Basics and
     * a pre-launch link under Promotion; neither is reachable without this.
     *
     * <p><strong>The creator alone</strong>, through the two-argument
     * {@code requireTransitionable}, which is the form {@link #launch} and
     * {@link #cancel} use. That is a deliberate choice against giving it a
     * capability: opening the page publishes the campaign's title, summary, and
     * cover image to anybody with the link, and §6.1 has no edge back — there is no
     * {@code PRELAUNCH → DRAFT}. A collaborator invited to edit the basics has not
     * been given the authority to make them public, and the difference between
     * those two is exactly what #38's granularity is for.
     *
     * <p>No precondition beyond the edge. A pre-launch page shows the title, the
     * summary, and the cover image, all of which are nullable on a draft; a page
     * with only a title is a thin page, and refusing to open it would be this
     * service deciding what a creator's announcement has to contain. The
     * completeness rules belong to the checklist (#37) and apply to submission.
     */
    @Transactional
    public Project openPrelaunch(UUID projectId, UUID accountId) {
        Project project = access.requireTransitionable(projectId, accountId);
        return apply(project, ProjectState.PRELAUNCH, access.roleOf(project, accountId), accountId, null);
    }

    /**
     * Takes an approved campaign live: {@code APPROVED} or {@code SCHEDULED} →
     * {@code LIVE}.
     *
     * <p>This is the transition money depends on, so it is the one with a
     * precondition beyond the edge: §5.1 resolves a campaign by comparing its
     * total against its goal at its deadline, and neither exists on a campaign
     * that was approved without them.
     *
     * <p>It is also the transition most of the platform is told about, and it is
     * announced <strong>twice, on purpose</strong>:
     *
     * <ul>
     *   <li>{@link ProjectEvents.ProjectLaunched} in process, after the commit.
     *       Everybody holding a launch reminder (§4.9 C-11) is owed the message
     *       they asked for, and this is what starts that sweep immediately. Its
     *       own comment explains that it is a latency improvement rather than the
     *       delivery guarantee — losing it costs a minute, because the sweep asks
     *       the database the same question on its next tick.
     *   <li>{@link ProjectLaunchedEvent} through §8.3's outbox, inside this
     *       transaction. #245's "followed creator launched" goes to the creator's
     *       followers, and that audience has <em>no</em> sweep behind it: a follow
     *       is a standing relationship, not an outstanding obligation, so there is
     *       no {@code notified_at} to resume from. The announcement therefore has
     *       to be the thing that cannot be lost.
     * </ul>
     *
     * <p>Two mechanisms for one fact is worth the duplication precisely because
     * they fail differently: one is prompt and losable, the other is durable and a
     * second behind the relay.
     */
    @Transactional
    public Project launch(UUID projectId, UUID accountId) {
        Project project = access.requireTransitionable(projectId, accountId);
        // The edge first, then the data. A campaign still in DRAFT is refused for
        // being in DRAFT, not for having no goal: the state is the thing the
        // creator has to fix first, and reporting the second failure would send
        // them to fill in a field that was not the problem.
        requireEdge(project.getState(), ProjectState.LIVE);
        requireLaunchable(project);

        Project launched = apply(project, ProjectState.LIVE, access.roleOf(project, accountId), accountId, null);
        announceLaunch(launched);
        return launched;
    }

    /**
     * The same edge, taken by the clock: {@code APPROVED} or {@code SCHEDULED} → {@code LIVE}
     * for a campaign whose launch time has arrived — issue #389.
     *
     * <p><strong>The promise this keeps was already being made.</strong> The review tab tells
     * a creator their cleared campaign "goes live when you launch it, or at the launch time
     * you set", and §6.1 has carried {@code SCHEDULED} since the state machine was written.
     * Nothing performed the second half: {@link #launch} was the only producer of
     * {@code LIVE}, so a campaign with a launch time and a creator asleep at it stayed
     * approved. A promise about somebody's marketing that only a human keeps is a promise
     * the platform should not have made.
     *
     * <p><strong>Empty rather than an exception for everything the sweep should skip.</strong>
     * The same shape as {@link #finalise}, and for the same reason: a campaign somebody
     * launched by hand a second before this pass reached it, or one a moderator suspended, is
     * an ordinary race on a sweep rather than a fault, and a throw would abandon every
     * campaign behind it in the batch.
     *
     * <p><strong>No access check, and no actor.</strong> There is nobody signed in; the row
     * records {@link ActorRole#SYSTEM}, which is what the trail should say. The authority
     * came from the creator when they set the time and from the moderator who cleared the
     * campaign, and both are already in the trail above this row.
     *
     * @param now the instant the pass is judging against, so one pass reads one clock
     * @return the campaign if this pass launched it, empty if it was not this pass's to launch
     */
    @Transactional
    public Optional<Project> launchScheduled(UUID projectId, Instant now) {
        Project project =
                projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));

        if (project.getState() != ProjectState.APPROVED && project.getState() != ProjectState.SCHEDULED) {
            log.debug("Campaign {} is in {} and is not this pass's to launch.", projectId, project.getState());
            return Optional.empty();
        }
        Instant at = project.getScheduledLaunchAt();
        if (at == null || at.isAfter(now)) {
            log.debug("Campaign {} opens at {}, which is not yet.", projectId, at);
            return Optional.empty();
        }
        if (project.getGoalAmount() == null || project.getDurationDays() == null) {
            // Not reachable through the application -- §5.3 refuses a submission without
            // either, and a campaign cannot be approved without being submitted. Left as a
            // skip rather than a throw because a sweep that raises on one impossible row
            // stops launching everybody else's campaigns, and because the row would be
            // retried, and would fail, every minute for as long as it existed.
            log.warn("Campaign {} is due to launch and has no goal or no duration; skipping it.", projectId);
            return Optional.empty();
        }

        Project launched = apply(project, ProjectState.LIVE, ActorRole.SYSTEM, null, null);
        announceLaunch(launched);
        log.info("Campaign {} opened at its scheduled time of {}.", projectId, at);
        return Optional.of(launched);
    }

    /**
     * That a campaign is live, told twice on purpose.
     *
     * <p>Both halves are what {@link #launch} has always done and what the scheduled launch
     * must do identically — a campaign that opened on a timer and told nobody is the same
     * defect as one that did not open. The event is recorded from the row rather than from
     * anything the caller computed, so the instants are the ones the campaign now carries.
     */
    private void announceLaunch(Project launched) {
        outbox.record(
                ProjectLaunchedEvent.AGGREGATE_TYPE,
                launched.getId(),
                ProjectLaunchedEvent.EVENT_TYPE,
                ProjectLaunchedEvent.of(launched));
        events.publishEvent(new ProjectEvents.ProjectLaunched(launched.getId()));
    }

    /**
     * Stops a live campaign at the creator's request: {@code LIVE} →
     * {@code CANCELED}, which is terminal.
     *
     * @param reason shown to backers, who committed money to something that is not
     *     going to happen. Required for that reason and recorded on the audit row
     */
    @Transactional
    public Project cancel(UUID projectId, UUID accountId, String reason) {
        Project project = access.requireTransitionable(projectId, accountId);
        String note = requireHaltReason(reason);
        Project canceled =
                apply(project, ProjectState.CANCELED, access.roleOf(project, accountId), accountId, note);
        return announceHalt(canceled, note);
    }

    /**
     * Trust and safety stops a campaign: {@code LIVE} → {@code SUSPENDED}, which is
     * terminal — §4.11's AD-02 (#103).
     *
     * <p><strong>Terminal by design, and {@link ProjectState#SUSPENDED} says why:</strong>
     * a suspension that could be lifted back into {@code LIVE} would restart a funding
     * window whose deadline has moved on, so a campaign cleared after an investigation
     * starts again as a campaign rather than resuming one whose backers have been told it
     * was stopped.
     *
     * <p><strong>Staff only, through {@code requireModeratable}</strong> — the same
     * configured list the three moderation decisions use, for the reason §10.2 gives:
     * two lists that can disagree about who is staff is worse than one dependency that
     * epic #100 deletes. It is audited for the same reason those are, and the reason is
     * required because it is the only thing anybody — the creator, a backer, a
     * regulator — is ever told about why.
     *
     * <p><strong>What happens to the money is not decided here.</strong> Every pledge on
     * the campaign has to stop being a pledge and give its place back, and that is the
     * pledge module's; this announces the halt through the outbox and
     * {@code CampaignHaltedEvent} explains why an event rather than a call.
     */
    @Transactional
    public Project suspend(UUID projectId, UUID moderatorId, String reason) {
        Project project = access.requireModeratable(projectId, moderatorId);
        String note = requireHaltReason(reason);
        Project suspended =
                moderate(project, ProjectState.SUSPENDED, AuditAction.PROJECT_SUSPENDED, moderatorId, note);
        return announceHalt(suspended, note);
    }

    /**
     * Records the halt through §8.3's outbox, in the transaction that performed it.
     *
     * <p>One place for both edges, because the consumer's work is identical: the pledges
     * on a campaign that was cancelled and on one that was suspended both stop and both
     * give their places back. What differs is the event type, which is what lets a
     * consumer that does care — a message to backers — tell the two apart.
     */
    private Project announceHalt(Project project, String reason) {
        outbox.record(
                CampaignHaltedEvent.AGGREGATE_TYPE,
                project.getId(),
                CampaignHaltedEvent.eventTypeFor(project.getState()),
                CampaignHaltedEvent.of(project, reason));
        return project;
    }

    /**
     * A campaign does not stop without somebody saying why.
     *
     * <p>Both halts require it and neither is a formality: a cancellation abandons
     * commitments people made with their card details on file, and a suspension is the
     * platform taking somebody's funding down. §5.5 says backers are told, and the note
     * on the transition row is what they are told from.
     */
    private static String requireHaltReason(String reason) {
        if (reason == null || reason.isBlank()) {
            throw new ProjectFieldRejectedException(
                    "reason", "Backers are told why a campaign was stopped, so a reason is required.");
        }
        return reason.trim();
    }

    /**
     * §4.5's PL-16 and §4.8's PM-23: opens the late-pledge window.
     * {@code COLLECTING} → {@code LATE_PLEDGE}.
     *
     * <p><strong>The creator alone</strong>, through the two-argument
     * {@code requireTransitionable} that {@link #launch} and {@link #cancel} use rather
     * than a capability. It is the same kind of decision as those two: it takes money
     * from people, and it commits the campaign to manufacturing and posting more of
     * something than it has counted.
     *
     * <p><strong>Two preconditions beyond the edge, and they are different
     * questions.</strong> The campaign must have <em>enabled</em> late pledges — the
     * editor's switch, which is the creator saying they offer them at all — and the
     * window must end in the future and within
     * {@link az.ideanest.project.ProjectProperties.LatePledges#maxWindow()}. Enabling
     * is a standing decision and the window is this one; keeping them apart is what
     * lets a creator who runs out of stock switch the feature off and stop taking
     * pledges on the next request, without a transition they cannot reverse.
     *
     * <p><strong>What is not checked is the campaign's stock</strong>, deliberately. A
     * limited tier holds its own places and refuses the pledge that would oversell it
     * — §4.5's PL-13, which does not care whether the campaign is live or late — and a
     * check here would be a second, weaker copy of that rule evaluated once at the
     * moment the window opened.
     *
     * @param endsAt when the window closes. Required: a late-pledge window with no end
     *     is a campaign that never stops taking money, and the state machine has no
     *     edge that would close it automatically
     * @throws LatePledgesNotEnabledException when the creator has not switched the
     *     feature on for this campaign
     * @throws ProjectFieldRejectedException when the window is in the past or beyond
     *     the platform's bound
     */
    @Transactional
    public Project openLatePledges(UUID projectId, UUID accountId, Instant endsAt) {
        Project project = access.requireTransitionable(projectId, accountId);
        requireEdge(project.getState(), ProjectState.LATE_PLEDGE);

        if (!project.isLatePledgeEnabled()) {
            throw new LatePledgesNotEnabledException(projectId);
        }
        Instant now = clock.instant();
        if (endsAt == null || !endsAt.isAfter(now)) {
            throw new ProjectFieldRejectedException(
                    "endsAt", "A late-pledge window has to end in the future.");
        }
        Instant furthest = now.plus(properties.latePledges().maxWindow());
        if (endsAt.isAfter(furthest)) {
            throw new ProjectFieldRejectedException(
                    "endsAt",
                    "A late-pledge window may run for at most "
                            + properties.latePledges().maxWindow().toDays() + " days.");
        }

        // The window and the state, in one transaction. A campaign in LATE_PLEDGE with
        // no window would refuse every pledge -- PledgeAcceptance requires all three
        // facts -- and would look, to its creator, like a feature that does not work.
        project.openLatePledgesUntil(endsAt.truncatedTo(ChronoUnit.MICROS));
        return apply(
                project,
                ProjectState.LATE_PLEDGE,
                access.roleOf(project, accountId),
                accountId,
                "Late pledges accepted until " + endsAt);
    }

    /**
     * Stops taking late pledges and starts delivering: {@code LATE_PLEDGE} →
     * {@code FULFILLING}.
     *
     * <p>The window is left where it is rather than cleared. It is a true statement
     * about the period this campaign accepted late pledges in, the state is what
     * decides whether one is accepted now, and clearing it would also mean clearing
     * {@code latePledgeEnabled} — {@code projects_late_pledge_window_needs_the_feature}
     * ties the two — which would erase the fact that this campaign ever offered them.
     *
     * <p>Terminal in the direction that matters: §6.1 has no edge back, because
     * reopening late pledges after fulfilment has begun means shipping a second batch
     * of something the creator has already counted, packed, and posted.
     */
    @Transactional
    public Project closeLatePledges(UUID projectId, UUID accountId) {
        Project project = access.requireTransitionable(projectId, accountId);
        return apply(project, ProjectState.FULFILLING, access.roleOf(project, accountId), accountId, null);
    }

    /**
     * Applies §5.1 to a campaign whose deadline has passed: {@code LIVE} →
     * {@code SUCCESSFUL} or {@code LIVE} → {@code UNSUCCESSFUL}, and freezes the numbers
     * that decided it.
     *
     * <p><strong>The first transition performed by nobody</strong>, which is what the
     * {@link ActorRole#SYSTEM} parameter on {@link #apply} has been waiting for since this
     * class was written — its own comment says so. There is no account, so there is no
     * authorisation check and no capability: the deadline is the authority, and
     * {@code project_state_transitions} takes a null actor for exactly this role.
     *
     * <p><strong>Two things commit or neither does</strong>: the state and V29's frozen
     * outcome. {@code CampaignFinalizer} adds the outbox event to the same transaction,
     * which is why it and not this method is the thing a sweep calls.
     *
     * <h2>Empty is the normal answer, not a failure</h2>
     *
     * <p>The row is loaded with {@code findByIdForUpdate}, so a second caller — another
     * replica whose lease overlapped, a redelivery, the same pass twice — waits, re-reads,
     * and finds the campaign already decided. It gets {@link Optional#empty()} rather than
     * an exception, because "somebody else finalised this" is the mechanism working. The
     * lease of §8.4 makes it rare; this is what makes it correct.
     *
     * <p>The deadline is re-checked here as well as in the sweep's query, and that is not
     * belt and braces: the query ran before the lock was taken, and between the two a
     * creator's campaign could have been suspended, cancelled, or — in a world with a
     * deadline extension — moved. What is read under the lock is what decides.
     *
     * @param projectId the campaign, already selected by
     *     {@link ProjectRepository#findClosedCampaigns}
     * @param now the finaliser's instant for this pass. Stamped on the transition row and
     *     on {@code projects.finalized_at}, so every campaign closed by one pass agrees
     *     about when the pass was
     * @return the finalised campaign, or empty when it was no longer this pass's to close
     * @throws ProjectNotFoundException when the campaign has been removed between the
     *     sweep's query and the lock, which cannot happen today — nothing deletes a
     *     campaign — and is a fault rather than a skip if it ever does
     */
    @Transactional
    public Optional<Project> finalise(UUID projectId, Instant now) {
        Project project =
                projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));

        if (project.getState() != ProjectState.LIVE) {
            log.debug("Campaign {} is in {} and is not this pass's to finalise.", projectId, project.getState());
            return Optional.empty();
        }
        Instant deadline = project.getDeadline();
        if (deadline == null || deadline.isAfter(now)) {
            // A LIVE campaign always has a deadline — applyTransition computes one on the
            // edge into LIVE and refuses the edge without a duration — so the null branch
            // is unreachable through this service. It is here because "unreachable"
            // describes today's callers, and the alternative is a NullPointerException
            // inside a sweep that then stops closing everybody else's campaigns.
            log.debug("Campaign {} closes at {}, which is not yet.", projectId, deadline);
            return Optional.empty();
        }

        // Read before the transition and used for both halves, so the state a campaign is
        // moved to and the numbers frozen against it are one reading of one locked row.
        CampaignOutcome outcome = project.outcome(properties.finalisation().successThreshold());

        apply(project, outcome.state(), ActorRole.SYSTEM, null, decision(project));
        project.freezeOutcome(now);

        log.info(
                "Campaign {} closed {} with {} of {} from {} backers.",
                projectId,
                outcome,
                project.getOutcomePledgedAmount(),
                project.getOutcomeGoalAmount(),
                project.getOutcomeBackersCount());
        return Optional.of(project);
    }

    /**
     * §6.1's {@code SUCCESSFUL → COLLECTING}: the campaign's cards start being charged
     * (#64).
     *
     * <p><strong>Two states and not one, and this method is why they are worth
     * having.</strong> §5.1's successful branch says "collect every confirmed pledge",
     * and a platform that decided and charged in one transaction could not tell you,
     * after a crash, which of the two it had done. {@code CampaignFinalizer} writes the
     * decision and stops; this reads it and starts the money moving, and the durable
     * record between them is the state itself.
     *
     * <p>Claimed the way {@link #finalise} claims: the row is locked and the state
     * re-read under the lock, so a second replica arriving mid-pass finds
     * {@code COLLECTING} and does nothing. That matters as much here as it does there —
     * opening a collection twice would queue a campaign's pledges twice, and the second
     * queuing would reset every backer's attempt count to zero and hand them four fresh
     * attempts at a card that had already been refused four times.
     *
     * <p><strong>It does not queue the pledges.</strong> Those are the pledge module's
     * rows and §16.1 forbids reaching for them from here; {@code CampaignCollection}
     * composes the two inside one transaction, which is where the requirement that they
     * commit together is stated.
     *
     * @param projectId a campaign {@link ProjectRepository#findAwaitingCollection} selected
     * @param now the pass's instant, stamped on the transition row
     * @return the campaign, or empty when it was no longer this pass's to open
     */
    @Transactional
    public Optional<Project> beginCollection(UUID projectId, Instant now) {
        Project project =
                projects.findByIdForUpdate(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));

        if (project.getState() != ProjectState.SUCCESSFUL) {
            log.debug("Campaign {} is in {} and is not this pass's to collect.", projectId, project.getState());
            return Optional.empty();
        }

        apply(project, ProjectState.COLLECTING, ActorRole.SYSTEM, null, "Collection opened at " + now + ".");
        log.info("Campaign {} moved to COLLECTING.", projectId);
        return Optional.of(project);
    }

    /**
     * What the transition row says about a decision nobody made.
     *
     * <p>Every other transition's note is either absent or something a person wrote. This
     * one has no person, and a history row reading only {@code LIVE -> UNSUCCESSFUL} with
     * a null actor and no reason is the row somebody will be staring at when a creator
     * asks why their campaign closed. The comparison is written out because it is the
     * entire reason — and because the frozen columns it repeats are on {@code projects},
     * where a later schema change could move them and leave the history unreadable.
     *
     * <p>Read off the campaign before the freeze, so the amounts are the live ones the
     * decision was actually taken on; {@link Project#freezeOutcome} then stores the same
     * two numbers.
     */
    private static String decision(Project project) {
        return "Raised %s of %s %s from %d backers at the deadline."
                .formatted(
                        project.getPledgedAmount(),
                        project.getGoalAmount(),
                        project.getCurrency(),
                        project.getBackersCount());
    }

    /** Moderation clears a campaign: {@code SUBMITTED} → {@code APPROVED}. */
    @Transactional
    public Project approve(UUID projectId, UUID moderatorId, String note) {
        Project project = access.requireModeratable(projectId, moderatorId);
        return moderate(project, ProjectState.APPROVED, AuditAction.PROJECT_APPROVED, moderatorId, note);
    }

    /**
     * Moderation refuses a campaign: {@code SUBMITTED} → {@code REJECTED}, which is
     * terminal.
     *
     * @param note why. Required, because the creator is shown it and a rejection
     *     without a reason produces a support ticket every time
     */
    @Transactional
    public Project reject(UUID projectId, UUID moderatorId, String note) {
        Project project = access.requireModeratable(projectId, moderatorId);
        return moderate(project, ProjectState.REJECTED, AuditAction.PROJECT_REJECTED, moderatorId, requireNote(note));
    }

    /**
     * Moderation sends a campaign back: {@code SUBMITTED} →
     * {@code CHANGES_REQUESTED}.
     *
     * <p>Not in §10.2's endpoint list, and required by this epic's definition of
     * done. A queue whose only outcomes are approve and reject forces a moderator
     * to reject a campaign over a fixable summary, and a rejection is terminal.
     *
     * @param note what to change. Required: it is the entire content of the state
     */
    @Transactional
    public Project requestChanges(UUID projectId, UUID moderatorId, String note) {
        Project project = access.requireModeratable(projectId, moderatorId);
        return moderate(
                project,
                ProjectState.CHANGES_REQUESTED,
                AuditAction.PROJECT_CHANGES_REQUESTED,
                moderatorId,
                requireNote(note));
    }

    /**
     * The three transitions platform staff perform, and the only three that reach
     * {@code audit_logs} from here.
     *
     * <p><strong>Both records, and they are not duplicates.</strong>
     * {@code project_state_transitions} is the campaign's history: it belongs to the
     * campaign, the creator's own screen reads it, and it has a row for every edge
     * including the ones the creator walked themselves. {@code audit_logs} is the
     * platform's record of authority being exercised, and it is read by whoever is
     * asking what staff did — across every module, in one place, and with the
     * request's source address and correlation identifiers on the row, none of which
     * the transitions table carries. Keeping the moderation decisions in only one of
     * the two would mean either a campaign history with staff decisions missing from
     * it, or an audit surface that cannot answer "what has this moderator done"
     * without joining across every feature's own table.
     *
     * <p>In the same transaction as both the state change and the transition row, so
     * the three commit together or none of them does.
     *
     * <p><strong>The note is deliberately not copied into the audit detail.</strong>
     * It is free text a moderator wrote about a person's campaign, it is already on
     * the transition row, and {@code audit_logs} is the one table with no way to
     * remove a row afterwards. What goes in instead is the edge, which is the fact
     * an audit reader is after.
     */
    private Project moderate(
            Project project, ProjectState target, AuditAction action, UUID moderatorId, String note) {

        ProjectState from = project.getState();
        Project moderated = apply(project, target, ActorRole.MODERATOR, moderatorId, note);
        audit.record(
                action,
                moderated.getId(),
                AuditActor.moderator(moderatorId),
                AuditOutcome.SUCCEEDED,
                from + " -> " + target);
        return moderated;
    }

    /**
     * The one implementation of "change a campaign's state".
     *
     * @param actorId null only for {@link ActorRole#SYSTEM}; the database enforces
     *     that, so a code path that lost the caller fails loudly rather than
     *     writing an anonymous decision
     */
    private Project apply(Project project, ProjectState target, ActorRole role, UUID actorId, String note) {
        ProjectState from = project.getState();
        requireEdge(from, target);

        // Truncated to what the column can hold. PostgreSQL stores microseconds,
        // and a deadline computed from a nanosecond-precision launch would come
        // back from the database as a different instant than the one the response
        // just reported.
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        project.applyTransition(target, now);

        // Same transaction as the state change. Not an event, not an after-commit
        // hook: an audit row that can fail independently of the thing it audits is
        // an audit trail with gaps in exactly the circumstances that produce
        // incidents.
        transitions.save(ProjectStateTransition.of(project.getId(), from, target, role, actorId, note));

        log.info("Project {} moved from {} to {} by {} {}.", project.getId(), from, target, role, actorId);
        return project;
    }

    /**
     * The edge check, as a 409 the client can act on.
     *
     * <p>{@link Project#applyTransition} refuses the same move with an
     * {@link IllegalStateException}, deliberately: by the time it is reached this
     * check has already passed, so an exception from there means a caller bypassed
     * the service, which is a bug and not a request to be answered politely.
     */
    private static void requireEdge(ProjectState from, ProjectState to) {
        if (!ProjectStateMachine.isAllowed(from, to)) {
            throw new ProjectTransitionNotAllowedException(from, to);
        }
    }

    /**
     * A moderation outcome the creator has to act on must say what to act on.
     *
     * <p>Enforced here rather than with an annotation on the request record so
     * that approving — where a note is optional commentary — can share the same
     * body type. The reason belongs to the decision, not to the shape of the JSON.
     */
    private static String requireNote(String note) {
        if (note == null || note.isBlank()) {
            throw new ProjectFieldRejectedException("note", "A moderation decision the creator sees needs a reason.");
        }
        return note.trim();
    }

    private static void requireLaunchable(Project project) {
        List<String> missing = new ArrayList<>();
        if (project.getGoalAmount() == null) {
            missing.add("goal");
        }
        if (project.getDurationDays() == null) {
            missing.add("durationDays");
        }
        if (!missing.isEmpty()) {
            throw new ProjectNotLaunchableException(missing);
        }
    }
}
