package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.payment.application.PaymentProviders;
import az.ideanest.payment.domain.ChargeResult;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentProvider;
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
import az.ideanest.payment.domain.UnknownProviderException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * §9.3's requirements, refused at start-up rather than at a campaign's close (#61).
 *
 * <p>{@code ProviderCapabilities} argues why the check is where it is: the first charge
 * happens at the close of a funded campaign, in front of every backer who has just been
 * told it succeeded, and discovering a missing capability then is discovering it in
 * front of everybody. These are the four ways the registry can refuse, and the two ways
 * it must not.
 *
 * <p>A plain unit test. The registry is a constructor and a map; starting a container to
 * assert on one would make the suite slower for no coverage.
 */
class ProviderRegistryTests {

    @Test
    @DisplayName("no provider configured is the shipped state, and it is not an error")
    void noProviderIsTheShippedState() {
        // #60 has not been answered and §9.2 refuses a stub, so a deployed environment
        // has an empty registry. It must start: the platform still serves every other
        // request, and CollectionRun refusing on this answer is the single gate that
        // keeps the collection machinery inert.
        PaymentProviders providers = new PaymentProviders(List.of(), properties(""));

        assertThat(providers.primary()).isEmpty();
        assertThat(providers.registered()).isEmpty();
    }

    @Test
    @DisplayName("IDN-EXT-01: an adapter that cannot collect stored cards registers, and is never the collecting one")
    void anAdapterThatCannotCollectRegistersButDoesNotCollect() {
        // The charge-now model (#38): Epoint charges at confirmation and cannot do R-02 and R-03.
        // It is the primary, and CollectionRun -- which asks collecting() -- must not start.
        PaymentProvider epoint = new FakeProvider(ProviderName.EPOINT, capabilities(true, false, false));

        PaymentProviders providers = new PaymentProviders(List.of(epoint), properties("epoint"));

        assertThat(providers.primary()).containsSame(epoint);
        assertThat(providers.collecting()).isEmpty();
    }

    @Test
    @DisplayName("what is missing names every capability, not just the first")
    void everyMissingCapabilityIsNamed() {
        assertThat(String.join(", ", capabilities(false, false, false).missing()))
                .contains("R-01")
                .contains("R-02")
                .contains("R-03");
    }

    @Test
    @DisplayName("a configured provider with no adapter is a start-up failure, not a warning")
    void aMissingAdapterIsAStartUpFailure() {
        // The configuration mistake that is otherwise discovered on the one day it must
        // not be: a deployment that thinks it can collect and cannot.
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
        PaymentProvider first = new FakeProvider(ProviderName.PAYRIFF, capabilities(true, true, true));
        PaymentProvider second = new FakeProvider(ProviderName.PAYRIFF, capabilities(true, true, true));

        assertThatThrownBy(() -> new PaymentProviders(List.of(first, second), properties("")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PAYRIFF");
    }

    @Test
    @DisplayName("a capable adapter is registered and resolvable by name as well as as the primary")
    void aCapableAdapterIsRegistered() {
        PaymentProvider payriff = new FakeProvider(ProviderName.PAYRIFF, capabilities(true, true, true));
        PaymentProvider epoint = new FakeProvider(ProviderName.EPOINT, capabilities(true, true, true));

        PaymentProviders providers = new PaymentProviders(List.of(payriff, epoint), properties("PAYRIFF"));

        assertThat(providers.primary()).containsSame(payriff);
        assertThat(providers.collecting()).containsSame(payriff);
        assertThat(providers.registered()).containsExactlyInAnyOrder(ProviderName.PAYRIFF, ProviderName.EPOINT);
        // byName and not primary(): #66's webhooks must still verify deliveries about
        // charges made through a provider the platform has stopped charging with.
        assertThat(providers.byName(ProviderName.EPOINT)).containsSame(epoint);
    }

    @Test
    @DisplayName("the configured name is matched however it was capitalised")
    void theConfiguredNameIsCaseInsensitive() {
        PaymentProvider payriff = new FakeProvider(ProviderName.PAYRIFF, capabilities(true, true, true));

        assertThat(new PaymentProviders(List.of(payriff), properties(" payriff ")).primary())
                .containsSame(payriff);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static PaymentProperties properties(String primary) {
        return new PaymentProperties(new PaymentProperties.Provider(primary), null, null, null, null, null, null);
    }

    private static ProviderCapabilities capabilities(
            boolean cardOnFile, boolean merchantInitiated, boolean schemeChaining) {
        return new ProviderCapabilities(
                cardOnFile, merchantInitiated, 7, schemeChaining, false, true, Set.of(), Set.of("AZN"));
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
        public TokenizationSession beginTokenization(TokenizationRequest request) {
            throw new UnsupportedOperationException();
        }

        @Override
        public TokenizationResult resolveTokenization(String sessionId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ChargeResult chargeStoredCard(StoredCardChargeRequest request) {
            throw new UnsupportedOperationException();
        }

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
