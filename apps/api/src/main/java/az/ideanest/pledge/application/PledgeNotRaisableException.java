package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.PledgeState;
import java.util.UUID;

/**
 * #171: only a paid pledge is raised by paying the difference.
 *
 * <p>A {@code DRAFT} is still a checkout and is changed with PL-09's edit and paid for once; a legacy
 * {@code CONFIRMED} pledge was never charged and is changed with the edit too; and anything else has
 * ended or is past the point where a backer changes it. The state is carried so the refusal can name
 * the way that does apply.
 *
 * <p>A paid pledge some of whose money is being or has been refunded is not raised either
 * ({@link #refunded}): the raise would be paid for and then refunded rather than applied, because a
 * refund was measured against the pledge as it was.
 */
public class PledgeNotRaisableException extends RuntimeException {

    private final PledgeState state;
    private final boolean refunded;

    public PledgeNotRaisableException(UUID pledgeId, PledgeState state) {
        this(pledgeId, state, false);
    }

    private PledgeNotRaisableException(UUID pledgeId, PledgeState state, boolean refunded) {
        super(refunded
                ? "Pledge " + pledgeId + " has money being or already refunded and is not raised"
                : "Pledge " + pledgeId + " is in " + state + " and is not raised by paying the difference");
        this.state = state;
        this.refunded = refunded;
    }

    /** A paid pledge that has a refund in flight or settled against it. */
    public static PledgeNotRaisableException refunded(UUID pledgeId) {
        return new PledgeNotRaisableException(pledgeId, PledgeState.COLLECTED, true);
    }

    public PledgeState state() {
        return state;
    }

    /** Whether it is refused because of a refund rather than because of its state. */
    public boolean refunded() {
        return refunded;
    }
}
