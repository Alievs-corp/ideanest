package az.ideanest.pledge.application;

import java.util.UUID;

/**
 * #171: what a settled payment did to the raise it paid for.
 *
 * @param backerId the pledge's backer, for the payment module's own event; null when there is no raise
 */
public record RaiseSettlement(Outcome outcome, UUID raiseId, UUID pledgeId, UUID backerId) {

    public enum Outcome {
        /** The pledge now carries the raise. */
        APPLIED,
        /** The money is in and the raise could not be applied; the charge is owed back. */
        UNAPPLIED,
        /** A second delivery about a payment already settled. Nothing moved. */
        ALREADY_SETTLED,
        /** No raise is paid for by this charge. */
        UNKNOWN
    }

    static RaiseSettlement unknown() {
        return new RaiseSettlement(Outcome.UNKNOWN, null, null, null);
    }
}
