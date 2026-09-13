package az.ideanest.project.api;

import az.ideanest.project.application.AgreementRequiredException;
import az.ideanest.project.application.CapabilityNotGrantedException;
import az.ideanest.project.application.ExtensionNotAvailableException;
import az.ideanest.project.application.LatePledgesNotEnabledException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.project.application.ProjectFieldLockedException;
import az.ideanest.project.application.ProjectFieldRejectedException;
import az.ideanest.project.application.ProjectNotFoundException;
import az.ideanest.project.application.ProjectNotLaunchableException;
import az.ideanest.project.application.PlanLimitExceededException;
import az.ideanest.project.application.ProjectNotSubmittableException;
import az.ideanest.project.application.SubscriptionRequiredException;
import az.ideanest.project.application.UnreviewableStateException;
import az.ideanest.project.application.ProjectTransitionNotAllowedException;
import az.ideanest.project.application.RemindersClosedException;
import az.ideanest.project.domain.ProjectState;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The project module's own failures, as RFC 9457 problem details.
 *
 * <p>Scoped to this module's controllers rather than applied globally, for the
 * reason {@code AuthExceptionHandler} and {@code UserExceptionHandler} give: an
 * advice that catches a broad type across the whole service turns a bug somewhere
 * else into a tidy 4xx and hides it.
 *
 * <p>Every response carries a {@code code} as well as a status, per §10.4. The
 * status tells a client how to behave; the code tells it what happened, and it is
 * what a client branches on. Two different 409s that cannot be told apart would
 * force clients to match on prose.
 */
@RestControllerAdvice(
        assignableTypes = {
            ProjectController.class,
            ProjectModerationController.class,
            // And the suspension endpoint (#103), which raises three of the failures
            // below: a campaign that does not exist, a caller who is not staff, and a
            // move §6.1 does not allow -- a campaign that has already closed cannot be
            // suspended, and the client is told which state it is actually in.
            ProjectSuspensionController.class,
            // The public pre-launch endpoints raise four of the five failures
            // below unchanged — a campaign that does not exist, a field that is not
            // an address, a value type that refused its input. Listing the
            // controller here rather than writing a second advice is the same
            // reasoning ProjectProblems gives: one refusal should not have two
            // bodies, and the second one to be edited is the one nobody notices.
            PrelaunchController.class,
            // And the public campaign page (#119), which raises exactly one of the
            // failures below: a campaign that does not exist, or one whose state is
            // not public. Both must come back as the same 404 with the same code,
            // which is the whole reason for listing it here rather than letting the
            // exception escape — an unhandled one on a permitAll endpoint reaches
            // Spring Security's error dispatch and comes back as 401, which tells an
            // anonymous visitor to sign in to see a campaign that does not exist.
            PublicProjectController.class,
            // And the creator's dashboard (#93), which raises exactly two of the
            // failures below and needs both answered as they already are: a 404 for
            // a campaign the caller is not party to, so that the endpoint does not
            // confirm which identifiers are real, and a 403 for a collaborator whose
            // grant does not include VIEW_FINANCES.
            DashboardController.class,
            // The moderation submission queue, which raises two of them: a refusal
            // for a caller without MODERATE_CONTENT, and UNREVIEWABLE_STATE. Listed
            // rather than left out because this advice is scoped by type -- a
            // controller absent from this list answers 500 for failures every other
            // controller answers properly, which is how the queue's first run
            // reported a permission check as a server fault.
            SubmissionQueueController.class,
            // And the campaign directory beside it, which raises the same refusal for a
            // caller without MODERATE_CONTENT. Same list, same reason: the advice is
            // scoped by type, so an omission here is a permission check that answers 500.
            CampaignDirectoryController.class
        })
public class ProjectExceptionHandler {

