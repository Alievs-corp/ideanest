package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.HostedPaymentSession;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PayoutCardRequest;
import az.ideanest.payment.domain.PayoutRequest;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.domain.WebhookVerificationException;
import az.ideanest.payment.infrastructure.PayriffPaymentProvider;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.ResponseActions;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * The Payriff adapter against Gateway API v3's wire format — #351.
 *
 * <p>No Payriff is contacted: {@link MockRestServiceServer} answers with envelopes shaped like
 * Payriff's, and every request the adapter sends is read back here, because a request that is merely
 * sent proves nothing about whether Payriff would accept it.
 */
class PayriffPaymentProviderTests {

    private static final String BASE = "https://payriff.test.invalid/api/v3";
    private static final String SECRET = "test-secret-key";
    private static final String CALLBACK = "https://api.ideanest.test/v1/webhooks/psp/payriff";

    private static final ObjectMapper JSON = JsonMapper.builder().build();

    private static final String APPROVED_ORDER = """
            {"code":"00000","message":"Approved","responseId":"r-1","payload":{
              "orderId":"ord-1","amount":20.50,"currencyType":"AZN","paymentStatus":"APPROVED",
              "transactions":[{"status":"APPROVED","pan":"400000******2078","responseDescription":"Approved",
                "cardDetails":{"maskedPan":"400000******2078","brand":"VISA","cardHolderName":"TEST TEST","phoneNumber":"+994501234567"}}]}}
            """;

    // ------------------------------------------------------------------
    // The payment page
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an order is JSON with the decimal amount, the secret key unprefixed and the idempotency key as its RRN")
    void anOrderCarriesTheDecimalAndTheKey() throws Exception {
        AtomicReference<String> sent = new AtomicReference<>();
        Wire wire = new Wire();
        wire.expect(HttpMethod.POST, "/orders")
                .andExpect(header("Authorization", SECRET))
                .andExpect(header("X-REQUEST-RRN", "key-1"))
                .andExpect(request -> sent.set(((MockClientHttpRequest) request).getBodyAsString()))
                .andRespond(withSuccess("""
                        {"code":"00000","message":"Created","payload":{"orderId":"ord-1",
                         "paymentUrl":"https://pay.payriff.com/ord-1","transactionId":77}}
                        """, MediaType.APPLICATION_JSON));

        HostedPaymentSession session = wire.adapter().beginHostedPayment(new HostedPaymentRequest(
                UUID.randomUUID(),
                Money.of(new BigDecimal("20.50"), "AZN"),
                "A pledge",
                "en",
                URI.create("https://ideanest.az/back?payment=returned"),
                URI.create("https://ideanest.az/back?payment=failed"),
                "key-1"));

        assertThat(session.providerTransactionId()).isEqualTo("ord-1");
        assertThat(session.redirectUrl()).hasToString("https://pay.payriff.com/ord-1");
        // Written from the BigDecimal: 20.50, never 20.5 and never a double's 20.499999.
        assertThat(sent.get()).contains("\"amount\":20.50");
        JsonNode body = JSON.readTree(sent.get());
        assertThat(body.get("currency").asString()).isEqualTo("AZN");
        assertThat(body.get("language").asString()).isEqualTo("EN");
        assertThat(body.get("operation").asString()).isEqualTo("PURCHASE");
        assertThat(body.get("callbackUrl").asString()).isEqualTo(CALLBACK);
        assertThat(body.get("redirectUrl").asString()).isEqualTo("https://ideanest.az/back?payment=returned");
        assertThat(body.get("cardSave").asBoolean()).isFalse();
        wire.verify();
    }

