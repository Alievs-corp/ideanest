package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.PublishingAllowance;
import az.ideanest.shared.access.PublishingEntitlement;
import java.math.BigDecimal;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Whether this campaign may be sent for review, given what its creator has paid for.
 *
 * <h2>Why this class exists rather than four lines inside {@code submit}</h2>
 *
 * <p>Two reasons, and the second is the load-bearing one.
 *
 * <p>It is testable without a state machine. The rules here are arithmetic over an
 * allowance and a count, and a test that had to construct a campaign in
 * {@code CHANGES_REQUESTED} to check that a goal of 10,001 is one manat too large is a test
 * about the wrong thing.
 *
 * <p>And it keeps {@code ProjectTransitionService}'s one guarantee legible. That class
 * exists so that "the edge is checked, the state is written, the history is appended"
 * happens in one place and cannot drift; every rule inlined into it makes that harder to
 * see. The checklist is already a collaborator there for the same reason, and this sits
 * beside it.
 *
 * <h2>The counting is here because the rows are here</h2>
 *
 * <p>The subscription module answers what a plan permits and does not know how many
 * campaigns the account is holding — {@code PublishingAllowance} has the argument. So the
 * allowance crosses the boundary and the comparison happens on this side, against the
 * project module's own query.
 *
 * <h2>Two refusals, because they lead somewhere different</h2>
 *
 * <p>{@link SubscriptionRequiredException} means "you have not paid", and the web client
 * answers it by navigating to the pricing page. {@link PlanLimitExceededException} means
 * "you have paid and this does not fit", where the answer may be to withdraw a campaign or
 * lower a goal — so it is rendered in place. Collapsing them into one refusal would send a
 * paying customer to a price list to solve a problem money need not solve.
 *
 * <h2>A super admin is not asked</h2>
 *
 * <p>The operator would be paying the platform for the platform's own campaigns, so a
 * creator holding {@code SUPER_ADMIN} passes without a plan and without a plan's limits.
 * Every other staff role still buys one: a moderator's campaign is a creator's campaign.
 */
@Service
public class PublishingGate {

    private static final Logger log = LoggerFactory.getLogger(PublishingGate.class);

    private final PublishingEntitlement entitlement;
    private final ProjectRepository projects;
    private final PlatformStaff staff;

    public PublishingGate(PublishingEntitlement entitlement, ProjectRepository projects, PlatformStaff staff) {
        this.entitlement = entitlement;
        this.projects = projects;
        this.staff = staff;
    }

    /**
     * Refuses unless this campaign's creator may submit it.
     *
     * <p>Checked against <strong>the creator</strong> and not against whoever pressed the
     * button. #38 lets a collaborator hold {@code SUBMIT_FOR_REVIEW}, and a collaborator is
     * somebody the creator invited to work on <em>their</em> campaign — billing the
     * helper's account for it would mean a creator could publish without a subscription by
     * inviting a friend who has one, and would charge somebody for work they were doing as
     * a favour.
     *
     * <p>Three checks, in the order a creator can act on them: whether there is a
     * subscription at all, then how many campaigns it covers, then how large a goal. A
     * creator with no plan is not also told their goal is too big for the plan they do not
     * have.
     *
     * <p><strong>Asked again when the campaign is approved and when it opens</strong> (#587),
     * not only at submission. Nothing is locked between submitting and launching — the goal
     * stays editable, the creator may submit other campaigns, a plan may lapse — so a check
     * made once at submission let a campaign go live over the ceiling it was submitted under.
     *
     * @throws SubscriptionRequiredException when the creator holds no entitlement
     * @throws PlanLimitExceededException when they hold one and it does not stretch to this
     */
    @Transactional(readOnly = true)
    public void requireEntitled(Project project) {
        Optional<RuntimeException> refusal = refusalOf(project);
        if (refusal.isPresent()) {
            throw refusal.get();
        }
    }

    /**
     * {@link #requireEntitled} as a question, for a caller that has to skip rather than refuse:
     * why this campaign may not be published, or empty when it may.
     *
     * <p>The scheduled launch is that caller (#587). It shares one transaction with the
     * campaign it is opening, and an exception leaving this proxy would mark that transaction
     * rollback-only even if the caller caught it, which is the failure {@code RiskAssessments}
     * documents. The refusal is built and never thrown, so nothing is marked; its sentence is
     * what the caller records — a plan code and a bound, nothing personal.
     */
    @Transactional(readOnly = true)
    public Optional<String> refusalReason(Project project) {
        return refusalOf(project).map(Throwable::getMessage);
    }

    private Optional<RuntimeException> refusalOf(Project project) {
        if (staff.isSuperAdmin(project.getCreatorId())) {
            return Optional.empty();
        }

        PublishingAllowance allowance = entitlement.allowanceOf(project.getCreatorId());

        if (!allowance.subscribed()) {
            log.info(
                    "Campaign {} refused publishing: creator {} holds no subscription",
                    project.getId(),
                    project.getCreatorId());
            return Optional.of(new SubscriptionRequiredException(project.getId()));
        }

        // Excluding this campaign, which is already counted when a rejected one is being
        // resubmitted -- and would then refuse every creator on a one-campaign plan.
        long held = projects.countInPlatformHands(project.getCreatorId(), project.getId());
        if (!allowance.permitsAnother(held)) {
            return Optional.of(PlanLimitExceededException.tooManyCampaigns(
                    project.getId(), allowance.planCode(), allowance.maxActiveCampaigns(), held));
        }

        BigDecimal goal = project.getGoalAmount();
        if (!allowance.permitsGoal(goal, project.getCurrency())) {
            return Optional.of(PlanLimitExceededException.goalTooLarge(
                    project.getId(), allowance.planCode(), allowance.goalCeiling(), goal, project.getCurrency()));
        }
        return Optional.empty();
    }
}
