package az.ideanest.payout.domain;

/**
 * Where a payout has got to — V55, issues #69 and #306.
 *
 * <p><strong>Six states, and the first two are not the same.</strong> A payout is
 * calculated as soon as a campaign closes, so that the screen can show what is owed and
 * when it becomes payable; it becomes {@link #PENDING_APPROVAL} when the hold expires.
 * Collapsing them would mean either calculating nothing until the hold ran out — so a
 * creator asking "what will I be paid" gets no answer for two weeks — or showing every
 * payout as awaiting a signature it cannot yet have.
 */
public enum PayoutState {

    /** The figure exists. The hold may still be running. */
    CALCULATED,

    /** Payable, waiting on signatures. */
    PENDING_APPROVAL,

    /** Signed off, waiting for the sender. */
    APPROVED,

    /**
     * The provider took the instruction — or, with a net of zero and no transaction, everything it
     * would have paid went towards the creator's debts (V86). Either way the campaign is paid out.
     */
    PAID,

    /**
     * The provider refused, or could not be reached.
     *
     * <p>Terminal for this row, like a failed refund. A retry is a fresh calculation,
     * because the figures may have moved — a refund issued in the meantime changes what is
     * owed, and re-sending the old number would pay out money that has already gone back.
     */
    FAILED,

    /** Staff withdrew it before it was sent. */
    CANCELLED;

    /** Whether this payout is still on its way somewhere. V55's partial unique index. */
    public boolean isInFlight() {
        return this == CALCULATED || this == PENDING_APPROVAL || this == APPROVED;
    }
}