    /**
     * 404 for a campaign that does not exist, and for one this caller may not see.
     *
     * <p>Deliberately the same answer. A draft is confidential — an unreleased
     * product, a price nobody has been told — and distinguishing "not yours" from
     * "not there" turns the editor into an oracle for what other people are
     * preparing.
     */
    @ExceptionHandler(ProjectNotFoundException.class)
    public ProblemDetail handleNotFound(ProjectNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-found"));
        problem.setTitle("No such project");
        problem.setDetail("That project does not exist.");
        problem.setProperty("code", "PROJECT_NOT_FOUND");
        return problem;
    }

    /**
     * 403 for a caller who is signed in and is not platform staff.
     *
     * <p>The one refusal in this module that is not a 404. See
     * {@link NotAModeratorException}: the endpoint is documented, the check happens
     * before any campaign is loaded, and an operator whose moderator list is
     * unconfigured needs to be told that rather than shown a missing endpoint.
     */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotAModerator(NotAModeratorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-moderator"));
        problem.setTitle("Not a moderator");
        // Deliberately not the exception's message, which names the account.
        problem.setDetail("Moderation decisions are taken by platform staff.");
        problem.setProperty("code", "NOT_A_MODERATOR");
        return problem;
    }

    /**
     * 403 for a member of staff whose role does not carry the authority this asked for.
     *
     * <p><strong>Not the same refusal as the one above, and it used to be a 500.</strong>
     * {@code PlatformStaff.requireCapability} raises either of two exceptions — this one
     * for somebody who does work here and holds the wrong role — and this advice is scoped
     * by type, so the one it did not name reached the fallback handler. A member of
     * finance staff opening the campaign directory was therefore told the server had
     * broken, which is the failure #400 was filed about and the reason every other
     * console advice in the service handles both.
     *
     * <p>{@link StaffRefusals} writes the body, so the capability that was wanted is named
     * in it and the console can say which authority it needed rather than "not allowed".
     */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficientCapability(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 400 for a state the submission queue does not serve.
     *
     * <p>A bad request rather than an empty page, and the distinction is the point:
     * asking for {@code LIVE} campaigns "for review" has an obvious empty answer, and a
     * moderator shown one would read it as "there is nothing to review" instead of as a
     * question this endpoint does not answer. The four it does answer are named in the
     * body, because a refusal that does not say what would have worked is a refusal
     * somebody has to read the source to act on.
     */
    @ExceptionHandler(UnreviewableStateException.class)
    public ProblemDetail handleUnreviewableState(UnreviewableStateException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/unreviewable-state"));
        problem.setTitle("Not a reviewable state");
        problem.setDetail("The submission queue serves SUBMITTED, CHANGES_REQUESTED, APPROVED and REJECTED.");
        problem.setProperty("code", "UNREVIEWABLE_STATE");
        problem.setProperty("state", exception.state().name());
        return problem;
    }

    /**
     * 403 for a collaborator who may work on this campaign and not in this way.
     *
     * <p>The second refusal in this module that is not a 404, and the reason
     * {@link ProjectNotFoundException} draws the distinction it does: the caller was
     * invited and can already read the campaign, so there is nothing left to hide
     * from them. What they are missing is a capability, and the response says which.
     *
     * <p>The body is built in {@link ProjectProblems} because the collaborator
     * endpoints raise the same failure, and one refusal should not have two bodies.
     */
    @ExceptionHandler(CapabilityNotGrantedException.class)
    public ProblemDetail handleCapabilityNotGranted(CapabilityNotGrantedException exception) {
        return ProjectProblems.capabilityNotGranted(exception);
    }

    /**
     * 409 for a move §6.1 does not allow.
     *
     * <p>Not a 400: the request was well formed and would have been accepted a
     * moment earlier. What refuses it is the state the campaign is in, which is
     * frequently the state another tab, or a moderator, has just put it in — so the
     * client is told where the campaign actually is and what it can do from there
     * instead of having to reload and guess.
     */
    @ExceptionHandler(ProjectTransitionNotAllowedException.class)
    public ProblemDetail handleTransitionNotAllowed(ProjectTransitionNotAllowedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/project-transition-not-allowed"));
        problem.setTitle("Transition not allowed");
        problem.setDetail("A project in " + exception.from() + " cannot move to " + exception.to() + ".");
        problem.setProperty("code", "PROJECT_TRANSITION_NOT_ALLOWED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("state", exception.from().name());
        meta.put("requested", exception.to().name());
        // Empty for a terminal state, which is what tells a client to stop offering
        // the action rather than to retry it.
        meta.put("allowed", names(exception.allowedInstead()));
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 409 for a campaign §5.3 will not let out of the door.
     *
     * <p>The refusal names every unmet requirement rather than the first, and gives
     * each one the editor section that fixes it — the same routing the checklist
     * endpoint gives, so a client refused here points at the controls it would have
     * pointed at anyway rather than showing a banner the creator has to interpret.
     *
     * <p>{@code detail} deliberately does not enumerate the requirements. It is
     * prose, it would be a sentence of unbounded length on a campaign missing eight
     * things, and §10.4 is explicit that a client branches on {@code code} and
     * {@code meta} rather than on prose.
     */
    @ExceptionHandler(ProjectNotSubmittableException.class)
    public ProblemDetail handleNotSubmittable(ProjectNotSubmittableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-submittable"));
        problem.setTitle("Campaign is not ready to submit");
        problem.setDetail("Some of what a campaign needs before it can be reviewed is still missing.");
        problem.setProperty("code", "PROJECT_NOT_SUBMITTABLE");
        problem.setProperty("meta", Map.of("unmet", unmet(exception)));
        return problem;
    }

    private static List<Map<String, Object>> unmet(ProjectNotSubmittableException exception) {
        return exception.unmet().stream()
                .map(item -> {
                    Map<String, Object> entry = new LinkedHashMap<>();
                    entry.put("requirement", item.requirement().name());
                    entry.put("label", item.requirement().label());
                    entry.put("section", item.requirement().section().key());
                    entry.put("detail", item.detail());
                    return entry;
                })
                .toList();
    }

    /**
     * <strong>403 for a creator who has not subscribed</strong> — the publishing gate.
     *
     * <p><strong>The one refusal in this module that the web client answers with a
     * navigation.</strong> Everything else here is fixed on the screen the creator is
     * already looking at; this cannot be, because what is missing is not on the campaign.
     * So {@code ReviewPanel} sends them to the pricing page, and the {@code code} is what
     * it branches on — §10.4, and prose is translated into four languages.
     *
     * <p>403 rather than 402 Payment Required. 402 has never had agreed semantics, is
     * treated as unusable by every specification that mentions it, and would be read by a
     * proxy or a browser extension as something other than "this account is not permitted
     * to do this" — which is exactly what it is.
     *
     * <p>{@code meta.pricingPath} rather than a bare flag, because the client should not
     * be assembling the platform's own routes out of a constant: the day the pricing page
     * moves, the server says so.
     */
    @ExceptionHandler(SubscriptionRequiredException.class)
    public ProblemDetail handleSubscriptionRequired(SubscriptionRequiredException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/subscription-required"));
        problem.setTitle("A plan is needed to publish");
        problem.setDetail("Building a campaign is free. Sending one for review needs an active plan.");
        problem.setProperty("code", "SUBSCRIPTION_REQUIRED");
        problem.setProperty("meta", Map.of("pricingPath", "/pricing"));
        return problem;
    }

    /**
     * <strong>403 for a creator who has not accepted the creator agreement</strong> — #426.
     *
     * <p><strong>A different code from {@code SUBSCRIPTION_REQUIRED}, and the client answers
     * it differently.</strong> That one means "you have not paid" and is answered by a
     * navigation to the pricing page. This means "you have not agreed to the terms you would
     * be operating under", and money does not fix it: the answer is the creator agreement,
     * at the version named here.
     *
     * <p>403 rather than 451 Unavailable For Legal Reasons, which is about a resource
     * withheld from a reader by law and not about a permission this account does not yet
     * hold. And rather than 428 Precondition Required, whose semantics are about request
     * headers.
     *
     * <p><strong>{@code meta} names the version, not only the document.</strong> A creator
     * who accepted version 3 and meets this because version 4 was published this morning
     * must be sent to version 4 — a refusal saying only "accept the creator agreement" would
     * send them to a page whose Accept button they have already pressed. {@code documentId}
     * is there so the client can render the exact text without resolving "current" a second
     * time and possibly getting a different answer.
     */
    @ExceptionHandler(AgreementRequiredException.class)
    public ProblemDetail handleAgreementRequired(AgreementRequiredException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/agreement-required"));
        boolean signature = exception.requirement() == AgreementRequiredException.Requirement.SIGNATURE;
        problem.setTitle(
                signature
                        ? "The creator agreement has to be signed first"
                        : "The creator agreement has to be accepted first");
        problem.setDetail(
                signature
                        ? "This campaign needs the creator agreement signed with SİMA İmza, not only accepted."
                        : "Sending a campaign for review means taking on the obligations in the creator agreement.");
        problem.setProperty("code", "AGREEMENT_REQUIRED");

        Map<String, Object> meta = new LinkedHashMap<>();
        // #429: one code, two next actions. A creator sent to tick a box they have already
        // ticked concludes the platform is broken.
        meta.put("requires", exception.requirement().name());
        meta.put("document", exception.agreement().kind().name());
        meta.put("documentId", exception.agreement().documentId());
        meta.put("version", exception.agreement().version());
        meta.put("effectiveFrom", exception.agreement().effectiveFrom().toString());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * <strong>403 for a creator whose plan does not stretch to this campaign.</strong>
     *
     * <p>Deliberately a different code from {@code SUBSCRIPTION_REQUIRED}, and the client
     * treats it differently: this creator has paid, and the answer may be to withdraw a
     * campaign or lower a goal rather than to buy anything. Sending them to a price list
     * would read as the platform trying to sell them something instead of answering them.
     *
     * <p>The numbers are on {@code meta} because the message has to name them. "You have
     * reached your limit" is not actionable; "Starter allows one campaign at a time and you
     * have one live" says both what to do and what changing plan would buy.
     */
    @ExceptionHandler(PlanLimitExceededException.class)
    public ProblemDetail handlePlanLimit(PlanLimitExceededException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/plan-limit-exceeded"));
        problem.setTitle("Your plan does not cover this");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "PLAN_LIMIT_EXCEEDED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("limit", exception.limit().name());
        meta.put("plan", exception.planCode());
        meta.put("allowed", exception.allowed());
        meta.put("actual", exception.actual());
        meta.put("pricingPath", "/pricing");
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 409 for an approved campaign with nothing to be live with.
     *
     * <p>See {@link ProjectNotLaunchableException}. Unreachable through the API now
     * that a submission is checked against §5.3 — a campaign with no goal cannot
     * reach {@code APPROVED} to be launched from — and kept because it is the last
     * thing between a campaign that got there another way and a constraint
     * violation served as a 500. A guard whose whole value is that it never fires
     * is not a guard to delete the moment it stops firing.
     */
    @ExceptionHandler(ProjectNotLaunchableException.class)
    public ProblemDetail handleNotLaunchable(ProjectNotLaunchableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-launchable"));
        problem.setTitle("Project cannot launch");
        problem.setDetail("A campaign cannot go live until its funding goal and duration are set.");
        problem.setProperty("code", "PROJECT_NOT_LAUNCHABLE");
        problem.setProperty("meta", Map.of("missing", exception.missing()));
        return problem;
    }

    /**
     * 409 for a reminder asked of a campaign that is not collecting them.
     *
     * <p>Not a 404: the caller is looking at a page we served them, so there is
     * nothing left to hide. Not a 400 either — the request was well formed and
     * would have been accepted a moment earlier, and frequently was: the usual way
     * to reach this is to leave a pre-launch page open until the campaign launches.
     *
     * <p>The body carries the state because the client's next move depends on it:
     * a campaign that is {@code LIVE} should be offered to the visitor to back,
     * and a campaign that was cancelled should not be offered at all. A client that
     * could only see "409" would have to guess.
     */
    @ExceptionHandler(RemindersClosedException.class)
    public ProblemDetail handleRemindersClosed(RemindersClosedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/reminders-closed"));
        problem.setTitle("Not collecting reminders");
        problem.setDetail("This campaign has already opened, so there is nothing left to be reminded about.");
        problem.setProperty("code", "REMINDERS_CLOSED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("state", exception.state().name());
        meta.put("acceptedIn", names(RemindersClosedException.ACCEPTED_IN));
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 409 for opening a late-pledge window on a campaign that does not offer them.
     *
     * <p>Not a 400 and not a 403. The request is well formed and the creator is
     * entitled to make it; what is missing is a decision they have not taken yet, and
     * the correction is one switch in the campaign editor. The code says which switch,
     * because "conflict" on its own would send a creator looking at §6.1.
     */
    @ExceptionHandler(ExtensionNotAvailableException.class)
    public ProblemDetail handleExtensionNotAvailable(ExtensionNotAvailableException exception) {
        // IDN-EXT-01 (#34). A 409 with the reason: each one sends a creator somewhere different.
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/extension-not-available"));
        problem.setTitle("This campaign cannot be extended now");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "EXTENSION_NOT_AVAILABLE");
        problem.setProperty("meta", Map.of("reason", exception.reason().name()));
        return problem;
    }

    @ExceptionHandler(LatePledgesNotEnabledException.class)
    public ProblemDetail handleLatePledgesNotEnabled(LatePledgesNotEnabledException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/late-pledges-not-enabled"));
        problem.setTitle("Late pledges are switched off");
        problem.setDetail("Turn late pledges on for this campaign before opening a window for them.");
        problem.setProperty("code", "LATE_PLEDGES_NOT_ENABLED");
        problem.setProperty("meta", Map.of("field", "latePledgeEnabled"));
        return problem;
    }

    /**
     * 409 for an edit to a field §5.3 froze at launch.
     *
     * <p>Not a 400, for the reason {@link ProjectFieldLockedException} gives and the
     * one {@link #handleTransitionNotAllowed} already gives: the value is fine and
     * the campaign's state is what refuses it. {@code meta} carries the field so the
     * editor can highlight it, and the state so it can say why without asking again
     * — and so that a client whose page is out of date learns, from the refusal, that
     * the campaign has gone live.
     */
    @ExceptionHandler(ProjectFieldLockedException.class)
    public ProblemDetail handleFieldLocked(ProjectFieldLockedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/project-field-locked"));
        problem.setTitle("Field locked");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "PROJECT_FIELD_LOCKED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("field", exception.field());
        meta.put("state", exception.state().name());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 400 for one field of an edit.
     *
     * <p>The field name is in {@code meta} so that the editor can put the message
     * beside the input rather than in a banner above a long form — which is the
     * difference between a creator fixing it and a creator writing to support.
     */
    @ExceptionHandler(ProjectFieldRejectedException.class)
    public ProblemDetail handleFieldRejected(ProjectFieldRejectedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/project-field-invalid"));
        problem.setTitle("Invalid field");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "PROJECT_FIELD_INVALID");
        problem.setProperty("meta", Map.of("field", exception.field()));
        return problem;
    }

    /**
     * The value objects reject what they cannot represent — a cover image with no
     * extent, a currency that is not a currency, an amount with three decimal
     * places. Reaching here means input the binding accepted and the type did not,
     * which is still the client's problem.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleIllegalArgument(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-request"));
        problem.setTitle("Invalid request");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_REQUEST");
        return problem;
    }

    private static List<String> names(List<ProjectState> states) {
        return states.stream().map(ProjectState::name).toList();
    }
}
