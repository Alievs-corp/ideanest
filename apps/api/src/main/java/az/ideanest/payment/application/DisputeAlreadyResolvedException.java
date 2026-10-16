package az.ideanest.payment.application;

import az.ideanest.payment.domain.DisputeState;
import java.util.UUID;

/**
 * A dispute already resolved was asked to be resolved again.
 *
 * <p>409. Resolving moves money: {@code LOST} and {@code CONCEDED} post the loss, write the
 * {@code CHARGEBACK} refund and may record a creator's debt and suspend them, and none of that is
 * undone by a later {@code WON}. So a second resolution is refused rather than recorded over the
 * first: a mistaken one is corrected by a person who can see what the first one did, not by a
 * button that would leave the books saying one thing and the case another. A case the provider
 * raises again is reopened by its webhook ({@code DisputeService#notified}) and can then be
 * resolved as any outcome.
 */
public class DisputeAlreadyResolvedException extends RuntimeException {

    private final transient DisputeState state;

    public DisputeAlreadyResolvedException(UUID disputeId, DisputeState state) {
        super("Dispute " + disputeId + " is already resolved as " + state);
        this.state = state;
    }

    /** How it was resolved, for the console's sentence. */
    public DisputeState state() {
        return state;
    }
}
