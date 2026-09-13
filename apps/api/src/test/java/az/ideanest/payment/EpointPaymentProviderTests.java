package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.HostedPaymentSession;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PayoutCardRequest;
import az.ideanest.payment.domain.PayoutCardSession;
import az.ideanest.payment.domain.PayoutRequest;
import az.ideanest.payment.domain.PayoutResult;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.domain.WebhookVerificationException;
import az.ideanest.payment.infrastructure.EpointPaymentProvider;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * The Epoint.az adapter against API v1.0.3's wire format — IDN-EXT-01 (#38).
 *
 * <p>No Epoint is contacted: {@link MockRestServiceServer} answers, and every request the adapter
 * sends is decoded and read back here — the signature recomputed independently, the parameters
 * decoded from base64 — because a request that is merely sent proves nothing about whether Epoint
 * would accept it. The callback vector was computed outside the JVM, so the adapter's signature is
 * held to Epoint's formula and not to itself.
 */
class EpointPaymentProviderTests {

    private static final String BASE = "https://epoint.test.invalid/api/1";
    private static final String PUBLIC = "i000000001";
    private static final String PRIVATE = "test-private-key";

    private static final ObjectMapper JSON = JsonMapper.builder().build();

    /** {@code {"order_id":"key-1","status":"success",...,"amount":"20.50"}}, signed with {@link #PRIVATE}. */
    private static final String CALLBACK_DATA =
            "eyJvcmRlcl9pZCI6ImtleS0xIiwic3RhdHVzIjoic3VjY2VzcyIsImNvZGUiOiIwMDAiLCJtZXNzYWdlIjoiQXBwcm92ZWQiLCJ0cmFuc2FjdGlvbiI6InRlMDAxMjM0IiwiYmFua190cmFuc2FjdGlvbiI6ImItNzciLCJvcGVyYXRpb25fY29kZSI6IjEwMCIsInJybiI6IjEyMzQ1Njc4OTAxMiIsImNhcmRfbmFtZSI6IkFZU0VMIE0iLCJjYXJkX21hc2siOiI0MTY5NzMqKioqKioxMjM0IiwiYW1vdW50IjoiMjAuNTAifQ==";

    private static final String CALLBACK_SIGNATURE = "K6vw2/ZD45fxioxS0koiX6gvPaY=";

    // ------------------------------------------------------------------
    // Signing and the payment page
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a payment is a signed form of base64 JSON, with the amount written from the decimal")
    void aPaymentIsSignedAndCarriesTheDecimal() throws Exception {
        Recorded recorded = new Recorded();
        EpointPaymentProvider epoint = answering("/request", recorded, """
                {"status":"success","transaction":"te001234","redirect_url":"https://epoint.az/pay/te001234"}
                """);

        HostedPaymentSession session = epoint.beginHostedPayment(new HostedPaymentRequest(
                UUID.randomUUID(),
                Money.of(new BigDecimal("20.50"), "AZN"),
                "A pledge",
                "en",
                URI.create("https://ideanest.az/back/ok"),
                URI.create("https://ideanest.az/back/error"),
                "key-1"));

        assertThat(session.providerTransactionId()).isEqualTo("te001234");
        assertThat(session.redirectUrl()).hasToString("https://epoint.az/pay/te001234");

        // The signature Epoint checks: base64(sha1(private + data + private)), the raw digest.
        assertThat(recorded.signature()).isEqualTo(signatureOf(recorded.data()));
        // Written from the BigDecimal: 20.50, never 20.5 and never a double's 20.499999.
        assertThat(recorded.json()).contains("\"amount\":20.50");
        JsonNode parameters = JSON.readTree(recorded.json());
        assertThat(parameters.get("public_key").asString()).isEqualTo(PUBLIC);
        assertThat(parameters.get("currency").asString()).isEqualTo("AZN");
        assertThat(parameters.get("language").asString()).isEqualTo("en");
        assertThat(parameters.get("order_id").asString()).isEqualTo("key-1");
        assertThat(parameters.get("success_redirect_url").asString()).isEqualTo("https://ideanest.az/back/ok");
    }

