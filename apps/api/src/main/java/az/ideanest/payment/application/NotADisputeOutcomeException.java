package az.ideanest.payment.application;

import az.ideanest.payment.domain.DisputeState;

/**
 * A dispute was asked to be resolved as a state that is not an outcome — {@code OPEN} or
 * {@code UNDER_REVIEW}.
 *
 * <p>Its own type rather than the {@link IllegalArgumentException} {@code Dispute.resolved} throws,
 * so the console's exception advice can answer this and nothing else with
 * {@code NOT_A_DISPUTE_OUTCOME}. The advice used to catch every {@code IllegalArgumentException}
 * under that code, and a refund sent in the wrong currency came back to the refund screen as
 * "not an outcome".
 */
public class NotADisputeOutcomeException extends IllegalArgumentException {

    public NotADisputeOutcomeException(DisputeState state) {
        super(state + " is not an outcome");
    }
}
