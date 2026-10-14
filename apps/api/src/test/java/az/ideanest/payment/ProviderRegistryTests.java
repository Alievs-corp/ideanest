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
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.domain.UnknownProviderException;
import az.ideanest.shared.observability.ProviderStatusSource;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The provider registry (#61): what it refuses at start-up, and what it must not.
 *
 * <p>A misconfigured deployment is refused when it starts rather than when the first backer
 * tries to pay. Until #45 the registry also judged §9.3's R-01 to R-03 for the stored-card
 * collection at close; that collection is gone, and so is the judgement.
 *
 * <p>A plain unit test. The registry is a constructor and a map; starting a container to
 * assert on one would make the suite slower for no coverage.
 */
class ProviderRegistryTests {

    @Test
    @DisplayName("no provider configured is the shipped state, and it is not an error")
    void noProviderIsTheShippedState() {
        // An environment that names no provider must start: the platform still serves
        // every other request, and takes no payments.
        PaymentProviders providers = new PaymentProviders(List.of(), properties(""));

        assertThat(providers.primary()).isEmpty();
        assertThat(providers.registered()).isEmpty();
    }

    @Test
    @DisplayName("a configured provider with no adapter is a start-up failure, not a warning")
    void aMissingAdapterIsAStartUpFailure() {
        // The configuration mistake that is otherwise discovered by a backer: a
        // deployment that thinks it can take payments and cannot.
        assertThatThrownBy(() -> new PaymentProviders(List.of(), properties("payriff")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PAYRIFF");
    }

    @Test
    @DisplayName("a configured name that is not a provider at all is refused")
    void anUnknownNameIsRefused() {
        assertThatThrownBy(() -> new PaymentProviders(List.of(), properties("stripe")))
                .isInstanceOf(UnknownProviderException.class);
    }

    @Test
    @DisplayName("two adapters claiming one provider is refused")
    void twoAdaptersForOneProviderAreRefused() {
        // `provider` is half of two uniqueness rules -- transactions and webhook
        // deliveries -- so the platform would be charging through whichever bean Spring
        // happened to order first, and nothing would say which.
        PaymentProvider first = new FakeProvider(ProviderName.PAYRIFF, capabilities());
        PaymentProvider second = new FakeProvider(ProviderName.PAYRIFF, capabilities());

        assertThatThrownBy(() -> new PaymentProviders(List.of(first, second), properties("")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PAYRIFF");
    }

    @Test
    @DisplayName("an adapter is registered and resolvable by name as well as as the primary")
    void anAdapterIsRegistered() {
        PaymentProvider payriff = new FakeProvider(ProviderName.PAYRIFF, capabilities());
        PaymentProvider epoint = new FakeProvider(ProviderName.EPOINT, capabilities());

        PaymentProviders providers = new PaymentProviders(List.of(payriff, epoint), properties("PAYRIFF"));

        assertThat(providers.primary()).containsSame(payriff);
        assertThat(providers.registered()).containsExactlyInAnyOrder(ProviderName.PAYRIFF, ProviderName.EPOINT);
        // byName and not primary(): #66's webhooks must still verify deliveries about
        // charges made through a provider the platform has stopped charging with.
        assertThat(providers.byName(ProviderName.EPOINT)).containsSame(epoint);
    }

    @Test
    @DisplayName("the configured name is matched however it was capitalised")
    void theConfiguredNameIsCaseInsensitive() {
        PaymentProvider payriff = new FakeProvider(ProviderName.PAYRIFF, capabilities());

        assertThat(new PaymentProviders(List.of(payriff), properties(" payriff ")).primary())
                .containsSame(payriff);
    }

    @Test
    @DisplayName("#394: bank transfer cannot be configured as the provider the platform charges through")
    void theBankTransferIsNotAPrimary() {
        // It names money moved by a person from IdeyaNest's own account. A deployment naming it
        // as the primary would have nothing to charge through, and must not start believing it
        // does.
        assertThatThrownBy(() -> new PaymentProviders(List.of(), properties("bank_transfer")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("BANK_TRANSFER")
                .hasMessageContaining("not a payment provider");
    }

    @Test
    @DisplayName("#394: no adapter may claim to be the bank transfer")
    void noAdapterClaimsTheBankTransfer() {
        PaymentProvider impostor = new FakeProvider(ProviderName.BANK_TRANSFER, capabilities());

        assertThatThrownBy(() -> new PaymentProviders(List.of(impostor), properties("")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("BANK_TRANSFER");
    }

    @Test
    @DisplayName("#394: the bank transfer is never resolved by name, nor published as a token's issuer")
    void theBankTransferIsNeverResolved() {
        PaymentProvider payriff = new FakeProvider(ProviderName.PAYRIFF, capabilities());
        PaymentProviders providers = new PaymentProviders(List.of(payriff), properties("payriff"));

        assertThat(ProviderName.BANK_TRANSFER.isAdapter()).isFalse();
        assertThat(providers.byName(ProviderName.BANK_TRANSFER)).isEmpty();
        assertThat(providers.registered()).doesNotContain(ProviderName.BANK_TRANSFER);
        // The token PUT validates its provider through this, so a token "issued by" the bank
        // cannot be filed: a bank account is filed with its IBAN, sealed, at its own endpoint.
        assertThat(PaymentProviders.canonicalNameOf("BANK_TRANSFER")).isEmpty();
        assertThat(PaymentProviders.canonicalNameOf("payriff")).contains("PAYRIFF");
        // Every other name is still an adapter's.
        for (ProviderName name : ProviderName.values()) {
            assertThat(name.isAdapter()).isEqualTo(name != ProviderName.BANK_TRANSFER);
        }
    }

    @Test
    @DisplayName("#394: the health screen does not list the bank transfer as a provider that is down")
    void theHealthScreenDoesNotListTheBankTransfer() {
        PaymentProvider payriff = new FakeProvider(ProviderName.PAYRIFF, capabilities());
        PaymentProperties properties = properties("payriff");
        PaymentProviderStatus status = new PaymentProviderStatus(
                new PaymentProviders(List.of(payriff), properties),
                new ProviderCircuitBreaker(properties, Clock.systemUTC()));

        assertThat(status.providerStatuses())
                .extracting(ProviderStatusSource.ProviderStatus::name)
                .contains("PAYRIFF", "EPOINT", "AZERICARD")
                .doesNotContain("BANK_TRANSFER");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static PaymentProperties properties(String primary) {
        return new PaymentProperties(new PaymentProperties.Provider(primary), null, null, null, null, null, null, null);
    }

    private static ProviderCapabilities capabilities() {
        return new ProviderCapabilities(false, true, Set.of(), Set.of("AZN"));
    }

    /**
     * An adapter that answers nothing.
     *
     * <p>Only {@link #name()} and {@link #capabilities()} are reachable from the registry,
     * and the rest throw rather than returning a plausible value — so a future change that
     * made the registry call one of them fails loudly here instead of quietly registering
     * an adapter on the strength of an answer nobody wrote.
     */
    private record FakeProvider(ProviderName name, ProviderCapabilities capabilities) implements PaymentProvider {

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
    }
}
