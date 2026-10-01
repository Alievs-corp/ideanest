package az.ideanest.payment.application;

import az.ideanest.payment.domain.ProviderName;
import az.ideanest.shared.observability.ProviderStatusSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * The payment module's contribution to AD-16's screen — issue #316.
 *
 * <p>Beside the breaker it reads, which is the whole point of {@link ProviderStatusSource}:
 * the module that owns {@code ProviderName} and decides whether a provider is callable
 * answers the question, and the health screen never learns that either exists.
 *
 * <p><strong>Every provider is reported, configured or not.</strong> A deployment running
 * one adapter should see the other two as switched off rather than absent — absent reads as
 * "the platform has one provider", which is a different and wrong fact about §9.3.
 */
@Component
public class PaymentProviderStatus implements ProviderStatusSource {

    /** What the screen groups these under. Not the module name — see the interface. */
    private static final String KIND = "Payments";

    private final PaymentProviders providers;
    private final ProviderCircuitBreaker breaker;

    public PaymentProviderStatus(PaymentProviders providers, ProviderCircuitBreaker breaker) {
        this.providers = providers;
        this.breaker = breaker;
    }

    @Override
    public List<ProviderStatus> providerStatuses() {
        Set<ProviderName> registered = providers.registered();
        List<ProviderStatus> statuses = new ArrayList<>(ProviderName.values().length);

        for (ProviderName provider : ProviderName.values()) {
            boolean configured = registered.contains(provider);
            // #243's local sandbox is not a provider a deployment could configure, so a
            // deployment's health screen does not list it as one that is missing.
            if (provider == ProviderName.SANDBOX && !configured) {
                continue;
            }
            boolean available = configured && breaker.isAvailable(provider);

            statuses.add(new ProviderStatus(
                    KIND,
                    provider.name(),
                    configured,
                    available,
                    configured || available
                            ? (available ? null : "The circuit breaker has taken this provider out of service.")
                            : "No credentials are configured for this provider on this deployment."));
        }

        return statuses;
    }
}
