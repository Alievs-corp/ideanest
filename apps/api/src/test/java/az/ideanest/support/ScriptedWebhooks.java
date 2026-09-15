package az.ideanest.support;

import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PayoutCard;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.WebhookVerificationException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The scripted provider's webhook format, and the shared secret behind it.
 *
 * <p>Separate from {@link ScriptedPaymentProvider} so that a test can <em>build</em> a
 * delivery with {@link #body} and {@link #headers} without holding the provider bean,
 * which is what an end-to-end test posting to {@code /v1/webhooks/psp/payriff} needs.
 *
 * <h2>The format, and why it is this simple</h2>
 *
 * <p>A JSON object with {@code id}, {@code type} and an optional {@code signedAt}, and
 * one header carrying the secret verbatim. A real adapter computes an HMAC over the
 * bytes; this does not, and the difference does not matter for what the suite is
 * testing. #66 is about {@code ProviderWebhooks} — that a body which does not verify
 * never becomes an event, that a stale timestamp is refused, that a redelivery does
 * nothing twice — and none of those depend on which MAC a provider chose. What they do
 * depend on is that verification and parsing are one call, which this honours by
 * refusing before it reads anything.
 *
 * <p>The parsing is a regular expression rather than Jackson, deliberately: the point is
 * that the adapter owns the format, and using the application's {@code ObjectMapper}
 * here would quietly make the test depend on the platform's JSON configuration.
 */
public final class ScriptedWebhooks {

    /** The header a scripted delivery carries its signature in. */
    public static final String SIGNATURE_HEADER = "x-scripted-signature";

    /**
     * The shared secret, in the clear, because it protects nothing.
     *
     * <p>A real one is a deployment's and lives wherever §17.1 keeps secrets. This is a
     * constant in a test source file and is the correct place for it: the suite has to be
     * able to produce a valid signature and an invalid one on demand.
     */
    public static final String SECRET = "scripted-secret";

    private static final Pattern ID = Pattern.compile("\"id\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern TYPE = Pattern.compile("\"type\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern SIGNED_AT = Pattern.compile("\"signedAt\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern TRANSACTION = Pattern.compile("\"providerTransactionId\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern CARD_ID = Pattern.compile("\"cardId\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern CARD_MASK = Pattern.compile("\"cardMask\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern HOLDER_NAME = Pattern.compile("\"holderName\"\\s*:\\s*\"([^\"]+)\"");

    private ScriptedWebhooks() {}

    /** A delivery body: an identifier, a type, and the instant it claims to have been signed. */
    public static String body(String eventId, PaymentEventType type, Instant signedAt) {
        return """
               {"id":"%s","type":"%s","signedAt":"%s"}"""
                .formatted(eventId, type.name().toLowerCase(Locale.ROOT), signedAt);
    }

    /** The headers a valid delivery carries. */
    public static Map<String, String> headers() {
        return Map.of(SIGNATURE_HEADER, SECRET);
    }

    /** The headers a forged delivery carries. */
    public static Map<String, String> forgedHeaders() {
        return Map.of(SIGNATURE_HEADER, "not-the-secret");
    }

    /**
     * Verifies and parses in one call, which is {@code PaymentProvider#parseWebhook}'s
     * whole contract: there is no way to obtain a {@link PaymentEvent} without having
     * gone through the check.
     */
    static PaymentEvent parse(ProviderName provider, byte[] rawBody, Map<String, String> headers) {
        String signature = headers.get(SIGNATURE_HEADER);
        if (!SECRET.equals(signature)) {
            throw new WebhookVerificationException(provider, "The signature header is absent or wrong");
        }

        String body = new String(rawBody, StandardCharsets.UTF_8);
        String id = group(ID, body);
        if (id == null) {
            throw new WebhookVerificationException(provider, "The body carries no event identifier");
        }

        String rawType = group(TYPE, body);
        // IDN-EXT-01 (#44): a delivery naming a card is about a payout card registration.
        String cardId = group(CARD_ID, body);
        PayoutCard card = cardId == null ? null : new PayoutCard(cardId, group(CARD_MASK, body), group(HOLDER_NAME, body));
        return new PaymentEvent(
                provider,
                id,
                typeOf(rawType),
                group(TRANSACTION, body),
                null,
                instantOrNull(group(SIGNED_AT, body)),
                body,
                card);
    }

    /**
     * The provider's word for what happened, in the platform's vocabulary.
     *
     * <p>Anything unrecognised is {@link PaymentEventType#UNRECOGNISED} rather than a
     * refusal, which is the behaviour every real adapter must have: a provider sends
     * every event type it has, and throwing on one would turn its product announcement
     * into a 500 and a retry storm.
     */
    private static PaymentEventType typeOf(String rawType) {
        if (rawType == null) {
            return PaymentEventType.UNRECOGNISED;
        }
        for (PaymentEventType candidate : PaymentEventType.values()) {
            if (candidate.name().equalsIgnoreCase(rawType)) {
                return candidate;
            }
        }
        return PaymentEventType.UNRECOGNISED;
    }

    private static Instant instantOrNull(String value) {
        return value == null ? null : Instant.parse(value);
    }

    private static String group(Pattern pattern, String body) {
        Matcher matcher = pattern.matcher(body);
        return matcher.find() ? matcher.group(1) : null;
    }
}
