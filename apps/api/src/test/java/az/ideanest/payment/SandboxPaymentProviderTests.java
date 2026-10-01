package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import az.ideanest.payment.api.SandboxPayoutCardController;
import az.ideanest.payment.application.NoPayoutProviderException;
import az.ideanest.payment.application.ProviderWebhooks;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PayoutCardRequest;
import az.ideanest.payment.domain.PayoutCardSession;
import az.ideanest.payment.domain.PayoutRequest;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.WebhookVerificationException;
import az.ideanest.payment.infrastructure.SandboxPaymentProvider;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * The local sandbox provider and its card page — issue #243.
 *
 * <p>Unit tests rather than an integration suite: the integration suites share one context with
 * the scripted provider as the primary, and a second context that named SANDBOX would split that
 * cache for one temporary adapter. What reaches the database after the webhook is the path
 * {@code PayoutCardRegistrationApiTests} already covers.
 */
@DisplayName("The local sandbox payment provider (#243)")
class SandboxPaymentProviderTests {

    private static final ObjectMapper JSON = JsonMapper.builder().build();
    private static final URI SUCCESS = URI.create("http://localhost:3000/ru/settings/payout?card=returned");
    private static final URI ERROR = URI.create("http://localhost:3000/ru/settings/payout?card=failed");

    private SandboxPaymentProvider sandbox;

    @BeforeEach
    void start() {
        sandbox = new SandboxPaymentProvider(profiles("local"), JSON);
    }

