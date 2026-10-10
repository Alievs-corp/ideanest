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
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * §9.4's adapter for Payriff, Gateway API v3 — #351.
 *
 * <h2>The wire format</h2>
 *
 * <p>JSON in both directions, authenticated by the application's secret key in {@code Authorization}
 * with no scheme prefix. Every answer is an envelope — {@code code}, {@code message},
 * {@code responseId}, {@code payload} — and {@code 00000} is the only success. Payriff reports some
 * refusals with HTTP 200, so the code is read whatever the status.
 *
 * <h2>What it maps, and to what</h2>
 *
 * <ul>
 *   <li>{@link #beginHostedPayment} is {@code POST /orders}, a {@code PURCHASE}: the backer pays on
 *       Payriff's page. The order id is the provider transaction id everywhere else.
 *   <li>{@link #lookUpPayment} is {@code GET /orders/{orderId}}.
 *   <li>{@link #refund} is {@code POST /refund}, in full or in part. Like Epoint's {@code /reverse} it
 *       takes no idempotency key, so this translates one call into one request and #40's protection is
 *       the platform's own.
 *   <li>{@link #parseWebhook} is the order callback.
 * </ul>
 *
 * <h2>The callback is not signed</h2>
 *
 * <p>Payriff signs nothing it posts, so the body is not evidence of anything. The adapter takes only
 * the order id from it and asks {@code GET /orders/{orderId}} with the secret key: the event is built
 * from Payriff's own answer, and an order Payriff does not find is refused as unverifiable. A forged
 * callback can therefore cause one lookup and nothing else, and {@code ProviderWebhooks} makes it
 * before opening a transaction, so the lookup holds no database connection.
 *
 * <p>A callback whose order is not yet decided, or a lookup Payriff could not answer, is a provider
 * unavailable rather than a delivery to record: the response is a 500 and Payriff sends it again.
 * Recording it would answer 200 to the only news of a payment that nothing else goes looking for.
 *
 * <h2>Not here</h2>
 *
 * <p>Payouts: Payriff's {@code /payout} takes a card number, name and FIN rather than a card registered
 * on its page, which §17.2's SAQ A target does not allow. #352 decides; until then
 * {@link #payout} and {@link #beginPayoutCardRegistration} refuse. Stored-card collection is retired
 * (#39), as it is for Epoint.
 *
 * <h2>Card data</h2>
 *
 * <p>Payriff returns a masked card number, which is kept — SAQ A permits it, and support needs it
 * — and may return the holder's name, phone and FIN, which are removed from every
 * {@code rawResponse} and event body before it leaves this class (§17.2).
 */
@Component
@ConditionalOnProperty(prefix = "ideanest.payment.provider", name = "primary", havingValue = "PAYRIFF")
public class PayriffPaymentProvider implements PaymentProvider {

    private static final Logger log = LoggerFactory.getLogger(PayriffPaymentProvider.class);

    private static final ProviderName NAME = ProviderName.PAYRIFF;

    private static final String SUCCESS = "00000";

    /** Payriff's answer when the application key is refused: a configuration fault, never a decline. */
    private static final Set<String> AUTHENTICATION = Set.of("14010", "14013", "14014", "14015");

    private static final Set<String> CURRENCIES = Set.of("AZN", "USD", "EUR");

    private static final Set<String> LANGUAGES = Set.of("az", "en", "ru");

    /** Fields that would identify a person in a stored response. */
    private static final Set<String> PERSONAL = Set.of("cardHolderName", "cardHolder", "fullName", "phoneNumber", "finCode");

    /** Long, because Payriff's own client allows a minute: bank operations take tens of seconds. */
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(30);

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);

    private final RestClient http;
    private final PaymentProperties.Payriff settings;
    private final ObjectMapper json;

    /** The platform's JDK transport with this adapter's timeouts: the default is none. */
    @Autowired
    public PayriffPaymentProvider(RestClient.Builder builder, PaymentProperties properties, ObjectMapper json) {
        this(properties, json, builder.requestFactory(timedRequests()));
    }

    /**
     * Over a transport the caller has already set up — the tests' mock server — and so without the
     * timeouts, which are the transport's to apply.
     */
    public static PayriffPaymentProvider over(
            RestClient.Builder transport, PaymentProperties properties, ObjectMapper json) {
        return new PayriffPaymentProvider(properties, json, transport);
    }

    private PayriffPaymentProvider(PaymentProperties properties, ObjectMapper json, RestClient.Builder builder) {
        this.settings = properties.payriff();
        if (!settings.isComplete()) {
            throw new IllegalStateException(
                    "ideanest.payment.provider.primary is PAYRIFF and ideanest.payment.payriff is missing its"
                            + " secret key or callback URL.");
        }
        if (!settings.callbackUrl().startsWith("https://")) {
            throw new IllegalStateException(
                    "ideanest.payment.payriff.callback-url must be https: Payriff refuses any other callback.");
        }
        this.json = json;
        this.http = builder.baseUrl(settings.baseUrl())
                .defaultHeader(HttpHeaders.AUTHORIZATION, settings.secretKey())
                .build();
    }

    @Override
    public ProviderName name() {
        return NAME;
    }

    @Override
    public HostedPaymentSession beginHostedPayment(HostedPaymentRequest request) {
        requireSupported(request.amount());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("amount", request.amount().amount());
        body.put("currency", request.amount().currency());
        body.put("language", language(request.language()));
        body.put("operation", "PURCHASE");
        putIfPresent(body, "description", request.description());
        body.put("callbackUrl", settings.callbackUrl());
        // One return address: the page it lands on asks what the payment came to, so success and
        // failure need not be told apart by the address.
        putIfPresent(body, "redirectUrl", request.successUrl());
        body.put("cardSave", false);

        JsonNode payload = requireSuccess(
                exchange(post("/orders", body).header("X-REQUEST-RRN", request.idempotencyKey()), "begin a payment"),
                "begin a payment");
        String orderId = text(payload, "orderId");
        String paymentUrl = text(payload, "paymentUrl");
        if (isBlank(orderId) || isBlank(paymentUrl)) {
            throw unavailable("Payriff began a payment and did not say which, or where to send the backer.");
        }
        return new HostedPaymentSession(orderId, URI.create(paymentUrl));
    }

    @Override
    public PaymentLookup lookUpPayment(String providerTransactionId) {
        JsonNode answer = exchange(http.get().uri("/orders/{orderId}", providerTransactionId), "look up a payment");
        JsonNode payload = requireSuccess(answer, "look up a payment");
        String status = upper(text(payload, "paymentStatus"));
        PaymentLookup.State state = switch (status) {
            case "CREATED", "PENDING", "ACCEPTED", "IN_REVIEW", "REFUND_IN_PROGRESS" -> PaymentLookup.State.PENDING;
            case "APPROVED", "PAID" -> PaymentLookup.State.SUCCEEDED;
            case "REFUNDED", "REVERSE", "PARTIAL_REFUND" -> PaymentLookup.State.RETURNED;
            case "DECLINED", "CANCELED", "EXPIRED", "FAILED" -> PaymentLookup.State.FAILED;
            default -> throw unavailable("Payriff answered a lookup of %s with status '%s'."
                    .formatted(providerTransactionId, status));
        };
        String orderId = text(payload, "orderId");
        return new PaymentLookup(
                state,
                isBlank(orderId) ? providerTransactionId : orderId,
                text(answer, "code"),
                lastResponseDescription(payload),
                redacted(answer));
    }

    @Override
    public RefundResult refund(RefundRequest request) {
        requireSupported(request.amount());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("orderId", request.providerTransactionId());
        body.put("amount", request.amount().amount());
        body.put("refundReason", request.reasonCode());

        JsonNode answer = exchange(post("/refund", body), "refund a payment");
        String code = text(answer, "code");
        if (AUTHENTICATION.contains(code)) {
            throw unavailable("Payriff refused the secret key while refunding: " + text(answer, "message"));
        }
        if (SUCCESS.equals(code)) {
            return new RefundResult(ProviderOutcome.APPROVED, null, null, null, redacted(answer));
        }
        return new RefundResult(
                ProviderOutcome.DECLINED,
                null,
                isBlank(code) ? "refund_refused" : code,
                text(answer, "message"),
                redacted(answer));
    }

    @Override
    public PaymentEvent parseWebhook(byte[] rawBody, Map<String, String> headers) {
        JsonNode delivered;
        try {
            delivered = rawBody == null || rawBody.length == 0 ? null : json.readTree(rawBody);
        } catch (JacksonException e) {
            throw new WebhookVerificationException(NAME, "A Payriff callback is not JSON.", e);
        }
        if (delivered == null || !delivered.isObject()) {
            throw new WebhookVerificationException(NAME, "A Payriff callback is not a JSON object.");
        }
        JsonNode payload = delivered.get("payload");
        String orderId = firstPresent(text(payload, "orderId"), text(delivered, "orderId"));
        if (isBlank(orderId)) {
            throw new WebhookVerificationException(NAME, "A Payriff callback names no order.");
        }

        // The callback is unsigned: what Payriff answers about the order is the event, not the body.
        Answer answer = send(http.get().uri("/orders/{orderId}", orderId), "confirm a callback");
        if (!SUCCESS.equals(text(answer.body(), "code"))) {
            if (answer.status() == 404) {
                throw new WebhookVerificationException(
                        NAME, "Payriff does not know order %s: %s".formatted(orderId, text(answer.body(), "message")));
            }
            // Anything else — a refused key, a rate limit, a refusal to say — is Payriff not answering,
            // and a 400 here would stop it sending the only news of the payment.
            throw unavailable("Payriff could not confirm order %s: %s (%s)"
                    .formatted(orderId, text(answer.body(), "message"), text(answer.body(), "code")));
        }
        JsonNode confirmed = answer.body().get("payload");
        String status = upper(text(confirmed, "paymentStatus"));
        PaymentEventType type = switch (status) {
            case "APPROVED", "PAID" -> PaymentEventType.CHARGE_SUCCEEDED;
            case "DECLINED", "CANCELED", "EXPIRED", "FAILED" -> PaymentEventType.CHARGE_FAILED;
            case "REFUNDED", "REVERSE", "PARTIAL_REFUND" -> PaymentEventType.REFUND_SUCCEEDED;
            // Not decided yet: recorded, this delivery would be answered 200 and never sent again.
            case "CREATED", "PENDING", "ACCEPTED", "IN_REVIEW", "REFUND_IN_PROGRESS" ->
                throw unavailable("Payriff's callback for order %s arrived while it is still %s."
                        .formatted(orderId, status));
            default -> PaymentEventType.UNRECOGNISED;
        };
        // No event id and no signing time: the order and the status it reached identify a delivery,
        // so a redelivery of the same news is a duplicate and the order's later refund is not.
        String eventId = orderId + ":" + (status.isEmpty() ? "UNKNOWN" : status);
        return new PaymentEvent(NAME, eventId, type, orderId, amountOf(confirmed), null, redacted(answer.body()));
    }

    @Override
    public PayoutResult payout(PayoutRequest request) {
        throw payoutsUndecided();
    }

    @Override
    public PayoutCardSession beginPayoutCardRegistration(PayoutCardRequest request) {
        throw payoutsUndecided();
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
     * Payments on its page and refunds in part, in AZN, USD and EUR. Card saving and
     * {@code /autoPay} exist at Payriff, but merchant-initiated charges and scheme chaining are not
     * confirmed in writing — and unused under IDN-EXT-01 — so the retired collection is not claimed.
     */
    @Override
    public ProviderCapabilities capabilities() {
        return new ProviderCapabilities(true, false, null, false, false, true, Set.of(), CURRENCIES);
    }

    // ------------------------------------------------------------------
    // The wire
    // ------------------------------------------------------------------

    /**
     * Sends the request and reads Payriff's envelope, whatever the HTTP status.
     *
     * <p>A 5xx, a body that is not an envelope, or no answer at all is a provider that could not be
     * asked. A 4xx with an envelope is Payriff's answer, and the caller decides what it means.
     */
    private JsonNode exchange(RestClient.RequestHeadersSpec<?> request, String what) {
        return send(request, what).body();
    }

    /** Payriff's envelope and the HTTP status it came with. */
    private record Answer(int status, JsonNode body) {}

    private Answer send(RestClient.RequestHeadersSpec<?> request, String what) {
        ResponseEntity<String> response;
        try {
            response = request.accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .onStatus(status -> true, (sent, received) -> {})
                    .toEntity(String.class);
        } catch (RestClientException e) {
            log.warn("Payriff could not be reached to {}: {}", what, e.getMessage());
            throw new ProviderUnavailableException(NAME, "Payriff could not be reached to " + what, e);
        }
        if (response.getStatusCode().is5xxServerError()) {
            throw unavailable("Payriff answered a request to %s with HTTP %d."
                    .formatted(what, response.getStatusCode().value()));
        }
        String body = response.getBody();
        if (isBlank(body)) {
            throw unavailable("Payriff answered a request to " + what + " with nothing.");
        }
        JsonNode answer;
        try {
            answer = json.readTree(body);
        } catch (JacksonException e) {
            throw new ProviderUnavailableException(
                    NAME, "Payriff answered a request to " + what + " with something that is not JSON.", e);
        }
        if (answer == null || !answer.isObject() || isBlank(text(answer, "code"))) {
            throw unavailable("Payriff answered a request to " + what + " with something that is not its envelope.");
        }
        return new Answer(response.getStatusCode().value(), answer);
    }

    private static JdkClientHttpRequestFactory timedRequests() {
        JdkClientHttpRequestFactory requests = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build());
        requests.setReadTimeout(READ_TIMEOUT);
        return requests;
    }

    /** Written by this service's mapper, so an amount goes out as the decimal it is. */
    private RestClient.RequestBodySpec post(String path, Map<String, Object> body) {
        String written;
        try {
            written = json.writeValueAsString(body);
        } catch (JacksonException e) {
            throw new IllegalStateException("Could not write a Payriff request to " + path, e);
        }
        return http.post().uri(path).contentType(MediaType.APPLICATION_JSON).body(written);
    }

    /** Before a card has been seen, any refusal is a configuration fault and not a decline. */
    private JsonNode requireSuccess(JsonNode answer, String what) {
        if (!SUCCESS.equals(text(answer, "code"))) {
            throw unavailable("Payriff refused to %s: %s (%s)"
                    .formatted(what, text(answer, "message"), text(answer, "code")));
        }
        JsonNode payload = answer.get("payload");
        if (payload == null || !payload.isObject()) {
            throw unavailable("Payriff answered a request to " + what + " with no payload.");
        }
        return payload;
    }

    private String language(String requested) {
        String chosen = requested != null && LANGUAGES.contains(requested.toLowerCase(Locale.ROOT))
                ? requested
                : settings.language();
        return chosen.toUpperCase(Locale.ROOT);
    }

    private static void requireSupported(Money amount) {
        if (!CURRENCIES.contains(amount.currency())) {
            throw new IllegalArgumentException("Payriff takes AZN, USD and EUR, and this amount is " + amount);
        }
    }

    private static void putIfPresent(Map<String, Object> body, String name, Object value) {
        if (value != null && !value.toString().isBlank()) {
            body.put(name, value.toString());
        }
    }

    private static String lastResponseDescription(JsonNode payload) {
        JsonNode transactions = payload.get("transactions");
        if (transactions == null || !transactions.isArray() || transactions.isEmpty()) {
            return null;
        }
        return text(transactions.get(transactions.size() - 1), "responseDescription");
    }

    private String redacted(JsonNode answer) {
        JsonNode copy = answer.deepCopy();
        strip(copy);
        return copy.toString();
    }

    private static void strip(JsonNode node) {
        if (node instanceof ObjectNode object) {
            object.remove(PERSONAL);
            object.values().forEach(PayriffPaymentProvider::strip);
        } else if (node != null && node.isArray()) {
            node.values().forEach(PayriffPaymentProvider::strip);
        }
    }

    private static Money amountOf(JsonNode payload) {
        String amount = text(payload, "amount");
        String currency = upper(firstPresent(text(payload, "currencyType"), text(payload, "currency")));
        if (isBlank(amount) || !CURRENCIES.contains(currency)) {
            return null;
        }
        try {
            return Money.of(new BigDecimal(amount.trim()), currency);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.asString();
    }

    private static String upper(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
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

    private static UnsupportedOperationException payoutsUndecided() {
        return new UnsupportedOperationException(
                "Payriff pays out to a card number, which SAQ A does not allow; #352 decides how creators are paid.");
    }

    private static UnsupportedOperationException storedCardsRetired() {
        return new UnsupportedOperationException(
                "Payriff takes payments on its own page under IDN-EXT-01; stored-card collection is retired (#39).");
    }
}
