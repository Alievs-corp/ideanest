package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderWebhookEvent;
import az.ideanest.payment.domain.WebhookVerificationException;
import az.ideanest.payment.infrastructure.ProviderWebhookEventRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * §9.3's R-07 and §17.2: verify a provider's delivery, refuse a replay, and act on it
 * exactly once (#66).
 *
 * <h2>The three controls, and what each of them is for</h2>
 *
 * <ul>
 *   <li><strong>The signature</strong> makes the body ours to trust, and it is the
 *       adapter's — {@code PaymentProvider#parseWebhook} — because it is expressed in the
 *       provider's own header format. Verification and parsing are one call there
 *       precisely so that nothing in this class can hold an unverified
 *       {@link PaymentEvent}: the only thing that produces one is the method that checks.
 *   <li><strong>The timestamp</strong> stops a validly signed body being replayed later.
 *       A signature does not expire — that is what a signature is — so this window is the
 *       only thing that does. It is checked here rather than in the adapter because the
 *       tolerance is a platform policy and not a provider's format.
 *   <li><strong>The identifier</strong> stops the same event being acted on twice, and it
 *       is the only one of the three that survives a restart: signature and timestamp both
 *       pass on a genuine redelivery. V43's unique index is the enforcement.
 * </ul>
 *
 * <h2>The delivery and its effect are one commit</h2>
 *
 * <p>V43 argues this at length and it is the whole shape of the class. There is no
 * {@code PENDING} row and no queue: the handler runs inside the transaction that writes
 * the row recording the delivery, so either both happened or neither did. A handler
 * that throws leaves no row, the response is a 500, and every provider in §9.3 retries a
 * delivery it did not get a 2xx for — which is why the platform needs no retry of its
 * own here and why it must not fake one by committing the row first.
 *
 * <h2>A concurrent redelivery is a 500, deliberately</h2>
 *
 * <p>Nothing catches the integrity violation V43's unique index raises when two
 * deliveries of one event arrive at the same instant and this one loses. The
 * transaction rolls back, the response is a 500, and the provider retries — at which
 * point the {@code exists} read answers it without doing anything. Catching it to
 * return a 200 would be answering for work another transaction has not finished.
 *
 * <h2>What is deliberately not here</h2>
 *
 * <p>No handler ships. See {@link PaymentEventHandler} for why that is the finished
 * state of #66 rather than half of it: verifying, deduplicating and dispatching is the
 * issue, and what a settled refund or a lost chargeback <em>means</em> belongs to #67
 * and #68, in the modules that own those outcomes.
 */
@Service
public class ProviderWebhooks {

    private static final Logger log = LoggerFactory.getLogger(ProviderWebhooks.class);

    private final PaymentProviders providers;
    private final ProviderWebhookEventRepository deliveries;
    private final Map<PaymentEventType, List<PaymentEventHandler>> handlers =
            new EnumMap<>(PaymentEventType.class);
    private final Duration tolerance;
    private final Clock clock;
    private final TransactionTemplate transaction;

    public ProviderWebhooks(
            PaymentProviders providers,
            ProviderWebhookEventRepository deliveries,
            List<PaymentEventHandler> discovered,
            PaymentProperties properties,
            Clock clock,
            PlatformTransactionManager transactions) {
        this.providers = providers;
        this.deliveries = deliveries;
        this.tolerance = properties.webhooks().tolerance();
        this.clock = clock;
        this.transaction = new TransactionTemplate(transactions);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);

        for (PaymentEventHandler handler : discovered) {
            for (PaymentEventType type : handler.handles()) {
                handlers.computeIfAbsent(type, ignored -> new ArrayList<>()).add(handler);
            }
        }
    }

    /**
     * Verifies, deduplicates and processes one delivery.
     *
     * <p>A new transaction rather than the caller's, so that the boundary is stated rather
     * than inherited: the transaction has to be exactly the delivery and its effect, and a
     * caller that already had one open would silently widen it.
     *
     * <p><strong>The adapter verifies before the transaction opens</strong> (#351). Payriff
     * signs nothing, so its adapter verifies a delivery by asking Payriff about the order; an
     * unauthenticated request that held a database connection for the length of a call to
     * another service could empty the pool. Verification touches no table, so nothing is
     * lost by doing it first.
     *
     * @param providerSlug the {@code {provider}} path segment, however it was capitalised
     * @param rawBody the request body exactly as it arrived. <strong>Bytes</strong>: a
     *     signature is over the bytes, and a body that has been through a JSON parser and
     *     back is a different sequence of them
     * @param headers the request's headers, lower-cased by the caller
     * @return what was done with it
     * @throws az.ideanest.payment.domain.UnknownProviderException when the path names no
     *     provider in §9.3's list
     * @throws UnconfiguredProviderException when it names one that has no adapter
     * @throws WebhookVerificationException when the signature does not verify, the body
     *     cannot be read, or the timestamp is outside the tolerance
     */
    public WebhookReceipt receive(String providerSlug, byte[] rawBody, Map<String, String> headers) {
        ProviderName name = ProviderName.of(providerSlug);

        // byName rather than primary(): after a provider change the platform still has to
        // verify deliveries about charges made through the old one, and answering those
        // from the primary would check a Payriff signature with Epoint's key.
        PaymentProvider provider =
                providers.byName(name).orElseThrow(() -> new UnconfiguredProviderException(name));

        PaymentEvent event = provider.parseWebhook(rawBody, headers);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        refuseReplay(event, now);

        return transaction.execute(status -> record(name, event, now));
    }

    private WebhookReceipt record(ProviderName name, PaymentEvent event, Instant now) {
        // Not the deduplication -- V43's unique index is -- but the answer for the
        // ordinary redelivery, which arrives seconds later rather than concurrently. It
        // keeps that case from provoking a constraint violation and a rolled back
        // transaction for something that is not an error.
        if (deliveries.existsByProviderAndProviderEventId(name, event.providerEventId())) {
            log.debug("Delivery {} from {} has already been handled.", event.providerEventId(), name);
            return WebhookReceipt.DUPLICATE;
        }

        return process(event, now);
    }

    /**
     * §17.2's "timestamp check against replay".
     *
     * <p>Both directions. Too old is the attack — a captured request replayed an hour
     * later — and too far in the future is a clock somewhere that cannot be reasoned
     * about, which would make the "too old" half meaningless by moving the goalposts.
     *
     * <p>An event whose format carries no timestamp is <strong>accepted</strong>, and
     * that is a real gap rather than an oversight to be discovered later: without one the
     * platform's only protection against replay is the deduplication, which is enough to
     * make a replay harmless — the second delivery does nothing — but not enough to stop
     * one being accepted. Whether a chosen provider signs a timestamp is §9.3's R-07
     * question, and the day one is chosen without it, this is the paragraph that says
     * what was given up.
     */
    private void refuseReplay(PaymentEvent event, Instant now) {
        Instant signedAt = event.signedAt();
        if (signedAt == null) {
            return;
        }
        Duration drift = Duration.between(signedAt, now).abs();
        if (drift.compareTo(tolerance) > 0) {
            // The message says which way and by how much, because the overwhelmingly
            // likely cause is a clock rather than an attack -- and it is not returned to
            // the sender, for WebhookVerificationException's reason about oracles.
            throw new WebhookVerificationException(
                    event.provider(),
                    "Delivery %s was signed at %s, which is %s from now and outside the %s tolerance"
                            .formatted(event.providerEventId(), signedAt, drift, tolerance));
        }
    }

    private WebhookReceipt process(PaymentEvent event, Instant now) {
        List<PaymentEventHandler> forType = handlers.getOrDefault(event.type(), List.of());
        if (forType.isEmpty()) {
            deliveries.save(ProviderWebhookEvent.ignored(event, now));
            log.debug("Delivery {} from {} is a {} nothing handles.", event.providerEventId(), event.provider(), event.type());
            return WebhookReceipt.IGNORED;
        }

        StringBuilder outcome = new StringBuilder();
        for (PaymentEventHandler handler : forType) {
            // Not caught. A handler that fails must take the delivery row with it, so the
            // provider retries -- see the class comment.
            Optional<String> said = handler.handle(event);
            said.ifPresent(line -> outcome.append(outcome.isEmpty() ? "" : "; ").append(line));
        }

        deliveries.save(ProviderWebhookEvent.processed(event, outcome.toString(), now));
        log.info("Handled delivery {} from {}: {}.", event.providerEventId(), event.provider(), event.type());
        return WebhookReceipt.PROCESSED;
    }
}
