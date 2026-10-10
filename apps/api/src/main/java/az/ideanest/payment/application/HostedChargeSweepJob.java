package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.infrastructure.HostedChargeCheckRepository;
import az.ideanest.payment.infrastructure.HostedChargeCheckRepository.State;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.shared.jobs.ScheduledJob;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@code hosted-charge-sweep} — #353: settles a payment page whose callback never came.
 *
 * <p>A page is settled only by the provider's callback ({@link HostedChargeEvents}). A callback lost
 * for good — the provider gave up retrying, a maintenance window outlasted its retries, a callback
 * address was wrong — would leave a backer who paid with a pledge that never confirms. This pass asks
 * the provider about every page still pending after {@code answered-after}, and settles what it says
 * through the same handler the callback reaches, so the two paths cannot disagree about what a
 * payment means.
 *
 * <ul>
 *   <li><strong>The provider is asked outside any transaction</strong>, for #351's reason: a
 *       connection is not held across a call to another service.
 *   <li><strong>Each page is settled in its own transaction.</strong> A callback arriving at the same
 *       moment is the race V41's settled index decides: the loser rolls back, ledger posting and all,
 *       and the payment is counted once.
 *   <li><strong>Paid and already returned</strong> is not settled either way. The money came and went
 *       without the platform hearing of it, and which way the pledge should go is a person's
 *       decision: logged at ERROR, left pending.
 *   <li><strong>Pending, or not answered</strong>, goes to the back of the queue
 *       ({@code hosted_charge_checks}) and is asked again on a later pass, until {@code asked-for}
 *       after it was opened. A page abandoned unpaid stays pending at some providers for ever.
 * </ul>
 */
@Component
public class HostedChargeSweepJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(HostedChargeSweepJob.class);

    private final PaymentTransactionRepository transactions;
    private final HostedChargeCheckRepository checks;
    private final PaymentProviders providers;
    private final HostedChargeEvents settlement;
    private final PaymentProperties.HostedCharges properties;
    private final TransactionTemplate transaction;
    private final Clock clock;

    public HostedChargeSweepJob(
            PaymentTransactionRepository transactions,
            HostedChargeCheckRepository checks,
            PaymentProviders providers,
            HostedChargeEvents settlement,
            PaymentProperties properties,
            PlatformTransactionManager transactionManager,
            Clock clock) {
        this.transactions = transactions;
        this.checks = checks;
        this.providers = providers;
        this.settlement = settlement;
        this.properties = properties.hostedCharges();
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.clock = clock;
    }

    /** Paused while a maintenance window is in force (#214): it posts to the ledger. */
    @Override
    public boolean pausesDuringMaintenance() {
        return true;
    }

    @Override
    public String name() {
        return "hosted-charge-sweep";
    }

    @Override
    public String schedule() {
        return properties.schedule();
    }

    @Override
    public void run() {
        sweep(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /** @return how many pages this pass settled, paid or failed */
    public int sweep(Instant now) {
        List<PaymentTransaction> unsettled = transactions.unsettledHostedCharges(
                now.minus(properties.askedFor()), now.minus(properties.answeredAfter()), properties.perPass());
        int settled = 0;
        for (PaymentTransaction pending : unsettled) {
            try {
                if (settle(pending, now)) {
                    settled++;
                }
            } catch (RuntimeException e) {
                log.error(
                        "hosted-charge-sweep: could not settle payment {}; the next pass asks again.",
                        pending.getProviderTransactionId(),
                        e);
                checks.checked(pending.getId(), now, State.UNANSWERED);
            }
        }
        if (settled > 0) {
            log.warn(
                    "hosted-charge-sweep: settled {} of {} payment pages whose callback never came.",
                    settled,
                    unsettled.size());
        }
        return settled;
    }

    private boolean settle(PaymentTransaction pending, Instant now) {
        String reference = pending.getProviderTransactionId();
        Optional<PaymentProvider> provider = providers.byName(pending.getProvider());
        if (provider.isEmpty()) {
            log.info("hosted-charge-sweep: payment {} was taken through {}, which has no adapter here.",
                    reference, pending.getProvider());
            checks.checked(pending.getId(), now, State.UNANSWERED);
            return false;
        }

        PaymentLookup lookup;
        try {
            lookup = provider.get().lookUpPayment(reference);
        } catch (UnsupportedOperationException | ProviderUnavailableException e) {
            log.info("hosted-charge-sweep: payment {} stays pending: {}", reference, e.getMessage());
            checks.checked(pending.getId(), now, State.UNANSWERED);
            return false;
        }

        PaymentEventType type = switch (lookup.state()) {
            case SUCCEEDED -> PaymentEventType.CHARGE_SUCCEEDED;
            case FAILED -> PaymentEventType.CHARGE_FAILED;
            case PENDING -> null;
            case RETURNED -> {
                log.error(
                        "hosted-charge-sweep: payment {} for pledge {} was paid and returned without a callback;"
                                + " a person decides the pledge.",
                        reference,
                        pending.getPledgeId());
                yield null;
            }
        };
        if (type == null) {
            checks.checked(pending.getId(), now, State.valueOf(lookup.state().name()));
            return false;
        }

        String raw = lookup.rawResponse() == null || lookup.rawResponse().isBlank()
                ? "{\"lookup\":\"" + lookup.state() + "\"}"
                : lookup.rawResponse();
        PaymentEvent answered = new PaymentEvent(
                pending.getProvider(),
                "sweep:" + reference + ":" + lookup.state(),
                type,
                reference,
                null,
                null,
                raw);
        Optional<String> outcome;
        try {
            outcome = transaction.execute(status -> settlement.handle(answered));
        } catch (DataIntegrityViolationException e) {
            // The callback arrived at the same moment and settled it first.
            log.info("hosted-charge-sweep: payment {} was settled by its callback meanwhile.", reference);
            checks.checked(pending.getId(), now, State.valueOf(lookup.state().name()));
            return false;
        }
        checks.checked(pending.getId(), now, State.valueOf(lookup.state().name()));
        log.info("hosted-charge-sweep: {}.", outcome.orElse("payment " + reference + " settled"));
        return true;
    }
}
