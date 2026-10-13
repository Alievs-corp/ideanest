package az.ideanest.payment.application;

import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.SubscriptionCharge;
import az.ideanest.payment.infrastructure.SubscriptionChargeRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Settles a creator plan paid on the provider's page — issue #449.
 *
 * <p>Beside {@link HostedChargeEvents}, which settles pledges: both see every charge event, and each
 * acts only on pages it opened. Nothing is posted to the ledger. A plan's price is the platform's
 * revenue, not money held for a creator, and its record is {@code subscription_payments}, which
 * {@link SubscriptionChargeSettlement} writes in this transaction.
 *
 * <p><strong>Exactly once.</strong> The page is read under a row lock, so the callback and the sweep
 * settling it at the same moment are serialised and the second finds it settled.
 */
@Component
public class SubscriptionChargeEvents implements PaymentEventHandler {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionChargeEvents.class);

    private final SubscriptionChargeRepository charges;
    private final SubscriptionChargeSettlement subscriptions;
    private final Clock clock;

    public SubscriptionChargeEvents(
            SubscriptionChargeRepository charges, SubscriptionChargeSettlement subscriptions, Clock clock) {
        this.charges = charges;
        this.subscriptions = subscriptions;
        this.clock = clock;
    }

    @Override
    public Set<PaymentEventType> handles() {
        return Set.of(PaymentEventType.CHARGE_SUCCEEDED, PaymentEventType.CHARGE_FAILED);
    }

    @Override
    public Optional<String> handle(PaymentEvent event) {
        String reference = event.providerTransactionId();
        if (reference == null || reference.isBlank()) {
            return Optional.empty();
        }
        Optional<SubscriptionCharge> found = charges.lockByOrder(event.provider(), reference);
        if (found.isEmpty()) {
            return Optional.empty();
        }
        SubscriptionCharge charge = found.get();
        if (!charge.isPending()) {
            return Optional.of("plan payment " + reference + " is already settled");
        }

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (event.type() == PaymentEventType.CHARGE_FAILED) {
            charge.failed(now, event.rawBody());
            charges.save(charge);
            log.info("Plan payment {} for subscription {} failed.", reference, charge.getSubscriptionId());
            return Optional.of("plan payment " + reference + " failed");
        }

        SubscriptionChargeSettlement.Outcome outcome = subscriptions.paid(new SubscriptionChargeSettlement.PaidSubscriptionCharge(
                charge.getId(),
                charge.getSubscriptionId(),
                charge.getAccountId(),
                charge.getAmount(),
                charge.getProvider().name(),
                reference,
                now));
        if (outcome == SubscriptionChargeSettlement.Outcome.UNAPPLIED) {
            charge.unapplied(now, event.rawBody());
            charges.save(charge);
            log.error(
                    "Plan payment {} was paid for subscription {}, which has ended; return it from /admin/refunds.",
                    reference,
                    charge.getSubscriptionId());
            return Optional.of("plan payment " + reference + " succeeded for a subscription that has ended");
        }
        charge.paid(now, event.rawBody());
        charges.save(charge);
        log.info("Plan payment {} {} subscription {}.",
                reference, outcome == SubscriptionChargeSettlement.Outcome.ACTIVATED ? "activated" : "renewed",
                charge.getSubscriptionId());
        return Optional.of("subscription " + charge.getSubscriptionId() + " "
                + (outcome == SubscriptionChargeSettlement.Outcome.ACTIVATED ? "activated" : "renewed"));
    }
}
