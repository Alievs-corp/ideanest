package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.payment.application.PaymentProviderStatus;
import az.ideanest.payment.application.PaymentProviders;
import az.ideanest.payment.application.ProviderCircuitBreaker;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PayoutRequest;
import az.ideanest.payment.domain.PayoutResult;
import az.ideanest.payment.domain.ProviderCapabilities;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.shared.observability.ProviderStatusSource.ProviderStatus;
import az.ideanest.support.AdjustableClock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The circuit breaker as its callers feed it (#470): what counts, what resets, and what the
 * health screen then says.
 *
 * <p>A plain unit test. {@code HostedPaymentApiTests} shows an open breaker refusing a payment
 * page end to end.
 */
class ProviderCircuitBreakerTests {

    private static final ProviderName PAYRIFF = ProviderName.PAYRIFF;
    private static final int THRESHOLD = 3;

    private final AdjustableClock clock = new AdjustableClock();
    private final PaymentProperties properties = properties();
    private final ProviderCircuitBreaker breaker = new ProviderCircuitBreaker(properties, clock);

    @Test
    @DisplayName("an unreachable provider is counted on every call, rethrown, and opens the breaker at the threshold")
    void unreachableCallsOpenTheBreaker() {
        for (int call = 1; call < THRESHOLD; call++) {
            assertThatThrownBy(() -> breaker.call(PAYRIFF, unreachable()))
                    .isInstanceOf(ProviderUnavailableException.class);
            assertThat(breaker.isAvailable(PAYRIFF)).as("after %d failures", call).isTrue();
        }

        assertThatThrownBy(() -> breaker.call(PAYRIFF, unreachable())).isInstanceOf(ProviderUnavailableException.class);

        assertThat(breaker.isAvailable(PAYRIFF)).isFalse();
        assertThat(breaker.isAvailable(ProviderName.EPOINT)).as("one provider down says nothing of another").isTrue();
    }

    @Test
    @DisplayName("an answer resets the count, and a decline is an answer")
    void anAnswerResetsTheCount() {
        for (int call = 1; call < THRESHOLD; call++) {
            assertThatThrownBy(() -> breaker.call(PAYRIFF, unreachable()));
        }
        RefundResult declined = breaker.call(PAYRIFF, () -> new RefundResult(
                ProviderOutcome.DECLINED, null, "insufficient_funds", "Declined", "{}"));
        assertThat(declined.outcome()).isEqualTo(ProviderOutcome.DECLINED);

        for (int call = 1; call < THRESHOLD; call++) {
            assertThatThrownBy(() -> breaker.call(PAYRIFF, unreachable()));
        }
        assertThat(breaker.isAvailable(PAYRIFF)).as("the decline started the count again").isTrue();

        breaker.call(PAYRIFF, () -> "approved");
        for (int call = 1; call < THRESHOLD; call++) {
            assertThatThrownBy(() -> breaker.call(PAYRIFF, unreachable()));
        }
        assertThat(breaker.isAvailable(PAYRIFF)).isTrue();
    }

    @Test
    @DisplayName("a call the provider does not offer is not an outage")
    void anUnsupportedCallIsNotCounted() {
        for (int call = 0; call < THRESHOLD; call++) {
            assertThatThrownBy(() -> breaker.call(PAYRIFF, () -> {
                        throw new UnsupportedOperationException("no hosted pages");
                    }))
                    .isInstanceOf(UnsupportedOperationException.class);
        }

        assertThat(breaker.isAvailable(PAYRIFF)).isTrue();
    }

    @Test
    @DisplayName("the breaker closes once the cooldown has passed, and the next outage opens it again")
    void theBreakerClosesAfterTheCooldown() {
        clock.freeze();
        open();

        clock.advance(Duration.ofSeconds(59));
        assertThat(breaker.isAvailable(PAYRIFF)).isFalse();

        clock.advance(Duration.ofSeconds(2));
        assertThat(breaker.isAvailable(PAYRIFF)).isTrue();

        open();
        assertThat(breaker.isAvailable(PAYRIFF)).isFalse();
    }

    @Test
    @DisplayName("the health screen reports a provider whose breaker is open as unavailable, and says why")
    void theHealthScreenReportsAnOpenBreaker() {
        PaymentProviderStatus status = new PaymentProviderStatus(
                new PaymentProviders(List.of(new FakeProvider(PAYRIFF)), properties), breaker);
        assertThat(payriff(status).available()).isTrue();

        open();

        ProviderStatus reported = payriff(status);
        assertThat(reported.configured()).isTrue();
        assertThat(reported.available()).isFalse();
        assertThat(reported.detail()).contains("circuit breaker");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private void open() {
        for (int call = 0; call < THRESHOLD; call++) {
            assertThatThrownBy(() -> breaker.call(PAYRIFF, unreachable()));
        }
    }

    private static Supplier<Object> unreachable() {
        return () -> {
            throw new ProviderUnavailableException(PAYRIFF, "connection refused");
        };
    }

    private static ProviderStatus payriff(PaymentProviderStatus status) {
        return status.providerStatuses().stream()
                .filter(provider -> provider.name().equals(PAYRIFF.name()))
                .findFirst()
                .orElseThrow();
    }

    private static PaymentProperties properties() {
        return new PaymentProperties(
                new PaymentProperties.Provider("payriff"),
                new PaymentProperties.CircuitBreaker(THRESHOLD, Duration.ofMinutes(1)),
                null,
                null,
                null,
                null,
                null,
                null);
    }

    /** Registered and never asked: the breaker is fed by the calls above, not by this. */
    private record FakeProvider(ProviderName name) implements PaymentProvider {

        @Override
        public RefundResult refund(RefundRequest request) {
            throw new UnsupportedOperationException();
        }

        @Override
        public PayoutResult payout(PayoutRequest request) {
            throw new UnsupportedOperationException();
        }

        @Override
        public PaymentEvent parseWebhook(byte[] rawBody, Map<String, String> headers) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ProviderCapabilities capabilities() {
            return new ProviderCapabilities(false, true, Set.of(), Set.of("AZN"));
        }
    }
}
