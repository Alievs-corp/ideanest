package az.ideanest.payment.domain;

import java.net.URI;
import java.util.Objects;

/**
 * A payout card registration begun: the card's identifier, and where the creator enters it.
 *
 * <p>The identifier is known before the card is entered. It is a destination only once the
 * provider confirms the registration.
 */
public record PayoutCardSession(String cardId, URI redirectUrl) {

    public PayoutCardSession {
        if (cardId == null || cardId.isBlank()) {
            throw new IllegalArgumentException("A card registration names the card it registers");
        }
        Objects.requireNonNull(redirectUrl, "A card entry page is somewhere");
        if (!"https".equalsIgnoreCase(redirectUrl.getScheme())) {
            throw new IllegalArgumentException("A card entry page is reached over https, and this one is " + redirectUrl);
        }
    }
}
