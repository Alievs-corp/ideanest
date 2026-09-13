package az.ideanest.payment.application;

import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.Posting;
import az.ideanest.payment.domain.ChargeResult;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.TransactionStatus;
import az.ideanest.payment.domain.TransactionType;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.pledge.application.PaidPledge;
import az.ideanest.pledge.application.PledgePayments;
import az.ideanest.project.application.CampaignCollections;
import az.ideanest.project.application.CollectingCampaign;
import az.ideanest.shared.outbox.Outbox;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Settles a payment made on the provider's page — IDN-EXT-01 (#39).
 *
 * <p>On {@code CHARGE_SUCCEEDED}, in the webhook's transaction and in this order: a
 * {@code SUCCEEDED} charge row, the ledger posting (escrow to the creator, as a collection at close
 * posted it), the pledge collected and counted towards its campaign, and {@code pledge.collected}.
 * On {@code CHARGE_FAILED}, a {@code FAILED} row and nothing else: the draft keeps its places until
 * its hold ends, and the backer may try again.
 *
 * <p><strong>Exactly once, twice over.</strong> A redelivered event is refused by the webhook
 * table before this runs; a different delivery about the same payment finds its settled row here
 * and does nothing — and V41's settled index would refuse a second one anyway.
 *
 * <p>A delivery about a charge this handler did not open — a stored-card collection, or an unknown
 * transaction — is recorded as handled with a note saying so, and moves nothing.
 */
@Component
public class HostedChargeEvents implements PaymentEventHandler {

    private static final Logger log = LoggerFactory.getLogger(HostedChargeEvents.class);

    private final PaymentTransactionRepository transactions;
    private final CampaignCollections campaigns;
    private final Ledger ledger;
    private final PledgePayments pledges;
    private final Outbox outbox;
    private final Clock clock;

    public HostedChargeEvents(
            PaymentTransactionRepository transactions,
            CampaignCollections campaigns,
            Ledger ledger,
            PledgePayments pledges,
            Outbox outbox,
            Clock clock) {
        this.transactions = transactions;
        this.campaigns = campaigns;
        this.ledger = ledger;
        this.pledges = pledges;
        this.outbox = outbox;
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
            return Optional.of("no provider transaction to settle");
        }
        Optional<PaymentTransaction> opened = transactions.findFirstByProviderAndProviderTransactionIdAndTypeAndStatus(
                event.provider(), reference, TransactionType.CHARGE, TransactionStatus.PENDING);
        if (opened.isEmpty()) {
            return Optional.of("no payment page opened " + reference);
        }
        if (transactions.existsByProviderAndProviderTransactionIdAndStatusIn(
                event.provider(), reference, List.of(TransactionStatus.SUCCEEDED, TransactionStatus.FAILED))) {
            return Optional.of("payment " + reference + " is already settled");
        }

        PaymentTransaction pending = opened.get();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        if (event.type() == PaymentEventType.CHARGE_FAILED) {
            transactions.save(PaymentTransaction.charge(
                    pending.getPledgeId(),
                    pending.getProjectId(),
                    pending.getAmount(),
                    pending.getProvider(),
                    new ChargeResult(
                            ProviderOutcome.DECLINED,
                            reference,
                            "payment_failed",
                            "The provider reported the payment failed.",
                            event.rawBody()),
                    1,
                    pending.getIdempotencyKey()));
            log.info("Payment {} for pledge {} failed.", reference, pending.getPledgeId());
            return Optional.of("payment " + reference + " failed");
        }

        PaymentTransaction settled = transactions.save(PaymentTransaction.charge(
                pending.getPledgeId(),
                pending.getProjectId(),
                pending.getAmount(),
                pending.getProvider(),
                new ChargeResult(ProviderOutcome.APPROVED, reference, null, null, event.rawBody()),
                1,
                pending.getIdempotencyKey()));

        CollectingCampaign campaign = campaigns
                .describe(pending.getProjectId())
                .orElseThrow(() -> new IllegalStateException(
                        "Payment " + reference + " names campaign " + pending.getProjectId() + ", which is gone"));
        ledger.post(Posting.of(settled.getId(), campaign.projectId())
                .debit(LedgerAccount.ESCROW, pending.getAmount())
                .credit(LedgerAccount.creator(campaign.creatorId()), pending.getAmount())
                .build());

        Optional<PaidPledge> paid = pledges.recordPaid(pending.getPledgeId(), now);
        if (paid.isEmpty()) {
            // The money is in and posted; the pledge could not take it. Logged by PledgePayments at
            // ERROR, and #40's refund is what returns it.
            return Optional.of("payment " + reference + " succeeded for a pledge that can no longer take it");
        }
        outbox.record(
                CollectionEvents.AGGREGATE_TYPE,
                pending.getPledgeId(),
                CollectionEvents.PledgeCollected.EVENT_TYPE,
                new CollectionEvents.PledgeCollected(
                        pending.getPledgeId(), pending.getProjectId(), paid.get().backerId(), pending.getAmount(), now));
        log.info("Payment {} collected pledge {} (transaction {}).", reference, pending.getPledgeId(), settled.getId());
        return Optional.of("pledge " + pending.getPledgeId() + " paid");
    }
}
