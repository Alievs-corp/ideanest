package az.ideanest.payment.application;

import java.time.Instant;
import java.util.UUID;

/**
 * {@code refund.needs_bank_details} — issue #399: a refund owed to this backer can no longer go back
 * to their card, and support needs the bank account it goes to. Recorded once per pledge: the first
 * part of its refund that is routed to a bank transfer records it, and the others do not.
 */
public record RefundNeedsBankDetailsEvent(UUID refundId, UUID pledgeId, UUID projectId, UUID backerId, Instant routedAt) {

    public static final String AGGREGATE_TYPE = "pledge";
    public static final String EVENT_TYPE = "refund.needs_bank_details";
}
