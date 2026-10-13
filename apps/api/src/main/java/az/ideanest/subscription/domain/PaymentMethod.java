package az.ideanest.subscription.domain;

/**
 * How a subscription payment reached the platform — V73's {@code method}.
 *
 * <p><strong>A closed set, unlike a plan code.</strong> V62 leaves plan codes as free text
 * with a shape constraint because an operator invents a plan from the console. Nobody
 * invents a way of being paid without the platform learning to reconcile it, so this is a
 * set that grows by a decision and a deployment rather than by a console form.
 *
 * <p><strong>{@link #CARD} is written by the provider's callback</strong> (#449), with no
 * member of staff on the row. {@link #BANK_TRANSFER} stays for a creator who pays by invoice,
 * recorded by a member of staff.
 */
public enum PaymentMethod {

    /** An invoice and a transfer, confirmed against a bank statement. */
    BANK_TRANSFER,

    /** A card payment on the provider's page, recorded by its callback (#449). */
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
