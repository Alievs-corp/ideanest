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
 * Every adapter on the classpath, indexed by name (#61).
 *
 * <p>Two jobs, and each of them is a failure this class exists to prevent.
 *
 * <ol>
 *   <li><strong>It resolves the configured primary once.</strong> A deployment naming a
 *       provider with no adapter is a start-up failure, because a deployment that thinks
 *       it can take payments and cannot is discovered on exactly the wrong day.
 *   <li><strong>It answers "is there a provider at all".</strong> An environment that names
 *       none takes no payments: {@link #primary()} is empty, and every caller treats that as
 *       a refusal rather than as a reason to charge through something else.
 * </ol>
 *
 * <p>Until #45 it also refused, and later only sidelined, an adapter that could not do §9.3's
 * R-01 to R-03 — the stored-card collection at close those three served is gone with
 * IDN-EXT-01, so every adapter is registered on the same terms.
 */
@Component
public class PaymentProviders {

    private static final Logger log = LoggerFactory.getLogger(PaymentProviders.class);

    private final Map<ProviderName, PaymentProvider> adapters = new EnumMap<>(ProviderName.class);
    private final PaymentProvider primary;

    public PaymentProviders(List<PaymentProvider> discovered, PaymentProperties properties) {
        for (PaymentProvider adapter : discovered) {
            if (!adapter.name().isAdapter()) {
                // #394: BANK_TRANSFER is staff moving money by hand, and a bean claiming it
                // would be something calling itself the bank.
                throw new IllegalStateException(adapter.name() + " is not a provider an adapter can claim");
            }
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
            log.info("No payment provider is configured; no payment will be taken.");
        } else {
            log.info("Charging through {}.", primary.name());
        }
    }

    /**
     * The adapter the platform charges through, or empty when there is none.
     *
     * <p>Every caller treats empty as "do not charge", never as "charge through something
     * else".
     */
    public Optional<PaymentProvider> primary() {
        return Optional.ofNullable(primary);
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
        if (name == null || !name.isAdapter()) {
            return Optional.empty();
        }
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
     * providers have an adapter in this deployment. This is which names are
     * legitimate, which is a fact about §9.3's table rather than about this deployment: a
     * creator may file an Epoint destination before the Epoint adapter exists, and the payout
     * refuses at send because no provider is configured rather than because the name was
     * wrong.
     *
     * <p><strong>{@code BANK_TRANSFER} is not published here</strong> (#394). It issues no
     * token, so a destination naming it through this route would be a bank account with no
     * account number. A creator's IBAN is filed through its own endpoint, which seals it.
     *
     * @return the constant's own spelling, or empty when nothing matches or the name is not a
     *     provider an adapter can exist for
     */
    public static Optional<String> canonicalNameOf(String provider) {
        if (provider == null) {
            return Optional.empty();
        }
        String trimmed = provider.trim();
        for (ProviderName candidate : ProviderName.values()) {
            if (candidate.isAdapter() && candidate.name().equalsIgnoreCase(trimmed)) {
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
        if (!name.isAdapter()) {
            throw new IllegalStateException(
                    "ideanest.payment.provider.primary names %s, which is not a payment provider".formatted(name));
        }
        PaymentProvider adapter = adapters.get(name);
        if (adapter == null) {
            throw new IllegalStateException(
                    "ideanest.payment.provider.primary names %s, and no adapter for it is on the classpath"
                            .formatted(name));
        }
        return adapter;
    }
}