    private static MockEnvironment profiles(String... active) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(active);
        return environment;
    }

    private PayoutCardSession begin() {
        return sandbox.beginPayoutCardRegistration(
                new PayoutCardRequest(UUID.randomUUID(), "IdeyaNest payout card", "ru", SUCCESS, ERROR));
    }

    @Nested
    @DisplayName("where it may run")
    class WhereItRuns {

        @Test
        @DisplayName("refuses to start under any profile but local or test")
        void refusesOutsideLocal() {
            assertThatThrownBy(() -> new SandboxPaymentProvider(profiles("prod"), JSON))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("local or test");
            assertThatThrownBy(() -> new SandboxPaymentProvider(profiles(), JSON))
                    .isInstanceOf(IllegalStateException.class);
        }

        @Test
        @DisplayName("starts under test")
        void startsUnderTest() {
            assertThat(new SandboxPaymentProvider(profiles("test"), JSON).name().name()).isEqualTo("SANDBOX");
        }
    }

    @Nested
    @DisplayName("registering a card")
    class Registering {

        @Test
        @DisplayName("opens its page on the creator's own origin, under the API path the web proxy forwards")
        void opensOnTheSameOrigin() {
            PayoutCardSession session = begin();

            assertThat(session.cardId()).startsWith("sandbox-");
            assertThat(session.redirectUrl().toString())
                    .isEqualTo("http://localhost:3000/v1/sandbox/payout-cards/" + session.cardId());
            assertThat(sandbox.pendingFor(session.cardId())).isPresent();
        }

        @Test
        @DisplayName("a card page over plain http is accepted on loopback and nowhere else")
        void httpOnlyOnLoopback() {
            assertThat(new PayoutCardSession("c", URI.create("http://localhost:3000/v1/x")).redirectUrl())
                    .isNotNull();
            assertThat(new PayoutCardSession("c", URI.create("http://127.0.0.1:3000/v1/x")).redirectUrl())
                    .isNotNull();
            assertThatThrownBy(() -> new PayoutCardSession("c", URI.create("http://ideanest.az/v1/x")))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> new PayoutCardSession("c", URI.create("http://localhost.evil.az/v1/x")))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        @DisplayName("a registered card arrives as the event Epoint's callback produces, with the holder's name")
        void aRegisteredCard() {
            String card = begin().cardId();
            SandboxPaymentProvider.Delivery delivery = sandbox.deliveryFor(card, true, "  Leyla Səfərova ");

            PaymentEvent event = sandbox.parseWebhook(delivery.body(), delivery.headers());

            assertThat(event.type()).isEqualTo(PaymentEventType.PAYOUT_CARD_REGISTERED);
            assertThat(event.payoutCard().cardId()).isEqualTo(card);
            assertThat(event.payoutCard().holderName()).isEqualTo("Leyla Səfərova");
            assertThat(event.payoutCard().cardMask()).startsWith("400000******");
            // The holder's name travels on the event and not in the stored body, as Epoint's does.
            assertThat(event.rawBody()).doesNotContain("Leyla");
            // Settled: the page is gone and a second delivery is refused.
            assertThat(sandbox.pendingFor(card)).isEmpty();
        }

        @Test
        @DisplayName("a declined card arrives as a failed registration")
        void aDeclinedCard() {
            String card = begin().cardId();
            SandboxPaymentProvider.Delivery delivery = sandbox.deliveryFor(card, false, "ignored");

            PaymentEvent event = sandbox.parseWebhook(delivery.body(), delivery.headers());

            assertThat(event.type()).isEqualTo(PaymentEventType.PAYOUT_CARD_FAILED);
            assertThat(event.payoutCard().holderName()).isNull();
        }
    }

    @Nested
    @DisplayName("who may deliver")
    class WhoMayDeliver {

        @Test
        @DisplayName("a delivery without this instance's secret is refused, as a forged callback is")
        void withoutTheSecret() {
            String card = begin().cardId();
            byte[] body = sandbox.deliveryFor(card, true, null).body();

            assertThatThrownBy(() -> sandbox.parseWebhook(body, Map.of()))
                    .isInstanceOf(WebhookVerificationException.class);
            assertThatThrownBy(() -> sandbox.parseWebhook(body, Map.of("x-sandbox-secret", "guess")))
                    .isInstanceOf(WebhookVerificationException.class);
            // A refused delivery settles nothing.
            assertThat(sandbox.pendingFor(card)).isPresent();
        }

        @Test
        @DisplayName("a delivery about a card this instance never began is refused")
        void anUnknownCard() {
            SandboxPaymentProvider.Delivery delivery = sandbox.deliveryFor("sandbox-made-up", true, null);

            assertThatThrownBy(() -> sandbox.parseWebhook(delivery.body(), delivery.headers()))
                    .isInstanceOf(WebhookVerificationException.class);
        }

        @Test
        @DisplayName("a body that is not JSON is refused")
        void notJson() {
            SandboxPaymentProvider.Delivery delivery = sandbox.deliveryFor(begin().cardId(), true, null);

            assertThatThrownBy(() ->
                            sandbox.parseWebhook("not json".getBytes(StandardCharsets.UTF_8), delivery.headers()))
                    .isInstanceOf(WebhookVerificationException.class);
        }
    }

    @Nested
    @DisplayName("money")
    class Money {

        @Test
        @DisplayName("a payout is refused exactly as it is with no provider configured")
        void sendsNothing() {
            assertThatThrownBy(() -> sandbox.payout(mock(PayoutRequest.class)))
                    .isInstanceOf(NoPayoutProviderException.class);
        }

        @Test
        @DisplayName("charges and refunds are refused rather than approved")
        void approvesNothing() {
            assertThatThrownBy(() -> sandbox.refund(mock(RefundRequest.class)))
                    .isInstanceOf(UnsupportedOperationException.class);
            assertThatThrownBy(() -> sandbox.chargeStoredCard(null)).isInstanceOf(UnsupportedOperationException.class);
            assertThatThrownBy(() -> sandbox.beginHostedPayment(null)).isInstanceOf(UnsupportedOperationException.class);
            assertThat(sandbox.capabilities().supportsStoredCardCollection()).isFalse();
        }
    }

    @Nested
    @DisplayName("the card page")
    class ThePage {

        private ProviderWebhooks webhooks;
        private SandboxPayoutCardController page;

        @BeforeEach
        void wire() {
            webhooks = mock(ProviderWebhooks.class);
            page = new SandboxPayoutCardController(sandbox, webhooks);
        }

        @Test
        @DisplayName("draws a form that posts back to itself for a card that was begun")
        void drawsTheForm() {
            String card = begin().cardId();

            ResponseEntity<String> drawn = page.page(card);

            assertThat(drawn.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(drawn.getBody())
                    .contains("action=\"/v1/sandbox/payout-cards/" + card + "\"")
                    .contains("value=\"register\"")
                    .contains("value=\"decline\"");
        }

        @Test
        @DisplayName("answers 404 for a card nobody began, and escapes what it was given")
        void unknownCard() {
            ResponseEntity<String> drawn = page.page("<script>");

            assertThat(drawn.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
            assertThat(drawn.getBody()).doesNotContain("<script>");
            verifyNoInteractions(webhooks);
        }

        @Test
        @DisplayName("registering delivers the webhook and sends the creator back to the success page")
        void registering() {
            String card = begin().cardId();

            ResponseEntity<String> answer = page.finish(card, "register", "Leyla Səfərova");

            assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.SEE_OTHER);
            assertThat(answer.getHeaders().getLocation()).isEqualTo(SUCCESS);
            verify(webhooks).receive(eq("sandbox"), any(byte[].class), any());
        }

        @Test
        @DisplayName("declining delivers a failure and sends the creator back to the error page")
        void declining() {
            String card = begin().cardId();

            ResponseEntity<String> answer = page.finish(card, "decline", null);

            assertThat(answer.getHeaders().getLocation()).isEqualTo(ERROR);
            verify(webhooks).receive(eq("sandbox"), any(byte[].class), any());
        }

        @Test
        @DisplayName("a finished or unknown card delivers nothing")
        void nothingToFinish() {
            ResponseEntity<String> answer = page.finish("sandbox-made-up", "register", null);

            assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
            verify(webhooks, never()).receive(any(), any(), any());
        }
    }
}
