package az.ideanest.subscription.application;

/**
 * A page cursor this endpoint did not produce.
 *
 * <p>Refused rather than ignored, which is {@code AuditCursor}'s argument: quietly serving
 * the first page for a corrupt cursor makes a client that is paging wrongly look like one
 * that has reached the end. On a revenue list that means handing somebody the top of the
 * list again in place of the part they had not read, and a reconciliation that silently
 * counts one page twice.
 */
public class InvalidPaymentCursorException extends RuntimeException {

    public InvalidPaymentCursorException() {
        super("That page cursor is not one this endpoint issued");
    }
}
