package az.ideanest.admin.api;

import java.net.URI;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The ledger's one refusal of its own.
 *
 * <p>This handler lived in {@link ConsoleExceptionHandler}, which also covers the audit trail
 * and the payment log, so an {@link IllegalArgumentException} from either of those — a fault, not
 * anything the caller sent — was answered as "no such ledger account" with {@code meta.parameter}
 * naming an {@code account} parameter neither screen has. Scoped to the ledger, where the
 * exception is how its account parameter is parsed into a closed set, and anywhere else it stays
 * the 500 it is.
 *
 * <p>The staff refusals and the cursor refusal stay in {@link ConsoleExceptionHandler}; this
 * advice has no handler that one has, so the two never compete for an exception.
 */
@RestControllerAdvice(assignableTypes = LedgerController.class)
public class LedgerExceptionHandler {

    /**
     * 400 for a ledger account that is not one of §7.2's six.
     *
     * <p>A refusal rather than an empty page, and the distinction is the whole reason this
     * handler exists. {@code ?account=platform_fees} — the plural, which is the mistake
     * somebody actually makes — would otherwise return a page of nothing, and a page of
     * nothing on a ledger reads as "this account is empty" rather than "there is no such
     * account". One of those is a fact about the platform's money.
     *
     * <p>The message is {@link az.ideanest.ledger.application.LedgerAccount}'s own, which names
     * the value and points at the six. It quotes what the caller sent and nothing else, so there
     * is nothing here for a support ticket to leak.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleUnknownAccount(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/unknown-ledger-account"));
        problem.setTitle("No such ledger account");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "UNKNOWN_LEDGER_ACCOUNT");
        problem.setProperty("meta", Map.of("parameter", "account"));
        return problem;
    }
}
