package az.ideanest.verification.domain;

/**
 * Where a student verification stands — #655.
 *
 * <p>The four stored states, and {@link #NONE} for an account that has never submitted, which
 * is a state on the wire and never a row.
 *
 * <p><strong>{@link #EXPIRED} is both stored and computed.</strong> An approval stops counting
 * at its {@code valid_until} whatever the row says, so every reader asks
 * {@link StudentVerification#stateAt}; the row itself is moved to {@code EXPIRED} only when it
 * stands in the way of a new submission, or by the daily sweep. V127 says why the move exists.
 */
public enum StudentVerificationState {

    /** Never submitted. Not stored. */
    NONE,

    /** Waiting for a member of staff. */
    PENDING,

    /** A member of staff approved it, and it counts until {@code valid_until}. */
    APPROVED,

    /** Refused, or approved and later revoked. The creator may submit again. */
    REJECTED,

    /** Was approved, and its year has run out. The creator may submit again. */
    EXPIRED;

    /** Whether a new submission from the same account is refused while this is its newest row. */
    public boolean blocksResubmission() {
        return this == PENDING || this == APPROVED;
    }
}