    @Test
    @DisplayName("a currency Payriff does not take is refused before a request is made")
    void anUnsupportedCurrencyIsRefused() {
        Wire wire = new Wire();

        assertThatThrownBy(() -> wire.adapter().beginHostedPayment(new HostedPaymentRequest(
                        UUID.randomUUID(), Money.of(new BigDecimal("10.00"), "GBP"), null, null, null, null, "k")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AZN");
        wire.verify();
    }

    @Test
    @DisplayName("a refused order, even under HTTP 200, and a Payriff that fails are both a provider unavailable")
    void refusalsAndOutagesAreUnavailable() {
        Wire refusing = new Wire();
        refusing.expect(HttpMethod.POST, "/orders")
                .andRespond(withSuccess("""
                        {"code":"15400","message":"amount must be positive","responseId":"r-2"}
                        """, MediaType.APPLICATION_JSON));
        assertThatThrownBy(() -> refusing.adapter().beginHostedPayment(payment()))
                .isInstanceOf(ProviderUnavailableException.class)
                .hasMessageContaining("amount must be positive");

        Wire failing = new Wire();
        failing.expect(HttpMethod.POST, "/orders").andRespond(withServerError());
        assertThatThrownBy(() -> failing.adapter().beginHostedPayment(payment()))
                .isInstanceOf(ProviderUnavailableException.class);

        Wire garbled = new Wire();
        garbled.expect(HttpMethod.POST, "/orders").andRespond(withSuccess("<html>", MediaType.TEXT_HTML));
        assertThatThrownBy(() -> garbled.adapter().beginHostedPayment(payment()))
                .isInstanceOf(ProviderUnavailableException.class);
    }

    // ------------------------------------------------------------------
    // Looking a payment up
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a lookup maps Payriff's statuses, and a refund in flight is pending rather than paid")
    void aLookupMapsTheStatuses() {
        assertThat(lookUp("APPROVED").state()).isEqualTo(PaymentLookup.State.SUCCEEDED);
        assertThat(lookUp("CREATED").state()).isEqualTo(PaymentLookup.State.PENDING);
        // SUCCEEDED would tell RefundService the refund failed while Payriff is still carrying it out.
        assertThat(lookUp("REFUND_IN_PROGRESS").state()).isEqualTo(PaymentLookup.State.PENDING);
        assertThat(lookUp("REFUNDED").state()).isEqualTo(PaymentLookup.State.RETURNED);
        assertThat(lookUp("PARTIAL_REFUND").state()).isEqualTo(PaymentLookup.State.RETURNED);
        assertThat(lookUp("DECLINED").state()).isEqualTo(PaymentLookup.State.FAILED);
        assertThat(lookUp("EXPIRED").state()).isEqualTo(PaymentLookup.State.FAILED);
    }

    @Test
    @DisplayName("a status the platform never asks for is Payriff answering something unreadable")
    void anUnexpectedStatusIsUnavailable() {
        assertThatThrownBy(() -> lookUp("PREAUTH_APPROVED")).isInstanceOf(ProviderUnavailableException.class);
    }

    @Test
    @DisplayName("the holder's name and phone never reach a stored response")
    void personalDataIsRedacted() {
        Wire wire = new Wire();
        wire.expect(HttpMethod.GET, "/orders/ord-1").andRespond(withSuccess(APPROVED_ORDER, MediaType.APPLICATION_JSON));

        PaymentLookup lookup = wire.adapter().lookUpPayment("ord-1");

        assertThat(lookup.providerTransactionId()).isEqualTo("ord-1");
        assertThat(lookup.message()).isEqualTo("Approved");
        assertThat(lookup.rawResponse())
                .doesNotContain("TEST TEST")
                .doesNotContain("+994501234567")
                .contains("400000******2078");
    }

    // ------------------------------------------------------------------
    // Refunds
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a refund names the order, the decimal and the reason, and 00000 approves it")
    void aRefundIsApproved() throws Exception {
        AtomicReference<String> sent = new AtomicReference<>();
        Wire wire = new Wire();
        wire.expect(HttpMethod.POST, "/refund")
                .andExpect(request -> sent.set(((MockClientHttpRequest) request).getBodyAsString()))
                .andRespond(withSuccess("""
                        {"code":"00000","message":"Refunded","responseId":"r-3"}
                        """, MediaType.APPLICATION_JSON));

        RefundResult result = wire.adapter().refund(refund("5.00"));

        assertThat(result.outcome()).isEqualTo(ProviderOutcome.APPROVED);
        assertThat(sent.get()).contains("\"amount\":5.00");
        JsonNode body = JSON.readTree(sent.get());
        assertThat(body.get("orderId").asString()).isEqualTo("ord-1");
        assertThat(body.get("refundReason").asString()).isEqualTo("campaign_unsuccessful");
    }

    @Test
    @DisplayName("a refund Payriff refuses is a decline with its code, and a refused key is unavailable")
    void aRefusedRefund() {
        Wire refusing = new Wire();
        refusing.expect(HttpMethod.POST, "/refund")
                .andRespond(withStatus(HttpStatus.BAD_REQUEST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("""
                                {"code":"15400","message":"Refund amount exceeds the payment"}
                                """));
        RefundResult result = refusing.adapter().refund(refund("50.00"));
        assertThat(result.outcome()).isEqualTo(ProviderOutcome.DECLINED);
        assertThat(result.failureCode()).isEqualTo("15400");
        assertThat(result.failureMessage()).contains("exceeds");

        Wire unauthorised = new Wire();
        unauthorised.expect(HttpMethod.POST, "/refund")
                .andRespond(withStatus(HttpStatus.UNAUTHORIZED)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("""
                                {"code":"14010","message":"Invalid secret key"}
                                """));
        assertThatThrownBy(() -> unauthorised.adapter().refund(refund("5.00")))
                .isInstanceOf(ProviderUnavailableException.class);
    }

    // ------------------------------------------------------------------
    // Callbacks
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a callback is confirmed by asking Payriff, and the event is built from Payriff's answer")
    void aCallbackIsConfirmed() {
        Wire wire = new Wire();
        wire.expect(HttpMethod.GET, "/orders/ord-1")
                .andExpect(header("Authorization", SECRET))
                .andRespond(withSuccess(APPROVED_ORDER, MediaType.APPLICATION_JSON));

        // The callback claims DECLINED; Payriff's own answer says APPROVED, and that is what counts.
        PaymentEvent event = wire.adapter().parseWebhook(bytes("""
                {"code":"00000","payload":{"orderId":"ord-1","paymentStatus":"DECLINED","amount":1.00}}
                """), Map.of());

        assertThat(event.provider()).isEqualTo(ProviderName.PAYRIFF);
        assertThat(event.type()).isEqualTo(PaymentEventType.CHARGE_SUCCEEDED);
        assertThat(event.providerTransactionId()).isEqualTo("ord-1");
        assertThat(event.providerEventId()).isEqualTo("ord-1:APPROVED");
        assertThat(event.amount()).isEqualTo(Money.of(new BigDecimal("20.50"), "AZN"));
        assertThat(event.signedAt()).isNull();
        assertThat(event.rawBody()).doesNotContain("TEST TEST");
        wire.verify();
    }

    @Test
    @DisplayName("a callback about an order Payriff does not confirm is refused as unverifiable")
    void anUnconfirmedCallbackIsRefused() {
        Wire wire = new Wire();
        wire.expect(HttpMethod.GET, "/orders/forged")
                .andRespond(withStatus(HttpStatus.NOT_FOUND)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("""
                                {"code":"01000","message":"Order not found"}
                                """));

        assertThatThrownBy(() -> wire.adapter().parseWebhook(bytes("""
                        {"payload":{"orderId":"forged","paymentStatus":"APPROVED"}}
                        """), Map.of()))
                .isInstanceOf(WebhookVerificationException.class);
    }

    @Test
    @DisplayName("a callback for an order not yet decided is unavailable, so Payriff sends it again")
    void anUndecidedCallbackIsRetried() {
        Wire wire = new Wire();
        wire.expect(HttpMethod.GET, "/orders/ord-1")
                .andRespond(withSuccess(APPROVED_ORDER.replace("\"paymentStatus\":\"APPROVED\"", "\"paymentStatus\":\"PENDING\""),
                        MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> wire.adapter().parseWebhook(bytes("{\"payload\":{\"orderId\":\"ord-1\"}}"), Map.of()))
                .isInstanceOf(ProviderUnavailableException.class);
    }

    @Test
    @DisplayName("a lookup Payriff refuses or fails to answer is unavailable, never a refusal of the callback")
    void aFailedConfirmationIsRetried() {
        Wire limited = new Wire();
        limited.expect(HttpMethod.GET, "/orders/ord-1")
                .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("""
                                {"code":"01000","message":"Too many requests"}
                                """));
        assertThatThrownBy(() -> limited.adapter().parseWebhook(bytes("{\"payload\":{\"orderId\":\"ord-1\"}}"), Map.of()))
                .isInstanceOf(ProviderUnavailableException.class);

        Wire failing = new Wire();
        failing.expect(HttpMethod.GET, "/orders/ord-1").andRespond(withServerError());
        assertThatThrownBy(() -> failing.adapter().parseWebhook(bytes("{\"payload\":{\"orderId\":\"ord-1\"}}"), Map.of()))
                .isInstanceOf(ProviderUnavailableException.class);
    }

    @Test
    @DisplayName("a refund or a lookup Payriff fails to answer is unavailable, not a decline")
    void outagesOnRefundAndLookupAreUnavailable() {
        Wire refunding = new Wire();
        refunding.expect(HttpMethod.POST, "/refund").andRespond(withServerError());
        assertThatThrownBy(() -> refunding.adapter().refund(refund("5.00")))
                .isInstanceOf(ProviderUnavailableException.class);

        Wire looking = new Wire();
        looking.expect(HttpMethod.GET, "/orders/ord-1").andRespond(withServerError());
        assertThatThrownBy(() -> looking.adapter().lookUpPayment("ord-1"))
                .isInstanceOf(ProviderUnavailableException.class);
    }

    @Test
    @DisplayName("a callback that is not JSON, or names no order, is refused without asking Payriff")
    void anUnreadableCallbackIsRefused() {
        Wire wire = new Wire();
        PayriffPaymentProvider payriff = wire.adapter();

        assertThatThrownBy(() -> payriff.parseWebhook(bytes("not json"), Map.of()))
                .isInstanceOf(WebhookVerificationException.class);
        assertThatThrownBy(() -> payriff.parseWebhook(bytes("{\"payload\":{}}"), Map.of()))
                .isInstanceOf(WebhookVerificationException.class);
        assertThatThrownBy(() -> payriff.parseWebhook(new byte[0], Map.of()))
                .isInstanceOf(WebhookVerificationException.class);
        wire.verify();
    }

    @Test
    @DisplayName("a refunded order's callback is a refund event, distinct from its earlier payment")
    void aRefundCallback() {
        Wire wire = new Wire();
        wire.expect(HttpMethod.GET, "/orders/ord-1")
                .andRespond(withSuccess(APPROVED_ORDER.replace("\"paymentStatus\":\"APPROVED\"", "\"paymentStatus\":\"REFUNDED\""),
                        MediaType.APPLICATION_JSON));

        PaymentEvent event = wire.adapter().parseWebhook(bytes("{\"payload\":{\"orderId\":\"ord-1\"}}"), Map.of());

        assertThat(event.type()).isEqualTo(PaymentEventType.REFUND_SUCCEEDED);
        assertThat(event.providerEventId()).isEqualTo("ord-1:REFUNDED");
    }

    // ------------------------------------------------------------------
    // What it does not do, and its configuration
    // ------------------------------------------------------------------

    @Test
    @DisplayName("#352: payouts and payout cards refuse rather than send a card number")
    void payoutsRefuse() {
        PayriffPaymentProvider payriff = new Wire().adapter();

        assertThatThrownBy(() -> payriff.payout(new PayoutRequest(
                        UUID.randomUUID(), UUID.randomUUID(), Money.of(new BigDecimal("850.00"), "AZN"), "card", "payout-1")))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("#352");
        assertThatThrownBy(() -> payriff.beginPayoutCardRegistration(
                        new PayoutCardRequest(UUID.randomUUID(), null, null, null, null)))
                .isInstanceOf(UnsupportedOperationException.class);
        assertThat(payriff.capabilities().supportsStoredCardCollection()).isFalse();
        assertThat(payriff.capabilities().partialRefund()).isTrue();
        assertThat(payriff.capabilities().supports("AZN")).isTrue();
    }

    @Test
    @DisplayName("naming PAYRIFF without a key, or with an http callback, is a start-up failure; the key is never printed")
    void configurationIsCheckedAtStartUp() {
        assertThatThrownBy(() -> new PayriffPaymentProvider(
                        RestClient.builder(), properties(new PaymentProperties.Payriff(BASE, "", CALLBACK, "az")), JSON))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new PayriffPaymentProvider(
                        RestClient.builder(),
                        properties(new PaymentProperties.Payriff(BASE, SECRET, "http://api.ideanest.test/hook", "az")),
                        JSON))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("https");

        assertThat(new PaymentProperties.Payriff(BASE, SECRET, CALLBACK, "az").toString())
                .doesNotContain(SECRET)
                .contains("<redacted>");
        assertThat(PaymentProperties.Payriff.defaults().baseUrl()).isEqualTo("https://api.payriff.com/api/v3");
    }

    // ------------------------------------------------------------------

    /** One adapter bound to one mock server. */
    private static final class Wire {
        private final RestClient.Builder builder = RestClient.builder();
        private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        private PayriffPaymentProvider adapter;

        ResponseActions expect(HttpMethod verb, String path) {
            return server.expect(requestTo(BASE + path)).andExpect(method(verb));
        }

        PayriffPaymentProvider adapter() {
            if (adapter == null) {
                adapter = PayriffPaymentProvider.over(
                        builder, properties(new PaymentProperties.Payriff(BASE, SECRET, CALLBACK, "az")), JSON);
            }
            return adapter;
        }

        void verify() {
            server.verify();
        }
    }

    private static PaymentProperties properties(PaymentProperties.Payriff payriff) {
        return new PaymentProperties(
                new PaymentProperties.Provider("PAYRIFF"), null, null, null, null, null, null, payriff);
    }

    private static PaymentLookup lookUp(String status) {
        Wire wire = new Wire();
        wire.expect(HttpMethod.GET, "/orders/ord-1")
                .andRespond(withSuccess(
                        APPROVED_ORDER.replace("\"paymentStatus\":\"APPROVED\"", "\"paymentStatus\":\"" + status + "\""),
                        MediaType.APPLICATION_JSON));
        return wire.adapter().lookUpPayment("ord-1");
    }

    private static HostedPaymentRequest payment() {
        return new HostedPaymentRequest(
                UUID.randomUUID(), Money.of(new BigDecimal("20.50"), "AZN"), null, null, null, null, "key-1");
    }

    private static RefundRequest refund(String amount) {
        return new RefundRequest(
                UUID.randomUUID(), "ord-1", Money.of(new BigDecimal(amount), "AZN"), "campaign_unsuccessful", "refund-key-1");
    }

    private static byte[] bytes(String body) {
        return body.getBytes(StandardCharsets.UTF_8);
    }
}
