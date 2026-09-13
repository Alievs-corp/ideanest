package az.ideanest.payment.domain;

import java.net.URI;
import java.util.Objects;
import java.util.UUID;

/**
 * A creator registering the business card a payout goes to — IDN-EXT-01 (#38, #41).
 *
 * <p>Entered on the provider's page and never in an IdeaNest form. #41 owns the caller, and stores
 * the card identifier this returns as the payout destination.
 */
public record PayoutCardRequest(UUID creatorId, String description, String language, URI successUrl, URI errorUrl) {

    public PayoutCardRequest {
        Objects.requireNonNull(creatorId, "A payout card belongs to a creator");
    }
}
