package az.ideanest.pledge.domain;

/**
 * Where one attempt to raise a paid pledge has got to — #171, V83.
 *
 * <p>Only {@link #PENDING} holds places, and only {@link #SUCCEEDED} changed the pledge. The rest say
 * why nothing did, and {@link #UNAPPLIED} is the one of them that owes money back.
 */
public enum PledgeRaiseState {

    /** The payment page was opened, and the places the new selection needs are held for it. */
    PENDING,

    /** Paid for and applied: the pledge now carries the new selection and total. */
    SUCCEEDED,

    /** The provider said the payment failed. Nothing was charged and the pledge is unchanged. */
    FAILED,

    /**
     * Nobody paid within the payment window, and the held places went back.
     *
     * <p>Not final. A payment that arrives afterwards is still applied if nothing about the pledge
     * has changed and the places can be taken again; otherwise it becomes {@link #UNAPPLIED}.
     */
    EXPIRED,

    /** The payment page could not be opened, so nothing could be charged. */
    ABANDONED,

    /**
     * The provider took the difference and the raise could no longer be applied.
     *
     * <p>The pledge is unchanged and the charge is owed back: the campaign-refunds job returns it
     * with {@code RAISE_NOT_APPLIED}.
     */
    UNAPPLIED
}
