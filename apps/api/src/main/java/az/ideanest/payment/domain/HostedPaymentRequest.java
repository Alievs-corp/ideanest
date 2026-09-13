package az.ideanest.payment.domain;

import az.ideanest.shared.money.Money;
import java.net.URI;
import java.util.Objects;
import java.util.UUID;

/**
 * A payment the backer makes on the provider's own page — IDN-EXT-01 (#38).
 *
 * <p>The charge-now model: the pledge is paid when it is confirmed, with the backer present,
 * and the card is entered on the provider's page and never in an IdeaNest form (§17.2's SAQ A).
 * #39 owns the caller.
 *
 * @param pledgeId the pledge being paid
 * @param amount what is charged, in the provider's currency
 * @param description shown on the provider's page; may be null
 * @param language the page's language, one of the provider's; null for the configured default
 * @param successUrl where the backer returns after paying; may be null
 * @param errorUrl where the backer returns after a failure; may be null
 * @param idempotencyKey §9.3's R-08, sent as the provider's order identifier
 */
public record HostedPaymentRequest(
        UUID pledgeId,
        Money amount,
        String description,
        String language,
        URI successUrl,
        URI errorUrl,
        String idempotencyKey) {

    public HostedPaymentRequest {
        Objects.requireNonNull(pledgeId, "A payment is a payment for a pledge");
        Objects.requireNonNull(amount, "A payment needs an amount");
        if (!amount.isPositive()) {
            throw new IllegalArgumentException("A payment charges a positive amount, and this one is " + amount);
        }
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("§9.3's R-08 requires an idempotency key on every payment mutation");
        }
    }
}