    @Test
    @DisplayName("an amount in anything but AZN is refused before a request is made")
    void onlyAzn() {
        EpointPaymentProvider epoint = answering("/request", new Recorded(), "{}");

        assertThatThrownBy(() -> epoint.beginHostedPayment(new HostedPaymentRequest(
                        UUID.randomUUID(), Money.of(new BigDecimal("10.00"), "USD"), null, null, null, null, "k")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AZN");
    }

    @Test
    @DisplayName("a refused payment page, or an Epoint that cannot be reached, is a provider unavailable")
    void refusalsAndOutagesAreUnavailable() {
        EpointPaymentProvider refusing = answering("/request", new Recorded(), """
                {"status":"error","message":"Invalid public key"}
                """);
        assertThatThrownBy(() -> refusing.beginHostedPayment(payment()))
                .isInstanceOf(ProviderUnavailableException.class)
                .hasMessageContaining("Invalid public key");

        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(BASE + "/request")).andRespond(withServerError());
        EpointPaymentProvider down = new EpointPaymentProvider(builder, properties(), JSON);
        assertThatThrownBy(() -> down.beginHostedPayment(payment())).isInstanceOf(ProviderUnavailableException.class);
    }

    // ------------------------------------------------------------------
    // Looking a payment up
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a lookup maps new, success, returned and error, and removes the cardholder's name")
    void lookupsMapEveryStatus() {
        assertThat(lookUp("new").state()).isEqualTo(PaymentLookup.State.PENDING);
        assertThat(lookUp("success").state()).isEqualTo(PaymentLookup.State.SUCCEEDED);
        assertThat(lookUp("returned").state()).isEqualTo(PaymentLookup.State.RETURNED);
        assertThat(lookUp("error").state()).isEqualTo(PaymentLookup.State.FAILED);

        PaymentLookup paid = lookUp("success");
        assertThat(paid.bankCode()).isEqualTo("000");
        assertThat(paid.rawResponse()).doesNotContain("AYSEL").contains("416973******1234");
    }

    @Test
    @DisplayName("server_error is Epoint unable to answer, not a payment that failed")
    void aServerErrorIsNotAFailedPayment() {
        assertThatThrownBy(() -> lookUp("server_error")).isInstanceOf(ProviderUnavailableException.class);
    }

    // ------------------------------------------------------------------
    // Refunds, payout cards and payouts
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a refund is /reverse against the transaction, in part if asked, and a refusal is a decline")
    void refundsReverse() throws Exception {
        Recorded recorded = new Recorded();
        RefundResult approved = answering("/reverse", recorded, "{\"status\":\"success\"}").refund(refund("5.00"));

        assertThat(approved.outcome()).isEqualTo(ProviderOutcome.APPROVED);
        JsonNode parameters = JSON.readTree(recorded.json());
        assertThat(parameters.get("transaction").asString()).isEqualTo("te001234");
        assertThat(recorded.json()).contains("\"amount\":5.00");

        RefundResult refused = answering("/reverse", new Recorded(), """
                {"status":"error","message":"Transaction is older than allowed"}
                """).refund(refund("5.00"));
        assertThat(refused.outcome()).isEqualTo(ProviderOutcome.DECLINED);
        assertThat(refused.failureCode()).isEqualTo("reverse_refused");
        assertThat(refused.failureMessage()).contains("older");
    }

    @Test
    @DisplayName("a payout card is registered with refund=1, and its identifier comes back")
    void aPayoutCardIsRegisteredForPayouts() throws Exception {
        Recorded recorded = new Recorded();
        PayoutCardSession session = answering("/card-registration", recorded, """
                {"status":"success","card_id":"cev000123","redirect_url":"https://epoint.az/card/cev000123"}
                """).beginPayoutCardRegistration(new PayoutCardRequest(UUID.randomUUID(), "Payout card", "az", null, null));

        assertThat(session.cardId()).isEqualTo("cev000123");
        assertThat(JSON.readTree(recorded.json()).get("refund").asInt()).isEqualTo(1);
    }

    @Test
    @DisplayName("a payout is /refund-request to the card under the idempotency key, and a failure is a decline")
    void payoutsGoToTheCard() throws Exception {
        Recorded recorded = new Recorded();
        PayoutResult paid = answering("/refund-request", recorded, """
                {"status":"success","transaction":"tp000555","card_name":"AYSEL M","card_mask":"416973******1234"}
                """).payout(payout());

        assertThat(paid.outcome()).isEqualTo(ProviderOutcome.APPROVED);
        assertThat(paid.providerTransactionId()).isEqualTo("tp000555");
        assertThat(paid.rawResponse()).doesNotContain("AYSEL");
        JsonNode parameters = JSON.readTree(recorded.json());
        assertThat(parameters.get("card_id").asString()).isEqualTo("cev000123");
        assertThat(parameters.get("order_id").asString()).isEqualTo("payout-key-1");

        PayoutResult failed = answering("/refund-request", new Recorded(), """
                {"status":"failed","code":"116","message":"Insufficient funds"}
                """).payout(payout());
        assertThat(failed.outcome()).isEqualTo(ProviderOutcome.DECLINED);
        assertThat(failed.failureCode()).isEqualTo("116");
    }

    // ------------------------------------------------------------------
    // Callbacks
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a callback signed with Epoint's formula verifies and becomes a charge that succeeded")
    void aSignedCallbackVerifies() {
        PaymentEvent event = adapter().parseWebhook(form(CALLBACK_DATA, CALLBACK_SIGNATURE), Map.of());

        assertThat(event.provider()).isEqualTo(ProviderName.EPOINT);
        assertThat(event.type()).isEqualTo(PaymentEventType.CHARGE_SUCCEEDED);
        assertThat(event.providerTransactionId()).isEqualTo("te001234");
        assertThat(event.providerEventId()).isEqualTo("te001234:success:100");
        assertThat(event.amount()).isEqualTo(Money.of(new BigDecimal("20.50"), "AZN"));
        assertThat(event.rawBody()).doesNotContain("AYSEL").contains("te001234");
    }

    @Test
    @DisplayName("a callback whose signature does not match, or that has none, is refused")
    void anUnsignedCallbackIsRefused() {
        assertThatThrownBy(() -> adapter().parseWebhook(form(CALLBACK_DATA, signatureOf(CALLBACK_DATA + "x")), Map.of()))
                .isInstanceOf(WebhookVerificationException.class);
        assertThatThrownBy(() -> adapter()
                        .parseWebhook(("data=" + URLEncoder.encode(CALLBACK_DATA, StandardCharsets.UTF_8)).getBytes(), Map.of()))
                .isInstanceOf(WebhookVerificationException.class);
    }

    @Test
    @DisplayName("a returned payment is a refund, and a card registration is not a charge")
    void returnedAndCardRegistration() {
        String returned = encoded("{\"transaction\":\"te001234\",\"status\":\"returned\",\"operation_code\":\"100\"}");
        assertThat(adapter().parseWebhook(form(returned, signatureOf(returned)), Map.of()).type())
                .isEqualTo(PaymentEventType.REFUND_SUCCEEDED);

        String registered = encoded("{\"card_id\":\"cev000123\",\"status\":\"success\",\"operation_code\":\"001\"}");
        PaymentEvent card = adapter().parseWebhook(form(registered, signatureOf(registered)), Map.of());
        assertThat(card.type()).isEqualTo(PaymentEventType.UNRECOGNISED);
        assertThat(card.providerEventId()).isEqualTo("cev000123:success:001");
    }

    // ------------------------------------------------------------------
    // What it is not
    // ------------------------------------------------------------------

    @Test
    @DisplayName("it does not claim stored-card collection, takes AZN only, and refuses the retired calls")
    void notTheStoredCardModel() {
        EpointPaymentProvider epoint = adapter();

        assertThat(epoint.capabilities().supportsStoredCardCollection()).isFalse();
        assertThat(epoint.capabilities().currencies()).containsExactly("AZN");
        assertThat(epoint.capabilities().partialRefund()).isTrue();
        assertThatThrownBy(() -> epoint.chargeStoredCard(null)).isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> epoint.beginTokenization(null)).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    @DisplayName("naming EPOINT without its keys is a start-up failure, and the private key is never printed")
    void configuration() {
        PaymentProperties incomplete = new PaymentProperties(
                new PaymentProperties.Provider("EPOINT"), null, null, null, null,
                new PaymentProperties.Epoint(BASE, PUBLIC, "", "az"));
        assertThatThrownBy(() -> new EpointPaymentProvider(RestClient.builder(), incomplete, JSON))
                .isInstanceOf(IllegalStateException.class);

        assertThat(properties().epoint().toString()).doesNotContain(PRIVATE).contains("<redacted>");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static PaymentProperties properties() {
        return new PaymentProperties(
                new PaymentProperties.Provider("EPOINT"), null, null, null, null,
                new PaymentProperties.Epoint(BASE, PUBLIC, PRIVATE, "az"));
    }

    private static EpointPaymentProvider adapter() {
        return new EpointPaymentProvider(RestClient.builder(), properties(), JSON);
    }

    /** What the adapter sent: the form's two fields, and the JSON inside {@code data}. */
    private static final class Recorded {
        private final AtomicReference<Map<String, String>> form = new AtomicReference<>(Map.of());

        String data() {
            return form.get().get("data");
        }

        String signature() {
            return form.get().get("signature");
        }

        String json() {
            return new String(Base64.getDecoder().decode(data()), StandardCharsets.UTF_8);
        }
    }

    private static EpointPaymentProvider answering(String path, Recorded recorded, String body) {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(BASE + path))
                .andExpect(method(HttpMethod.POST))
                .andExpect(request -> {
                    String sent = ((MockClientHttpRequest) request).getBodyAsString();
                    Map<String, String> fields = new HashMap<>();
                    for (String pair : sent.split("&")) {
                        int equals = pair.indexOf('=');
                        fields.put(
                                URLDecoder.decode(pair.substring(0, equals), StandardCharsets.UTF_8),
                                URLDecoder.decode(pair.substring(equals + 1), StandardCharsets.UTF_8));
                    }
                    recorded.form.set(fields);
                })
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
        return new EpointPaymentProvider(builder, properties(), JSON);
    }

    private static PaymentLookup lookUp(String status) {
        return answering("/get-status", new Recorded(), """
                {"status":"%s","code":"000","message":"m","transaction":"te001234",
                 "card_name":"AYSEL M","card_mask":"416973******1234","amount":20.50}
                """.formatted(status)).lookUpPayment("te001234");
    }

    private static HostedPaymentRequest payment() {
        return new HostedPaymentRequest(
                UUID.randomUUID(), Money.of(new BigDecimal("20.50"), "AZN"), null, null, null, null, "key-1");
    }

    private static RefundRequest refund(String amount) {
        return new RefundRequest(
                UUID.randomUUID(), "te001234", Money.of(new BigDecimal(amount), "AZN"), "campaign_unsuccessful", "refund-key-1");
    }

    private static PayoutRequest payout() {
        return new PayoutRequest(
                UUID.randomUUID(), UUID.randomUUID(), Money.of(new BigDecimal("850.00"), "AZN"), "cev000123", "payout-key-1");
    }

    private static String encoded(String json) {
        return Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] form(String data, String signature) {
        return ("data=" + URLEncoder.encode(data, StandardCharsets.UTF_8)
                        + "&signature=" + URLEncoder.encode(signature, StandardCharsets.UTF_8))
                .getBytes(StandardCharsets.US_ASCII);
    }

    /** Epoint's formula, computed here rather than by the adapter. */
    private static String signatureOf(String data) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1")
                    .digest((PRIVATE + data + PRIVATE).getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
