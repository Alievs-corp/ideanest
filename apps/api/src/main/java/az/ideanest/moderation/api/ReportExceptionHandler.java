package az.ideanest.moderation.api;

import az.ideanest.moderation.application.ReportAlreadyResolvedException;
import az.ideanest.moderation.application.ReportDetailRequiredException;
import az.ideanest.moderation.application.ReportNotFoundException;
import az.ideanest.moderation.application.ReportTargetNotFoundException;
import az.ideanest.moderation.application.SelfReportException;
import az.ideanest.moderation.application.UnsupportedReportTargetException;
import az.ideanest.moderation.domain.ReportState;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * This module's failures, as RFC 9457 problem details.
 *
 * <p>Scoped to this module's two controllers rather than applied globally, for the
 * reason every other advice in the service gives: an advice that catches a broad type
 * across the whole application turns a bug somewhere else into a tidy 4xx and hides
 * it.
 *
 * <p>Every response carries a {@code code} as well as a status, per §10.4. The status
 * tells a client how to behave; the code tells it what happened, and it is what a
 * client branches on — two different 409s that cannot be told apart force clients to
 * match on prose.
 */
@RestControllerAdvice(assignableTypes = {ContentReportController.class, ReportQueueController.class})
public class ReportExceptionHandler {

    /**
     * 404 for something there is nothing to report.
     *
     * <p>The same answer whether the identifier names nothing, names a campaign that
     * is still a draft, or names one trust and safety has already suspended.
     * {@code PublicProjects} draws that line and this inherits it: distinguishing the
     * three would turn the report endpoint into an oracle for what other people are
     * preparing, which every other public endpoint in the service refuses to be.
     *
     * <p>The body names the kind of thing, which the client already knew from the
     * route it called, and never says which of the three cases it was.
     */
    @ExceptionHandler(ReportTargetNotFoundException.class)
    public ProblemDetail handleTargetNotFound(ReportTargetNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/report-target-not-found"));
        problem.setTitle("Nothing to report");
        problem.setDetail("There is nothing there to report.");
        problem.setProperty("code", "REPORT_TARGET_NOT_FOUND");
        problem.setProperty("meta", Map.of("targetType", exception.targetType().name()));
        return problem;
    }

    /**
     * 501 for a surface this release cannot accept reports about.
     *
     * <p>The one place in the service where a 5xx is the honest answer to a
     * well-formed request. It is not the client's mistake — nothing it sent is wrong,
     * and there is nothing it can change to make the request work — and a 400 would
     * send a developer looking for a bug in their own code. 404 would be a lie about
     * the route existing.
     *
     * <p>Unreachable through the two routes this release publishes; see
     * {@link UnsupportedReportTargetException} for why the branch exists anyway.
     */
    @ExceptionHandler(UnsupportedReportTargetException.class)
    public ProblemDetail handleUnsupportedTarget(UnsupportedReportTargetException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_IMPLEMENTED);
        problem.setType(URI.create("https://ideanest.az/problems/report-target-unsupported"));
        problem.setTitle("Not reportable yet");
        problem.setDetail("Reports about that kind of content cannot be accepted yet.");
        problem.setProperty("code", "REPORT_TARGET_UNSUPPORTED");
        problem.setProperty("meta", Map.of("targetType", exception.targetType().name()));
        return problem;
    }

    /**
     * 400 for an account reporting itself.
     *
     * <p>Not a 409: nothing about the state of the world refuses this, and nothing
     * the caller waits for will make it work. The request names the caller, which is
     * a mistake in the request.
     */
    @ExceptionHandler(SelfReportException.class)
    public ProblemDetail handleSelfReport(SelfReportException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/cannot-report-self"));
        problem.setTitle("Cannot report yourself");
        // Deliberately not the exception's message, which names the account.
        problem.setDetail("An account cannot report itself.");
        problem.setProperty("code", "CANNOT_REPORT_SELF");
        return problem;
    }

    /**
     * 400 for {@code OTHER} with nothing written.
     *
     * <p>{@code meta} names the field so the client can put the message beside the
     * text box rather than in a banner over the whole form — which is the difference
     * between somebody finishing their report and somebody giving up on it.
     */
    @ExceptionHandler(ReportDetailRequiredException.class)
    public ProblemDetail handleDetailRequired(ReportDetailRequiredException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/report-detail-required"));
        problem.setTitle("Say what is wrong");
        problem.setDetail("A report of " + exception.reason().name() + " has to say what is wrong.");
        problem.setProperty("code", "REPORT_DETAIL_REQUIRED");
        problem.setProperty("meta", Map.of("field", "detail", "reason", exception.reason().name()));
        return problem;
    }

    /**
     * 404 for a report identifier that is not one.
     *
     * <p>Unlike most 404s here it hides nothing: the caller has already been
     * established as platform staff by the time this can be raised.
     */
    @ExceptionHandler(ReportNotFoundException.class)
    public ProblemDetail handleReportNotFound(ReportNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/report-not-found"));
        problem.setTitle("No such report");
        problem.setDetail("That report does not exist.");
        problem.setProperty("code", "REPORT_NOT_FOUND");
        return problem;
    }

    /**
     * 409 for a report somebody has already decided.
     *
     * <p>Not a 400: the request was well formed and would have been accepted a moment
     * earlier, and the usual way to reach this is two moderators with the same queue
     * open. The body carries the state the report is actually in and what it can
     * still become — empty, because both resolutions are terminal — so a stale queue
     * corrects itself from the refusal instead of reloading and guessing.
     */
    @ExceptionHandler(ReportAlreadyResolvedException.class)
    public ProblemDetail handleAlreadyResolved(ReportAlreadyResolvedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/report-already-resolved"));
        problem.setTitle("Already decided");
        problem.setDetail(
                "That report has already been " + exception.state().name().toLowerCase(Locale.ROOT) + ".");
        problem.setProperty("code", "REPORT_ALREADY_RESOLVED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("state", exception.state().name());
        meta.put("allowed", names(exception.state().allowedNext()));
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 403 for a caller who is signed in and is not platform staff.
     *
     * <p>Not a 404, for the reason {@code NotAModeratorException} gives: the refusal
     * happens before any report is loaded, so there is no report to be evasive about,
     * and an operator whose moderator list is unconfigured needs to be told that
     * rather than shown a missing endpoint.
     *
     * <p><strong>The body is a second copy of the project module's, deliberately.</strong>
     * The exception is shared — there is one answer to "who is staff", and keeping two
     * would be two answers that can disagree — but an advice is scoped to a set of
     * controllers, and adding these two to {@code ProjectExceptionHandler} would mean
     * the project module's advice handling this module's endpoints. The duplicated
     * body is four lines; the shared exception is the part that matters, and epic
     * #100 removes both together.
     */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotAModerator(NotAModeratorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-moderator"));
        problem.setTitle("Not a moderator");
        // Deliberately not the exception's message, which names the account.
        problem.setDetail("The report queue is read and cleared by platform staff.");
        problem.setProperty("code", "NOT_A_MODERATOR");
        return problem;
    }

    /**
     * 403 for a colleague on a surface that is not theirs.
     *
     * <p>A different refusal from the one above and deliberately not collapsed into it: that
     * one says "you do not work here", this one names the capability the caller is short of,
     * and only the second can be fixed by asking an administrator for a role. The console
     * reads {@code meta.capability} off this body and says which — and it is what the rail
     * hides an entry on, so the two agree about the report queues, which are a moderator's work and not a curator's.
     */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    private static List<String> names(List<ReportState> states) {
        return states.stream().map(ReportState::name).toList();
    }
}
