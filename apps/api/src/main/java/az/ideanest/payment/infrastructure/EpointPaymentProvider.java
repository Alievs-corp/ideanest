package az.ideanest.payment.infrastructure;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.ChargeResult;
import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.HostedPaymentSession;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PayoutCardRequest;
import az.ideanest.payment.domain.PayoutCard;
import az.ideanest.payment.domain.PayoutCardSession;
import az.ideanest.payment.domain.PayoutRequest;
import az.ideanest.payment.domain.PayoutResult;
import az.ideanest.payment.domain.ProviderCapabilities;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.domain.StoredCardChargeRequest;
import az.ideanest.payment.domain.TokenizationRequest;
import az.ideanest.payment.domain.TokenizationResult;
import az.ideanest.payment.domain.TokenizationSession;
import az.ideanest.payment.domain.WebhookVerificationException;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * §9.4's adapter for Epoint.az, API v1.0.3 — IDN-EXT-01 (#38).
 *
 * <h2>The wire format</h2>
 *
 * <p>Every call is a form POST of two fields: {@code data}, the parameters as a JSON document
 * encoded in base64, and {@code signature}, {@code base64(sha1(private_key + data + private_key))}
 * over the <em>raw</em> twenty-byte digest rather than its hex. Epoint's callbacks arrive the same
 * way and are verified by computing the same signature over the {@code data} they carry.
 *
 * <h2>What it maps, and to what</h2>
 *
 * <ul>
 *   <li>{@link #beginHostedPayment} is {@code /request}: the backer pays on Epoint's page, and the
 *       answer is the transaction and where to send them.
 *   <li>{@link #lookUpPayment} is {@code /get-status}: {@code new}, {@code success},
 *       {@code returned} and {@code error}; {@code server_error} is Epoint failing to look, and is
 *       a provider that could not answer rather than a payment that failed.
 *   <li>{@link #refund} is {@code /reverse}, in full or in part. <strong>It has no duplicate
 *       protection of its own</strong>, so an adapter retry would be a second refund; the
 *       platform's own protection is #40's, and this translates one call into one request.
 *   <li>{@link #payout} is {@code /refund-request} against a {@code card_id} — a payout, despite
 *       the name — to a business card {@link #beginPayoutCardRegistration} registered through
 *       {@code /card-registration} with {@code refund=1}.
 *   <li>{@link #parseWebhook} is the {@code result_url} callback.
 * </ul>
 *
 * <p><strong>Not the stored-card model.</strong> Tokenisation and the merchant-initiated charge
 * at close are retired by IDN-EXT-01 (#39), and Epoint has not confirmed §9.3's R-02 and R-03, so
 * {@link #capabilities()} does not claim them and {@code PaymentProviders} never hands this
 * adapter to {@code CollectionRun}. The three calls refuse rather than pretend.
 *
 * <h2>Money</h2>
 *
 * <p>An amount goes onto the wire as the {@link BigDecimal} it is — written by the JSON writer
 * from the decimal, never through a {@code double} — and Epoint takes AZN and nothing else, so
 * any other currency is refused before a request is made.
 *
 * <h2>Card data</h2>
 *
 * <p>Epoint returns a masked card number and the cardholder's name. The mask is already masked;
 * the name is removed from every {@code rawResponse} and event body before it leaves this class,
 * because those strings are stored and logged (§17.2).
 */
@Component
@ConditionalOnProperty(prefix = "ideanest.payment.provider", name = "primary", havingValue = "EPOINT")
public class EpointPaymentProvider implements PaymentProvider {

    private static final Logger log = LoggerFactory.getLogger(EpointPaymentProvider.class);

    private static final ProviderName NAME = ProviderName.EPOINT;

    /** API v1.0.3: split, pre-auth, refund, reverse and payout are AZN only. */
    private static final String CURRENCY = "AZN";

    private static final Set<String> LANGUAGES = Set.of("az", "en", "ru");

    /** The one field of a card Epoint returns in the clear. */
    private static final String CARDHOLDER_NAME = "card_name";

    /** {@code operation_code} on a callback: 001 is a card registration, 100 a payment. */
    private static final String CARD_REGISTRATION = "001";

    private final RestClient http;
    private final PaymentProperties.Epoint settings;
    private final ObjectMapper json;

    public EpointPaymentProvider(RestClient.Builder builder, PaymentProperties properties, ObjectMapper json) {
        this.settings = properties.epoint();
        if (!settings.isComplete()) {
            throw new IllegalStateException(
                    "ideanest.payment.provider.primary is EPOINT and ideanest.payment.epoint is missing its"
                            + " base URL, public key or private key.");
        }
        this.json = json;
        this.http = builder.baseUrl(settings.baseUrl()).build();
    }

    @Override
    public ProviderName name() {
        return NAME;
    }

    @Override
    public HostedPaymentSession beginHostedPayment(HostedPaymentRequest request) {
        requireAzn(request.amount());
        Map<String, Object> parameters = parameters(request.language());
        parameters.put("amount", request.amount().amount());
        parameters.put("currency", CURRENCY);
        // The idempotency key, and not the pledge: a pledge paid again after a failed attempt is a
        // second order, and Epoint requires the order identifier to be unique per transaction.
        parameters.put("order_id", request.idempotencyKey());
        putIfPresent(parameters, "description", request.description());
        putIfPresent(parameters, "success_redirect_url", request.successUrl());
        putIfPresent(parameters, "error_redirect_url", request.errorUrl());

        JsonNode answer = call("/request", parameters, "begin a payment");
        requireSuccess(answer, "begin a payment");
        String transaction = text(answer, "transaction");
        String redirect = text(answer, "redirect_url");
        if (isBlank(transaction) || isBlank(redirect)) {
            throw unavailable("Epoint began a payment and did not say which, or where to send the backer.");
        }
        return new HostedPaymentSession(transaction, URI.create(redirect));
    }

    @Override
    public PaymentLookup lookUpPayment(String providerTransactionId) {
        Map<String, Object> parameters = parameters(null);
        parameters.put("transaction", providerTransactionId);

        JsonNode answer = call("/get-status", parameters, "look up a payment");
        String status = lower(text(answer, "status"));
        PaymentLookup.State state = switch (status) {
            case "new" -> PaymentLookup.State.PENDING;
            case "success" -> PaymentLookup.State.SUCCEEDED;
            case "returned" -> PaymentLookup.State.RETURNED;
            case "error", "failed" -> PaymentLookup.State.FAILED;
            // server_error is Epoint failing to look, not the payment failing: reporting it as
            // FAILED would tell #40 to refund nothing and #39 to call a paid pledge unpaid.
            default -> throw unavailable("Epoint answered a lookup of %s with status '%s'."
                    .formatted(providerTransactionId, status));
        };
        String transaction = text(answer, "transaction");
        return new PaymentLookup(
                state,
                isBlank(transaction) ? providerTransactionId : transaction,
                text(answer, "code"),
                text(answer, "message"),
                redacted(answer));
    }

    @Override
    public PayoutCardSession beginPayoutCardRegistration(PayoutCardRequest request) {
        Map<String, Object> parameters = parameters(request.language());
        // 1 is a payout card; 0 would register a card to be charged.
        parameters.put("refund", 1);
        putIfPresent(parameters, "description", request.description());
        putIfPresent(parameters, "success_redirect_url", request.successUrl());
        putIfPresent(parameters, "error_redirect_url", request.errorUrl());

        JsonNode answer = call("/card-registration", parameters, "register a payout card");
        requireSuccess(answer, "register a payout card");
        String cardId = text(answer, "card_id");
        String redirect = text(answer, "redirect_url");
        if (isBlank(cardId) || isBlank(redirect)) {
            throw unavailable("Epoint began a card registration and did not name the card or the page.");
        }
        return new PayoutCardSession(cardId, URI.create(redirect));
    }

    @Override
    public RefundResult refund(RefundRequest request) {
        requireAzn(request.amount());
        Map<String, Object> parameters = parameters(null);
        parameters.put("transaction", request.providerTransactionId());
        parameters.put("amount", request.amount().amount());
        parameters.put("currency", CURRENCY);

        JsonNode answer = call("/reverse", parameters, "reverse a payment");
        String status = lower(text(answer, "status"));
        return switch (status) {
            // /reverse answers no transaction of its own, so the result carries none (#40).
            case "success" -> new RefundResult(ProviderOutcome.APPROVED, null, null, null, redacted(answer));
            case "error", "failed" ->
                new RefundResult(
                        ProviderOutcome.DECLINED,
                        null,
                        codeOr(answer, "reverse_refused"),
                        text(answer, "message"),
                        redacted(answer));
            default -> throw unavailable("Epoint answered a reversal with status '%s'.".formatted(status));
        };
    }

    @Override
    public PayoutResult payout(PayoutRequest request) {
        requireAzn(request.amount());
        Map<String, Object> parameters = parameters(null);
        parameters.put("card_id", request.destinationReference());
        parameters.put("order_id", request.idempotencyKey());
        parameters.put("amount", request.amount().amount());
        parameters.put("currency", CURRENCY);
        parameters.put("description", "IdeaNest payout " + request.payoutId());

        JsonNode answer = call("/refund-request", parameters, "send a payout");
        String status = lower(text(answer, "status"));
        String transaction = text(answer, "transaction");
        return switch (status) {
            case "success" -> new PayoutResult(ProviderOutcome.APPROVED, transaction, null, null, redacted(answer));
            case "new" -> new PayoutResult(ProviderOutcome.PENDING, transaction, null, null, redacted(answer));
            case "error", "failed" ->
                new PayoutResult(
                        ProviderOutcome.DECLINED,
                        transaction,
                        codeOr(answer, "payout_refused"),
                        text(answer, "message"),
                        redacted(answer));
            default -> throw unavailable("Epoint answered a payout with status '%s'.".formatted(status));
        };
    }

    @Override
    public PaymentEvent parseWebhook(byte[] rawBody, Map<String, String> headers) {
        Map<String, String> form = formOf(rawBody);
        String data = form.get("data");
        String signature = form.get("signature");
        if (isBlank(data) || isBlank(signature)) {
            throw new WebhookVerificationException(NAME, "An Epoint callback carries data and a signature, and this one did not.");
        }
        byte[] expected = sign(data).getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(expected, signature.getBytes(StandardCharsets.US_ASCII))) {
            throw new WebhookVerificationException(NAME, "An Epoint callback's signature does not verify.");
        }

        JsonNode decoded;
        try {
            decoded = json.readTree(Base64.getDecoder().decode(data));
        } catch (IllegalArgumentException | JacksonException e) {
            throw new WebhookVerificationException(NAME, "An Epoint callback's data cannot be read.", e);
        }
        if (decoded == null || !decoded.isObject()) {
            throw new WebhookVerificationException(NAME, "An Epoint callback's data is not a JSON object.");
        }

        String transaction = text(decoded, "transaction");
        String status = lower(text(decoded, "status"));
        String operation = text(decoded, "operation_code");
        String subject = firstPresent(transaction, text(decoded, "card_id"), text(decoded, "order_id"));
        if (isBlank(subject)) {
            throw new WebhookVerificationException(NAME, "An Epoint callback names no transaction, card or order.");
        }

        boolean card = CARD_REGISTRATION.equals(operation);
        PaymentEventType type = card
                // A payout card being registered is not a charge: it settles a registration (#44).
                ? switch (status) {
                    case "success" -> PaymentEventType.PAYOUT_CARD_REGISTERED;
                    case "error", "failed" -> PaymentEventType.PAYOUT_CARD_FAILED;
                    default -> PaymentEventType.UNRECOGNISED;
                }
                : switch (status) {
                    case "success" -> PaymentEventType.CHARGE_SUCCEEDED;
                    case "error", "failed" -> PaymentEventType.CHARGE_FAILED;
                    case "returned" -> PaymentEventType.REFUND_SUCCEEDED;
                    default -> PaymentEventType.UNRECOGNISED;
                };

        // Epoint's callback has no event identifier and no timestamp. The transaction, its status
        // and the operation together identify a delivery, so a redelivery of the same news is a
        // duplicate and a transaction's later "returned" is not; with no signing time there is no
        // replay window to check, and deduplication is what refuses a replay.
        String eventId = subject + ":" + (status.isEmpty() ? "unknown" : status) + ":" + (operation == null ? "" : operation);
        // The holder's name travels on the event and never in the stored body, which is redacted.
        PayoutCard payoutCard = card && !isBlank(text(decoded, "card_id"))
                ? new PayoutCard(text(decoded, "card_id"), text(decoded, "card_mask"), text(decoded, CARDHOLDER_NAME))
                : null;
        return new PaymentEvent(NAME, eventId, type, transaction, amountOf(decoded), null, redacted(decoded), payoutCard);
    }

    @Override
    public TokenizationSession beginTokenization(TokenizationRequest request) {
        throw storedCardsRetired();
    }

    @Override
    public TokenizationResult resolveTokenization(String sessionId) {
        throw storedCardsRetired();
    }

    @Override
    public ChargeResult chargeStoredCard(StoredCardChargeRequest request) {
        throw storedCardsRetired();
    }

    /**
     * Payments on its page, refunds in part, split payments; AZN only. Card-on-file exists at
     * Epoint, but merchant-initiated charges and scheme chaining are unconfirmed — and unused under
     * IDN-EXT-01 — so the stored-card collection this platform no longer does is not claimed.
     */
    @Override
    public ProviderCapabilities capabilities() {
        return new ProviderCapabilities(true, false, null, false, true, true, Set.of(), Set.of(CURRENCY));
    }

    // ------------------------------------------------------------------
    // The wire
    // ------------------------------------------------------------------

    private JsonNode call(String path, Map<String, Object> parameters, String what) {
        String data;
        try {
            data = Base64.getEncoder().encodeToString(json.writeValueAsBytes(parameters));
        } catch (JacksonException e) {
            throw new IllegalStateException("Could not write Epoint parameters to " + what, e);
        }
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("data", data);
        form.add("signature", sign(data));

        String body;
        try {
            body = http.post()
                    .uri(path)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
        } catch (RestClientException e) {
            log.warn("Epoint could not be reached to {}: {}", what, e.getMessage());
            throw new ProviderUnavailableException(NAME, "Epoint could not be reached to " + what, e);
        }
        if (isBlank(body)) {
            throw unavailable("Epoint answered a request to " + what + " with nothing.");
        }
        try {
            JsonNode answer = json.readTree(body);
            if (answer == null || !answer.isObject()) {
                throw unavailable("Epoint answered a request to " + what + " with something that is not an object.");
            }
            return answer;
        } catch (JacksonException e) {
            throw new ProviderUnavailableException(
                    NAME, "Epoint answered a request to " + what + " with something that is not JSON.", e);
        }
    }

    /** {@code base64(sha1(private_key + data + private_key))}, over the raw digest. */
    private String sign(String data) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            byte[] digest = sha1.digest(
                    (settings.privateKey() + data + settings.privateKey()).getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("Every JVM ships SHA-1", e);
        }
    }

    private Map<String, Object> parameters(String language) {
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("public_key", settings.publicKey());
        parameters.put("language", language != null && LANGUAGES.contains(language) ? language : settings.language());
        return parameters;
    }

    private static void putIfPresent(Map<String, Object> parameters, String name, Object value) {
        if (value != null && !value.toString().isBlank()) {
            parameters.put(name, value.toString());
        }
    }

    private static void requireAzn(Money amount) {
        if (!CURRENCY.equals(amount.currency())) {
            throw new IllegalArgumentException("Epoint takes AZN only, and this amount is " + amount);
        }
    }

    private void requireSuccess(JsonNode answer, String what) {
        if (!"success".equals(lower(text(answer, "status")))) {
            throw unavailable("Epoint refused to %s: %s".formatted(what, text(answer, "message")));
        }
    }

    private String redacted(JsonNode answer) {
        if (answer instanceof ObjectNode object) {
            ObjectNode copy = object.deepCopy();
            copy.remove(CARDHOLDER_NAME);
            return copy.toString();
        }
        return String.valueOf(answer);
    }

    private static Money amountOf(JsonNode decoded) {
        String amount = text(decoded, "amount");
        if (isBlank(amount)) {
            return null;
        }
        try {
            return Money.of(new BigDecimal(amount.trim()), CURRENCY);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Map<String, String> formOf(byte[] rawBody) {
        Map<String, String> form = new HashMap<>();
        if (rawBody == null) {
            return form;
        }
        for (String pair : new String(rawBody, StandardCharsets.US_ASCII).split("&")) {
            int equals = pair.indexOf('=');
            if (equals <= 0) {
                continue;
            }
            try {
                form.putIfAbsent(
                        URLDecoder.decode(pair.substring(0, equals), StandardCharsets.UTF_8),
                        URLDecoder.decode(pair.substring(equals + 1), StandardCharsets.UTF_8));
            } catch (IllegalArgumentException e) {
                throw new WebhookVerificationException(NAME, "An Epoint callback's body is not a form.", e);
            }
        }
        return form;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.asString();
    }

    private static String codeOr(JsonNode answer, String fallback) {
        String code = text(answer, "code");
        return isBlank(code) ? fallback : code;
    }

    private static String lower(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String firstPresent(String... values) {
        for (String value : values) {
            if (!isBlank(value)) {
                return value;
            }
        }
        return null;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static ProviderUnavailableException unavailable(String message) {
        return new ProviderUnavailableException(NAME, message);
    }

    private static UnsupportedOperationException storedCardsRetired() {
        return new UnsupportedOperationException(
                "Epoint takes payments on its own page under IDN-EXT-01; stored-card collection is retired (#39).");
    }
}
