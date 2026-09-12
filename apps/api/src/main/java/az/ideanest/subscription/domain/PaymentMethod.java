package az.ideanest.subscription.domain;

/**
 * How a subscription payment reached the platform — V73's {@code method}.
 *
 * <p><strong>A closed set, unlike a plan code.</strong> V62 leaves plan codes as free text
 * with a shape constraint because an operator invents a plan from the console. Nobody
 * invents a way of being paid without the platform learning to reconcile it, so this is a
 * set that grows by a decision and a deployment rather than by a console form.
 *
 * <p><strong>{@link #BANK_TRANSFER} is the one that happens today.</strong> §9.2 ships no
 * payment provider adapter while #60 is unanswered, so the platform sells the way a
 * platform without a processor sells: an invoice, a transfer, and a member of staff who
 * records that it arrived. {@link #CARD} exists so the row a provider's callback will write
 * needs no migration to exist — not because anything can charge one yet.
 */
public enum PaymentMethod {

    /** An invoice and a transfer, confirmed against a bank statement. */
    BANK_TRANSFER,

    /** A provider-collected card payment. Nothing writes this until #60 lands. */
    CARD,

    /** Handed over in person, in an office, against a receipt. */
    CASH,

    /**
     * Anything else, with the detail in {@code reference} or {@code note}.
     *
     * <p>Here so that an unusual arrangement is recorded rather than recorded wrongly as
     * one of the others. A journal that refused the payment it actually received would be
     * a journal somebody keeps a spreadsheet beside.
     */
    OTHER
}
