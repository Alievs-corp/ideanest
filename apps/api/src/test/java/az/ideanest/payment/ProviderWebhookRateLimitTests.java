package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.payment.api.ProviderWebhookController;
import az.ideanest.payment.application.ProviderWebhooks;
import az.ideanest.payment.application.WebhookReceipt;
import az.ideanest.shared.ratelimit.InMemoryRateLimiter;
import az.ideanest.shared.ratelimit.RateLimitExceededException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletWebRequest;

/**
 * #587: {@code POST /v1/webhooks/psp/{provider}} is public, and an unsigned callback costs a call to
 * the provider — so it is budgeted per source address and for the endpoint as a whole.
 *
 * <p><strong>Not an integration test</strong>, for {@code CommentRateLimitTests}' reason: the suite
 * shares one limiter and every request in it comes from {@code 127.0.0.1}, so the test profile sets
 * these budgets out of reach and the real numbers are asserted here, against the controller itself.
 */
class ProviderWebhookRateLimitTests {

    private static final Clock FIXED = Clock.fixed(Instant.parse("2026-10-26T12:00:00Z"), ZoneOffset.UTC);

    private static final PaymentProperties.Webhooks DEFAULTS = PaymentProperties.Webhooks.defaults();

    private ProviderWebhookController endpoint;
    private Counting webhooks;

    @BeforeEach
    void buildTheEndpoint() {
        webhooks = new Counting();
        endpoint = new ProviderWebhookController(
                webhooks,
                null,
                new InMemoryRateLimiter(FIXED),
                new PaymentProperties(null, null, null, null, null, null, null, null));
    }

    @AfterEach
    void unbindTheRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    @DisplayName("one address is refused past its budget, and the refused delivery reaches nothing")
    void oneAddressIsBounded() {
        for (int delivery = 0; delivery < DEFAULTS.perAddress(); delivery++) {
            assertThatCode(() -> deliverFrom("198.51.100.7")).doesNotThrowAnyException();
        }
        int handled = webhooks.received.get();

        assertThatThrownBy(() -> deliverFrom("198.51.100.7")).isInstanceOf(RateLimitExceededException.class);
        assertThat(webhooks.received.get()).as("not verified, and the provider not asked").isEqualTo(handled);

        // A provider delivering from another address is not held up by somebody else's flood.
        assertThatCode(() -> deliverFrom("203.0.113.9")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("the endpoint as a whole is bounded, which a sender spread over many addresses cannot get round")
    void theEndpointIsBounded() {
        for (int delivery = 0; delivery < DEFAULTS.overall(); delivery++) {
            String address = "10.0." + (delivery / 250) + "." + (delivery % 250 + 1);
            assertThatCode(() -> deliverFrom(address)).doesNotThrowAnyException();
        }

        assertThatThrownBy(() -> deliverFrom("192.0.2.200")).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("the budgets a deployment configures none of are the defaults, not unlimited")
    void theDefaultsAreNotUnlimited() {
        PaymentProperties.Webhooks unset = new PaymentProperties.Webhooks(null, 0, 0, null);

        assertThat(unset.perAddress()).isEqualTo(DEFAULTS.perAddress()).isPositive();
        assertThat(unset.overall()).isEqualTo(DEFAULTS.overall()).isGreaterThan(DEFAULTS.perAddress());
        assertThat(unset.window()).isEqualTo(DEFAULTS.window());
    }

    private void deliverFrom(String address) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v1/webhooks/psp/payriff");
        request.setRemoteAddr(address);
        RequestContextHolder.setRequestAttributes(new ServletWebRequest(request, new MockHttpServletResponse()));
        assertThat(endpoint.receive("payriff", "{}".getBytes(StandardCharsets.UTF_8), request).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    /**
     * Ingestion that records nothing and counts what reached it. The limiter is what is tested, so the
     * work behind it is replaced rather than mocked; its collaborators are null and none is reachable.
     */
    private static final class Counting extends ProviderWebhooks {

        private final AtomicInteger received = new AtomicInteger();

        private Counting() {
            super(null, null, List.of(), new PaymentProperties(null, null, null, null, null, null, null, null), FIXED,
                    null, null, null, null);
        }

        @Override
        public WebhookReceipt receive(String providerSlug, byte[] rawBody, Map<String, String> headers) {
            received.incrementAndGet();
            return WebhookReceipt.PROCESSED;
        }
    }
}
