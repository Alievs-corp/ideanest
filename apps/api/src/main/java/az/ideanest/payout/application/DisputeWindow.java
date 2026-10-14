package az.ideanest.payout.application;

import az.ideanest.payout.domain.BackerDispute;
import java.time.Instant;
import java.util.Optional;

/**
 * Whether the backer may dispute a pledge now — #480. The same rules {@link BackerDisputes#open} enforces,
 * asked before the backer writes a reason rather than after.
 *
 * @param until when the hold ends, for {@link Status#OPEN}; null otherwise
 * @param open the dispute already open on the pledge, if any
 */
public record DisputeWindow(Status status, Instant until, Optional<BackerDispute> open) {

    public enum Status {
        /** A payout is held and nothing of it may have left. */
        OPEN,
        /** No payout has been requested for the campaign yet. */
        NOT_YET,
        /** The payout has been paid, or its money may have left. */
        CLOSED,
        /** A payout is held, but nothing of this payment is left to refund. */
        NOTHING_LEFT
    }
}
