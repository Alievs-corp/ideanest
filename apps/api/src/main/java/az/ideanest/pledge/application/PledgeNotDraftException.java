package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.PledgeState;
import java.util.UUID;

/**
 * Confirmation was asked of a pledge that is not a draft. §10.4's
 * {@code PLEDGE_NOT_DRAFT}.
 *
 * <p>§6.2 has exactly one edge out of {@code DRAFT} that a backer can take, and this
 * is every other state arriving at it: a pledge already confirmed, one whose
 * reservation was swept, one cancelled, one already collected.
 *
 * <p><strong>Not idempotency, and the difference matters.</strong> A retried
 * confirmation carrying the same {@code Idempotency-Key} never reaches here — it is
 * replayed with the original 200 by {@code shared.idempotency}, which is what §10.3
 * requires. Reaching this means a <em>different</em> request asked to confirm a
 * pledge that has moved on, and answering that with a success would tell a client
 * that a transition happened when it did not.
 *
 * <p>The state is carried because the client's next move depends on it: a
 * {@code COLLECTED} pledge is shown, an {@code EXPIRED} one is started again.
 */
public class PledgeNotDraftException extends RuntimeException {

    private final UUID pledgeId;
    private final PledgeState state;

    public PledgeNotDraftException(UUID pledgeId, PledgeState state) {
        super("Pledge " + pledgeId + " is " + state + " and cannot be confirmed");
        this.pledgeId = pledgeId;
        this.state = state;
    }

    public UUID pledgeId() {
        return pledgeId;
    }

    /** One of §6.2's twelve, so the client can say which sentence applies. */
    public PledgeState state() {
        return state;
    }
}
