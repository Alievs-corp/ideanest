package az.ideanest.shared.api;

import az.ideanest.shared.idempotency.IdempotencyKeyReusedException;
import az.ideanest.shared.idempotency.IdempotentRequestInProgressException;
import az.ideanest.shared.idempotency.MalformedIdempotencyKeyException;
import az.ideanest.shared.idempotency.MissingIdempotencyKeyException;
import az.ideanest.shared.payment.InvalidReturnUrlException;
import az.ideanest.shared.ratelimit.RateLimitExceededException;
import az.ideanest.shared.ratelimit.RateLimits;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Errors that are not specific to any one module, as RFC 9457 problem details.
 *
 * <p>One shape for every error, so a client parses failures the same way
 * wherever they came from.
 *
 * <p><strong>§10.3's idempotency refusals are here rather than with the endpoint
 * that raised them</strong>, and that is the point of them being here. The header is
 * required on every payment mutation — the draft and the confirmation today, #56's
 * edit and cancellation and epic #59's charges tomorrow — and a client that learned
 * to handle {@code IDEMPOTENCY_KEY_REUSED} from one of them must get the same body
 * from all of them. A copy per module would be four chances for one of the four
 * codes to drift.
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    /**
     * How long a client is told to wait before retrying a request whose first attempt
     * is still running. One second: the work it is waiting on is a database
     * transaction, and the honest expectation is milliseconds.
     */
    private static final long RETRY_IN_PROGRESS_SECONDS = 1;

    /**
     * 400 for a payment mutation with no {@code Idempotency-Key}.
     *
     * <p>§10.3 makes it required, and a refusal is the only safe reading: treating an
     * absent header as "this client does not want replay protection" would make the
     * guarantee opt-in for exactly the clients most likely to need it, and the
     * symptom is a backer charged twice by a mobile app on a bad connection.
     */
    @ExceptionHandler(MissingIdempotencyKeyException.class)
    public ProblemDetail handleMissingIdempotencyKey(MissingIdempotencyKeyException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/idempotency-key-required"));
        problem.setTitle("Idempotency key required");
        problem.setDetail("This request requires an Idempotency-Key header carrying a UUID.");
        problem.setProperty("code", "IDEMPOTENCY_KEY_REQUIRED");
        return problem;
    }

    /**
     * 400 for a key that is not a UUID.
     *
     * <p>Told apart from the one above because they are different mistakes with
     * different fixes: a header nobody added, against a header whose value came from
     * the wrong generator.
     */
    @ExceptionHandler(MalformedIdempotencyKeyException.class)
    public ProblemDetail handleMalformedIdempotencyKey(MalformedIdempotencyKeyException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/idempotency-key-invalid"));
        problem.setTitle("Invalid idempotency key");
        problem.setDetail("An Idempotency-Key is a UUID.");
        problem.setProperty("code", "IDEMPOTENCY_KEY_INVALID");
        return problem;
    }

    /**
     * 409 for one key carrying two different requests.
     *
     * <p>Neither answer would be safe: replaying the first would tell the client the
     * second request succeeded when nothing of the sort happened, and executing the
     * second would make the key mean nothing. What the first request <em>was</em> is
     * not reported — it may have been made from another device, and the response
     * recorded against it is somebody's pledge — beyond the operation it was spent
     * on, which is what a developer needs to find their bug.
     */
    @ExceptionHandler(IdempotencyKeyReusedException.class)
    public ProblemDetail handleReusedIdempotencyKey(IdempotencyKeyReusedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/idempotency-key-reused"));
        problem.setTitle("Idempotency key already used");
        problem.setDetail("This Idempotency-Key was already used for a different request.");
        problem.setProperty("code", "IDEMPOTENCY_KEY_REUSED");
        problem.setProperty("meta", Map.of("operation", exception.operation()));
        return problem;
    }

    /**
     * 409 for the loser of a race between two identical requests.
     *
     * <p>The client's work is being done, exactly once, by the request that got there
     * first — see {@code IdempotentRequestInProgressException} for why the loser is
     * told to retry rather than made to wait. {@code Retry-After} is set for
     * {@link #handleRateLimit}'s reason: a client that is told to wait can wait, and
     * one that is not retries immediately.
     */
    @ExceptionHandler(IdempotentRequestInProgressException.class)
    public ResponseEntity<ProblemDetail> handleRequestInProgress(IdempotentRequestInProgressException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/idempotent-request-in-progress"));
        problem.setTitle("Request already in progress");
        problem.setDetail("An earlier request with this Idempotency-Key has not finished. Try again in a moment.");
        problem.setProperty("code", "IDEMPOTENT_REQUEST_IN_PROGRESS");
        problem.setProperty("retryAfterSeconds", RETRY_IN_PROGRESS_SECONDS);

        return ResponseEntity.status(HttpStatus.CONFLICT)
                .header(HttpHeaders.RETRY_AFTER, Long.toString(RETRY_IN_PROGRESS_SECONDS))
                .body(problem);
    }

    /**
     * 400 for a {@code successUrl} or {@code errorUrl} that is not a page on the site — #139.
     *
     * <p>Here rather than with either endpoint for the idempotency refusals' reason: the hosted
     * payment page and the payout card registration raise it from two modules, and a client that
     * learned the body from one must get the same body from the other. {@code meta.field} says
     * which address; the address itself is not repeated, for the reason
     * {@link InvalidReturnUrlException} gives.
     */
    @ExceptionHandler(InvalidReturnUrlException.class)
    public ProblemDetail handleInvalidReturnUrl(InvalidReturnUrlException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-return-url"));
        problem.setTitle("Invalid return address");
        problem.setDetail("A return address must be an https page on this platform's site.");
        problem.setProperty("code", "INVALID_RETURN_URL");
        problem.setProperty("meta", Map.of("field", exception.field()));
        return problem;
    }

    /**
     * 429, with how long to wait.
     *
     * <p>The {@code X-RateLimit-*} and {@code RateLimit} fields are already on this
     * response — {@link az.ideanest.shared.ratelimit.RateLimits} writes them as the
     * decision is made, and this adds to the response rather than replacing it. They
     * are not written here because this handler sees only the refusal, and the
     * request that produced it may have spent more than one budget.
     */
    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<ProblemDetail> handleRateLimit(RateLimitExceededException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.TOO_MANY_REQUESTS);
        problem.setType(URI.create("https://ideanest.az/problems/rate-limited"));
        problem.setTitle("Too many requests");
        problem.setDetail("Too many attempts. Try again later.");

        // Rounded up, and never below a second: half a window rounded down to
        // zero is a client told to retry immediately into the same refusal, and
        // a wait shorter than the one RateLimit reports is a response that
        // contradicts itself.
        long seconds = Math.max(1, RateLimits.secondsRoundedUp(exception.getRetryAfter()));
        problem.setProperty("retryAfterSeconds", seconds);

        // A client that is told to wait can wait. Without the header it retries
        // immediately, and the limiter spends the rest of the window refusing.
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, Long.toString(seconds))
                .body(problem);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException exception,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-request"));
        problem.setTitle("Invalid request");
        problem.setDetail("One or more fields are invalid.");

        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError fieldError : exception.getBindingResult().getFieldErrors()) {
            // The default message, not the rejected value: the rejected value of
            // a password field is a password, and this response is logged by
            // whatever sits in front of us.
            errors.putIfAbsent(fieldError.getField(), fieldError.getDefaultMessage());
        }
        problem.setProperty("errors", errors);

        return ResponseEntity.badRequest().body(problem);
    }
}
