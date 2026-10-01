package az.ideanest.payment.domain;

import java.net.URI;
import java.util.Objects;

/**
 * A payout card registration begun: the card's identifier, and where the creator enters it.
 *
 * <p>The identifier is known before the card is entered. It is a destination only once the
 * provider confirms the registration.
 *
 * <p>The page is reached over https. The one exception is a loopback host, for {@code ReturnUrls}'
 * reason — no third party can serve a page on somebody else's loopback — which is where #243's
 * local sandbox draws its page.
 */
public record PayoutCardSession(String cardId, URI redirectUrl) {

    public PayoutCardSession {
        if (cardId == null || cardId.isBlank()) {
            throw new IllegalArgumentException("A card registration names the card it registers");
        }
        Objects.requireNonNull(redirectUrl, "A card entry page is somewhere");
        if (!"https".equalsIgnoreCase(redirectUrl.getScheme()) && !isLoopbackHttp(redirectUrl)) {
            throw new IllegalArgumentException("A card entry page is reached over https, and this one is " + redirectUrl);
        }
    }

    private static boolean isLoopbackHttp(URI address) {
        String host = address.getHost();
        return "http".equalsIgnoreCase(address.getScheme())
                && host != null
                && (host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1") || host.equals("[::1]"));
    }
}
