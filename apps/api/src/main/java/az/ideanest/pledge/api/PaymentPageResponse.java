package az.ideanest.pledge.api;

import az.ideanest.pledge.application.PaymentPageSession;
import java.net.URI;
import java.util.UUID;

/**
 * Where to send the backer to pay — IDN-EXT-01 (#39).
 *
 * <p>The pledge is still a {@code DRAFT} when this is answered. It becomes {@code COLLECTED} when
 * the provider tells the platform the payment went through, which is asynchronous; a client reads
 * the pledge again after the backer returns.
 */
public record PaymentPageResponse(UUID pledgeId, String providerTransactionId, URI redirectUrl) {

    static PaymentPageResponse of(UUID pledgeId, PaymentPageSession session) {
        return new PaymentPageResponse(pledgeId, session.providerTransactionId(), session.redirectUrl());
    }
}
