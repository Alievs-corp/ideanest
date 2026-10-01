package az.ideanest.payment.infrastructure;

import az.ideanest.payment.application.NoPayoutProviderException;
import az.ideanest.payment.domain.ChargeResult;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PayoutCard;
import az.ideanest.payment.domain.PayoutCardRequest;
import az.ideanest.payment.domain.PayoutCardSession;
import az.ideanest.payment.domain.PayoutRequest;
import az.ideanest.payment.domain.PayoutResult;
import az.ideanest.payment.domain.ProviderCapabilities;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.domain.StoredCardChargeRequest;
import az.ideanest.payment.domain.TokenizationRequest;
import az.ideanest.payment.domain.TokenizationResult;
import az.ideanest.payment.domain.TokenizationSession;
import az.ideanest.payment.domain.WebhookVerificationException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * A payout card registered on a developer's machine — issue #243. <strong>Temporary.</strong>
 *
 * <h2>Why it exists, given §9.2</h2>
 *
 * <p>§9.2 refuses a payment stub because one that approved would make a path look finished
 * when no card was ever seen. The owner accepted one exception until Epoint's keys are in place:
 * without any provider, "Register a business card" answers 503 locally, and nothing downstream
 * of a card — the payout destination, its standing, its verification in the console — can be
 * walked at all. This adapter does that one thing and is removed when Epoint is configured.
 *
 * <h2>What it does and does not do</h2>
 *
 * <p>{@link #beginPayoutCardRegistration} hands back a page the service draws itself
 * ({@code SandboxPayoutCardController}), on the same origin the creator came from. That page
 * delivers a real webhook through {@code ProviderWebhooks}, so the registration settles, the
 * event goes through the outbox and compliance files the destination exactly as it will for
 * Epoint. <strong>It moves no money.</strong> Charges, tokenisation and refunds refuse, a hosted
 * payment refuses through the interface's default, and a payout throws the same
 * {@link NoPayoutProviderException} an environment with no provider throws — so nothing that
 * would have been refused without a provider is accepted with this one.
 *
 * <h2>Why it cannot reach a deployment</h2>
 *
 * <p>Two locks. It exists only when {@code ideanest.payment.provider.primary} is
 * {@code SANDBOX}, which only {@code application-local.yml} defaults to; and its constructor
 * refuses to start unless the {@code local} or {@code test} profile is active, so a production
 * environment that named it by mistake fails at start-up rather than registering cards that
 * point at nothing.
 *
 * <h2>Who may deliver</h2>
 *
 * <p>The webhook endpoint is public, so a delivery must carry a secret drawn when this bean
 * starts and known only to the page's controller, and must name a card this instance began.
 * Anything else is a {@link WebhookVerificationException}, as a forged Epoint callback is.
 */
@Component
@ConditionalOnProperty(prefix = "ideanest.payment.provider", name = "primary", havingValue = "SANDBOX")
public class SandboxPaymentProvider implements PaymentProvider {

    private static final Logger log = LoggerFactory.getLogger(SandboxPaymentProvider.class);

    private static final ProviderName NAME = ProviderName.SANDBOX;

    /** The header a delivery carries its secret in. Lower case: the controller lower-cases headers. */
    static final String SECRET_HEADER = "x-sandbox-secret";

    /** The page a card is "entered" on, under the API's own path so the web proxy forwards it. */
    static final String PAGE_PATH = "/v1/sandbox/payout-cards/";

    private final ObjectMapper json;
    private final String secret;
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();

    public SandboxPaymentProvider(Environment environment, ObjectMapper json) {
        if (!environment.acceptsProfiles(Profiles.of("local", "test"))) {
            throw new IllegalStateException(
                    "The SANDBOX payment provider runs only under the local or test profile, and the active profiles are "
                            + Arrays.toString(environment.getActiveProfiles())
                            + ". Name a real provider in PAYMENT_PROVIDER, or none.");
        }
        this.json = json;
        byte[] drawn = new byte[32];
        new SecureRandom().nextBytes(drawn);
        this.secret = HexFormat.of().formatHex(drawn);
        log.warn("Payout cards register on the local SANDBOX page. No money moves through it (#243).");
    }

    /** What a card registration was begun with: whose it is, and where the page sends them back. */
    public record Pending(UUID creatorId, URI successUrl, URI errorUrl) {
    }

    @Override
    public ProviderName name() {
        return NAME;
    }

    @Override
    public ProviderCapabilities capabilities() {
        return new ProviderCapabilities(false, false, null, false, false, false, Set.of(), Set.of("AZN"));
    }

    /**
     * Opens the sandbox's card page on the creator's own origin.
     *
     * <p>The origin is the success address's, which {@code ReturnUrls} has already checked is a
     * page on the site; the return addresses are kept here rather than put in the page's address,
     * so the page cannot be pointed somewhere else by editing it.
     */
    @Override
    public PayoutCardSession beginPayoutCardRegistration(PayoutCardRequest request) {
        String cardId = "sandbox-" + UUID.randomUUID();
        pending.put(cardId, new Pending(request.creatorId(), request.successUrl(), request.errorUrl()));
        URI origin = request.successUrl().resolve("/");
        return new PayoutCardSession(cardId, origin.resolve(PAGE_PATH + cardId));
    }

    /** The registration a card identifier names, if this instance began it and it is still open. */
    public Optional<Pending> pendingFor(String cardId) {
        return Optional.ofNullable(cardId).map(pending::get);
    }

    /**
     * The body and headers of a delivery saying how the card page ended.
     *
     * <p>Built here rather than by the controller so the format the parser reads has one author.
     */
    public Delivery deliveryFor(String cardId, boolean registered, String holderName) {
        ObjectNode body = json.createObjectNode();
        body.put("card_id", cardId);
        body.put("status", registered ? "success" : "failed");
        if (registered) {
            body.put("card_mask", "400000******" + String.format("%04d", Math.floorMod(cardId.hashCode(), 10_000)));
            if (holderName != null && !holderName.isBlank()) {
                body.put("cardholder_name", holderName.trim());
            }
        }
        return new Delivery(body.toString().getBytes(StandardCharsets.UTF_8), Map.of(SECRET_HEADER, secret));
    }

    /** A webhook as the controller will hand it to {@code ProviderWebhooks}. */
    public record Delivery(byte[] body, Map<String, String> headers) {
    }

    @Override
    public PaymentEvent parseWebhook(byte[] rawBody, Map<String, String> headers) {
        String offered = headers == null ? null : headers.get(SECRET_HEADER);
        if (offered == null
                || !MessageDigest.isEqual(
                        offered.getBytes(StandardCharsets.US_ASCII), secret.getBytes(StandardCharsets.US_ASCII))) {
            throw new WebhookVerificationException(NAME, "A sandbox delivery did not carry this instance's secret.");
        }

        JsonNode decoded;
        try {
            decoded = json.readTree(rawBody);
        } catch (JacksonException e) {
            throw new WebhookVerificationException(NAME, "A sandbox delivery cannot be read.", e);
        }
        if (decoded == null || !decoded.isObject()) {
            throw new WebhookVerificationException(NAME, "A sandbox delivery is not a JSON object.");
        }

        String cardId = text(decoded, "card_id");
        if (cardId == null || pending.remove(cardId) == null) {
            throw new WebhookVerificationException(NAME, "A sandbox delivery names a card this instance did not begin.");
        }
        String status = text(decoded, "status");
        PaymentEventType type = "success".equals(status)
                ? PaymentEventType.PAYOUT_CARD_REGISTERED
                : PaymentEventType.PAYOUT_CARD_FAILED;
        PayoutCard card = new PayoutCard(cardId, text(decoded, "card_mask"), text(decoded, "cardholder_name"));

        ObjectNode stored = ((ObjectNode) decoded).deepCopy();
        stored.remove("cardholder_name");
        return new PaymentEvent(NAME, cardId + ":" + status, type, null, null, null, stored.toString(), card);
    }

    @Override
    public TokenizationSession beginTokenization(TokenizationRequest request) {
        throw new UnsupportedOperationException(NAME + " moves no money and stores no cards");
    }

    @Override
    public TokenizationResult resolveTokenization(String sessionId) {
        throw new UnsupportedOperationException(NAME + " moves no money and stores no cards");
    }

    @Override
    public ChargeResult chargeStoredCard(StoredCardChargeRequest request) {
        throw new UnsupportedOperationException(NAME + " moves no money");
    }

    @Override
    public RefundResult refund(RefundRequest request) {
        throw new UnsupportedOperationException(NAME + " moves no money");
    }

    /** The refusal an environment with no provider gives, so the sandbox sends nothing it would not. */
    @Override
    public PayoutResult payout(PayoutRequest request) {
        throw new NoPayoutProviderException();
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asString();
    }
}
