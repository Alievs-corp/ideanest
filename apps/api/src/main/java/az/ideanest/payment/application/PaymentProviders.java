package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.ProviderName;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Every adapter on the classpath, checked against §9.3 and indexed by name (#61).
 *
 * <p>Three jobs, and each of them is a failure this class exists to prevent.
 *
 * <ol>
 *   <li><strong>It refuses an adapter that cannot do R-01, R-02 and R-03, at
 *       start-up.</strong> {@link ProviderCapabilities} argues why the check is here
 *       rather than at the first charge: the first charge is at a campaign's close, in
 *       front of every backer who has just been told the campaign succeeded.
 *   <li><strong>It resolves the configured primary once.</strong> A deployment naming a
 *       provider with no adapter is a start-up failure, because a deployment that thinks
 *       it can collect and cannot is discovered on exactly the wrong day.
 *   <li><strong>It answers "is there a provider at all".</strong> There is not — see
 *       below — and {@code CollectionRun} refusing on that answer is the single gate
 *       that keeps every piece of collection machinery inert until #60 is answered.
 * </ol>
 *
 * <h2>The registry is empty in every deployed environment today</h2>
 *
 * <p>{@link PaymentProvider} has no implementations: #60 has not chosen a provider, and
 * §9.2 is explicit that a stub returning approvals "would be worse than nothing".
 * Spring therefore injects an empty list here, {@link #primary()} is empty, and every
 * collection pass logs once and does nothing. That is the correct behaviour and not a
 * degraded one — the alternative to collecting nothing is not collecting something, it
 * is charging cards through an adapter nobody has written.
 *
 * <p>Tests register their own {@link PaymentProvider} bean, which is how the whole of
 * #64, #65 and #66 is exercised without a provider being chosen.
 */
@Component
public class PaymentProviders {

    private static final Logger log = LoggerFactory.getLogger(PaymentProviders.class);

    private final Map<ProviderName, PaymentProvider> adapters = new EnumMap<>(ProviderName.class);
    private final PaymentProvider primary;

    public PaymentProviders(List<PaymentProvider> discovered, PaymentProperties properties) {
        for (PaymentProvider adapter : discovered) {
            // IDN-EXT-01 (#38): an adapter that cannot collect stored cards is no longer refused.
            // The platform charges when a pledge is confirmed, and stored-card collection at close
            // is retired by #39 — so R-01 to R-03 decide only whether collecting() hands the
            // adapter to CollectionRun, which is checked there rather than as a start-up failure.
            PaymentProvider clash = adapters.put(adapter.name(), adapter);
            if (clash != null) {
                // Two adapters for one provider is not a merge to resolve: `provider` is
                // half of two uniqueness rules, and the platform would be charging through
                // whichever bean Spring happened to order first.
                throw new IllegalStateException("Two adapters claim to be " + adapter.name());
            }
        }

        this.primary = resolvePrimary(properties);

        if (primary == null) {
            log.info(
                    "No payment provider is configured; nothing will be collected. "
                            + "#60 chooses one and §9.2 says why no stub ships in the meantime.");
        } else if (primary.capabilities().supportsStoredCardCollection()) {
            log.info("Charging and collecting through {}.", primary.name());
        } else {
            log.info(
                    "Charging through {}; it cannot do {}, so the retired stored-card collection stays inert.",
                    primary.name(),
                    String.join(", ", primary.capabilities().missing()));
        }
    }

    /**
     * The adapter the platform charges through, or empty when there is none.
     *
     * <p>Empty is the shipped state. Every caller treats it as "do not collect", never as
     * "collect through something else".
     */
    public Optional<PaymentProvider> primary() {
        return Optional.ofNullable(primary);
    }

    /**
     * The primary, when it can collect stored cards — the one {@code CollectionRun} may use.
     *
     * <p>Empty for a primary that cannot do R-01, R-02 and R-03, which is Epoint's case: under
     * IDN-EXT-01 the pledge is charged at confirmation, and the collection at close is retired
     * (#39) and must not start merely because a provider is configured.
     */
    public Optional<PaymentProvider> collecting() {
        return primary().filter(provider -> provider.capabilities().supportsStoredCardCollection());
    }

    /**
     * The adapter for a named provider, whichever one it is.
     *
     * <p>Not the same question as {@link #primary()}, and the difference matters for
     * #66's webhooks: a delivery arrives at {@code /v1/webhooks/psp/{provider}} naming
     * the provider that sent it, and after a provider change the platform still has to
     * verify and process deliveries about charges made through the old one. Answering
     * those from {@code primary()} would verify a Payriff signature with Epoint's key.
     */
    public Optional<PaymentProvider> byName(ProviderName name) {
        return Optional.ofNullable(adapters.get(name));
    }

    /** Which providers have an adapter. For the health endpoint and for start-up logging. */
    public Set<ProviderName> registered() {
        return Set.copyOf(adapters.keySet());
    }

    /**
     * §9.3's vocabulary, published as strings for the modules that may not name the enum —
     * part of issue #432.
     *
     * <p>{@code ProviderName} is {@code payment.domain} and {@code ModuleBoundaryTests}
     * forbids another module from reaching into it. The compliance module nonetheless has to
     * store which provider issued a creator's payout token, and a column whose values nothing
     * validates is a column that eventually holds "Epoint " with a trailing space.
     *
     * <p>So the vocabulary crosses as a string and the check stays here, which is the same
     * answer #236 arrived at for the project module's capability enum: publish the question,
     * not the type. A boolean would have been enough for validation and is not enough for
     * storage — the caller needs the canonical spelling, because a token filed as "epoint" and
     * a payout sent through "EPOINT" is a comparison that fails on nothing.
     *
     * <p><strong>Not the same question as {@link #registered()}.</strong> That one is which
     * providers have an adapter, and the answer is currently none. This is which names are
     * legitimate, which is a fact about §9.3's table rather than about this deployment: a
     * creator may file an Epoint destination before the Epoint adapter exists, and the payout
     * refuses at send because no provider is configured rather than because the name was
     * wrong.
     *
     * @return the constant's own spelling, or empty when nothing matches
     */
    public static Optional<String> canonicalNameOf(String provider) {
        if (provider == null) {
            return Optional.empty();
        }
        String trimmed = provider.trim();
        for (ProviderName candidate : ProviderName.values()) {
            if (candidate.name().equalsIgnoreCase(trimmed)) {
                return Optional.of(candidate.name());
            }
        }
        return Optional.empty();
    }

    private PaymentProvider resolvePrimary(PaymentProperties properties) {
        if (!properties.provider().isConfigured()) {
            return null;
        }
        // Throws UnknownProviderException on a name that is not in §9.3's list, and the
        // IllegalStateException below on a name that is but has no adapter. Both are
        // start-up failures: see the class comment.
        ProviderName name = ProviderName.of(properties.provider().primary());
        PaymentProvider adapter = adapters.get(name);
        if (adapter == null) {
            throw new IllegalStateException(
                    "ideanest.payment.provider.primary names %s, and no adapter for it is on the classpath"
                            .formatted(name));
        }
        return adapter;
    }
}
