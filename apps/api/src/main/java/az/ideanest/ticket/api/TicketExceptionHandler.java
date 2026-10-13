package az.ideanest.ticket.api;

import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.ticket.application.RequesterRequiredException;
import az.ideanest.ticket.application.TicketNotFoundException;
import az.ideanest.ticket.application.UnknownPledgeException;
import az.ideanest.ticket.application.UnknownRequesterException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * AD-10's refusals — issue #310.
 *
 * <p>Scoped to {@link SupportTicketController}, for the reason every advice in this service
 * gives.
 */
@RestControllerAdvice(assignableTypes = SupportTicketController.class)
public class TicketExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /** 404 for a ticket identifier that names nothing. */
    @ExceptionHandler(TicketNotFoundException.class)
    public ProblemDetail handleNotFound(TicketNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/ticket-not-found"));
        problem.setTitle("No such ticket");
        problem.setDetail("No ticket with that identifier.");
        problem.setProperty("code", "TICKET_NOT_FOUND");
        return problem;
    }

    /** 404 for a requester or assignee who does not exist. */
    @ExceptionHandler(UnknownRequesterException.class)
    public ProblemDetail handleUnknownAccount(UnknownRequesterException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/account-not-found"));
        problem.setTitle("No such account");
        problem.setDetail("No account with that identifier.");
        problem.setProperty("code", "ACCOUNT_NOT_FOUND");
        return problem;
    }

    /** 404 for a ticket left to the backer of a pledge that does not exist — #416. */
    @ExceptionHandler(UnknownPledgeException.class)
    public ProblemDetail handleUnknownPledge(UnknownPledgeException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-not-found"));
        problem.setTitle("No such pledge");
        problem.setDetail("No pledge with that identifier.");
        problem.setProperty("code", "PLEDGE_NOT_FOUND");
        return problem;
    }

    /** 400 for a ticket that names no requester and is not about a pledge — #416. */
    @ExceptionHandler(RequesterRequiredException.class)
    public ProblemDetail handleRequesterRequired(RequesterRequiredException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/ticket-requester-required"));
        problem.setTitle("No requester");
        problem.setDetail("Name the requester, or raise the ticket about a pledge to raise it for the pledge's backer.");
        problem.setProperty("code", "TICKET_REQUESTER_REQUIRED");
        return problem;
    }

    /**
     * 400 for an internal note attributed to the requester.
     *
     * <p>{@code TicketMessage}'s constructor refuses it, and V51 refuses it again. Narrow
     * enough to catch here: this controller does no arithmetic or parsing that could throw
     * an {@link IllegalArgumentException} for another reason.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleBadMessage(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/ticket-message-invalid"));
        problem.setTitle("That message cannot be written");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "TICKET_MESSAGE_INVALID");
        return problem;
    }
}
