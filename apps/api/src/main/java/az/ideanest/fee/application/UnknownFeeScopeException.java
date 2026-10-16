package az.ideanest.fee.application;

import az.ideanest.fee.domain.FeeScope;
import java.util.UUID;

/**
 * An exception to the platform's terms names a category or a campaign that does not exist.
 *
 * <p>The reference is typed by hand, and a mistyped identifier used to be accepted: it opened a
 * schedule that applies to nothing, which reads as a negotiated rate on the console and changes no
 * payout anybody will ever see. Refused instead, with the scope, so the console can say which field
 * named nothing.
 */
public class UnknownFeeScopeException extends RuntimeException {

    private final FeeScope scope;

    public UnknownFeeScopeException(FeeScope scope, UUID scopeRef) {
        super("No " + scope + " " + scopeRef + " exists to price an exception for");
        this.scope = scope;
    }

    public FeeScope scope() {
        return scope;
    }
}
