package az.ideanest.pledge.api;

import az.ideanest.pledge.application.PledgeRaiseCheckout;
import az.ideanest.shared.money.Money;
import java.net.URI;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code POST /v1/pledges/{id}/raise}'s answer — #171.
 *
 * <p>{@link PaymentPageResponse} with the raise beside it: where to send the backer, and what they
 * are about to pay. Nothing has changed on the pledge yet; its own read reports the raise as
 * {@code PENDING} until the provider settles it.
 *
 * @param amount the difference the provider's page will charge
 * @param total what the pledge will come to once it is paid
 * @param holdExpiresAt until when the places the raise needs are held
 */
public record PledgeRaiseResponse(
        UUID pledgeId,
        UUID raiseId,
        Money amount,
        Money total,
        Instant holdExpiresAt,
        String providerTransactionId,
        URI redirectUrl) {

    static PledgeRaiseResponse of(PledgeRaiseCheckout.OpenedRaise opened) {
        return new PledgeRaiseResponse(
                opened.raise().payment().pledgeId(),
                opened.raise().raiseId(),
                opened.raise().payment().total(),
                opened.raise().newTotal(),
                opened.raise().payment().heldUntil(),
                opened.session().providerTransactionId(),
                opened.session().redirectUrl());
    }
}
