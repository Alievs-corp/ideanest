package az.ideanest.signature.domain;

import java.time.Instant;
import java.util.Objects;

/**
 * A signing session, begun — issue #428.
 *
 * <p><strong>A session and not a signature, because the answer is not knowable
 * synchronously.</strong> There is a person and a phone in the middle: the prompt appears in
 * their SİMA application, and they sign it, decline it, or put the phone down. That is the
 * same shape {@code HostedPaymentSession} has and for the same reason — an interface that
 * pretended to return an answer here would be an interface that blocks a request thread on a
 * human being.
 *
 * @param sessionId the provider's identifier, which {@code SignatureProvider.resolve} is asked
 *     with and which V67 stores. Unique per provider, so that a resolve can be repeated
 * @param verificationCode the four digits shown to the citizen on the platform's screen and
 *     again in their SİMA application, so they can tell this prompt from one somebody else
 *     started. Displayed, never stored: it is a correlation aid for a person, and a column of
 *     them would be a column nothing reads
 * @param expiresAt when the provider will close the session unanswered. Carried so the screen
 *     can count down honestly rather than spinning until a poll happens to notice
 */
public record SignatureSession(String sessionId, String verificationCode, Instant expiresAt) {

    public SignatureSession {
        Objects.requireNonNull(sessionId, "sessionId");
        Objects.requireNonNull(expiresAt, "expiresAt");
        if (sessionId.isBlank()) {
            throw new IllegalArgumentException("A session without an identifier cannot be resolved");
        }
    }
}
