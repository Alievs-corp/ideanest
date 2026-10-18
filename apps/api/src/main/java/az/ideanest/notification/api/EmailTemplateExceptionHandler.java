package az.ideanest.notification.api;

import az.ideanest.notification.application.MissingTemplatePlaceholderException;
import az.ideanest.notification.application.TemplateCopyMalformedException;
import az.ideanest.notification.application.TemplateNotEmailedException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import jakarta.mail.MessagingException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.mail.MailException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What AD-15's endpoints refuse, as RFC 9457 problem details (§10.4).
 *
 * <p>Scoped to the two template controllers rather than added to
 * {@code NotificationExceptionHandler}, for that class's own reason: an advice covering
 * refusals only some of its controllers can raise is one that has to be read to rule out.
 * These are the template endpoints' alone — the inbox cannot fail to reach a relay, and
 * nothing else in this module is staff-only.
 *
 * <p><strong>One advice for both since the editor learned to preview.</strong> The editor's
 * preview and test send of unsaved text live on {@code EmailTemplateController} and can be
 * refused as malformed copy, and the editor's own routes can now be refused for a type with
 * no email column — so each controller raises the other's refusals, and two advices would be
 * two copies of each.
 */
@RestControllerAdvice(assignableTypes = {EmailTemplateController.class, EmailTemplateEditorController.class})
public class EmailTemplateExceptionHandler {

    /**
     * 403 for a caller who is signed in and is not platform staff.
     *
     * <p>A third copy of a four-line body, and {@code ReportExceptionHandler} makes the
     * argument for why that is right: the exception is shared, because there is one
     * answer to "who is staff" and two would be two answers that can disagree, but an
     * advice is scoped to controllers and borrowing another module's would mean the
     * project module's advice answering for this module's endpoints. Epic #100 removes
     * all three together.
     */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotAModerator(NotAModeratorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-moderator"));
        problem.setTitle("Not a moderator");
        // Deliberately not the exception's message, which names the account.
        problem.setDetail("Email templates are read by platform staff.");
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
     * hides an entry on, so the two agree about the platform's own email copy, which is configuration.
     */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /** 400 for the one type that has copy and no email column. */
    @ExceptionHandler(TemplateNotEmailedException.class)
    public ProblemDetail handleNotEmailed(TemplateNotEmailedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/template-not-emailed"));
        problem.setTitle("That notification is not sent by email");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "TEMPLATE_NOT_EMAILED");
        problem.setProperty("meta", Map.of("type", exception.type().name()));
        return problem;
    }

    /**
     * 502 when the relay would not take the test send.
     *
     * <p><strong>Not a 500.</strong> Nothing here is broken: the request was valid, the
     * template rendered, and an upstream the platform depends on refused. That
     * distinction is the whole of what an operator reading this needs — a 500 would send
     * them looking for a bug in the service, and the fault is in the mail configuration
     * or in the relay.
     *
     * <p>Both exception types, because a build failure and a send failure are checked and
     * unchecked respectively and a caller cannot act differently on them. The detail is
     * generic: a relay's refusal can quote an address.
     */
    @ExceptionHandler({MessagingException.class, MailException.class})
    public ProblemDetail handleRelayRefused(Exception exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_GATEWAY);
        problem.setType(URI.create("https://ideanest.az/problems/mail-relay-unavailable"));
        problem.setTitle("The message could not be sent");
        problem.setDetail("The mail relay did not accept the message.");
        problem.setProperty("code", "MAIL_RELAY_UNAVAILABLE");
        return problem;
    }

    /**
     * 422 when the edited copy drops something the shipped copy carries.
     *
     * <p>422 rather than 400: the request is well formed and the body is a perfectly good
     * sentence. It is refused for what it leaves out, which is a rule about content rather than
     * shape. The missing indices travel in {@code meta}, in numeric order, so the screen can
     * point at them.
     */
    @ExceptionHandler(MissingTemplatePlaceholderException.class)
    public ProblemDetail handleMissingPlaceholder(MissingTemplatePlaceholderException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/missing-template-placeholder"));
        problem.setTitle("The copy drops something it has to keep");
        problem.setDetail("This message carries facts the recipient needs. Keep every placeholder the "
                + "shipped copy uses.");
        problem.setProperty("code", "MISSING_TEMPLATE_PLACEHOLDER");
        problem.setProperty("meta", Map.of("missing", List.copyOf(exception.missing())));
        return problem;
    }

    /**
     * 422 when the edited copy would not render.
     *
     * <p>{@code meta.field} says which of the two texts, {@code meta.reason} is
     * {@code SYNTAX} or {@code UNKNOWN_PLACEHOLDER}, and {@code meta.placeholder} names the
     * index for the second.
     */
    @ExceptionHandler(TemplateCopyMalformedException.class)
    public ProblemDetail handleMalformed(TemplateCopyMalformedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/template-copy-malformed"));
        problem.setTitle("The copy would not render");
        problem.setDetail("Braces are only for placeholders such as {2}, and only for facts this message carries.");
        problem.setProperty("code", "TEMPLATE_COPY_MALFORMED");
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("field", exception.field());
        meta.put("reason", exception.reason().name());
        if (exception.placeholder() != null) {
            meta.put("placeholder", exception.placeholder());
        }
        problem.setProperty("meta", meta);
        return problem;
    }
}
