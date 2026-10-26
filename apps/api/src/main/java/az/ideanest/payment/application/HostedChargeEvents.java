package az.ideanest.payment.application;

import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.payment.domain.ChargeResult;
import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.TransactionStatus;
import az.ideanest.payment.domain.TransactionType;
import az.ideanest.payment.infrastructure.DuplicateChargeRepository;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.pledge.application.PaidPledge;
import az.ideanest.pledge.application.PledgePayments;
import az.ideanest.pledge.application.PledgeRaiseService;
import az.ideanest.pledge.application.RaiseSettlement;
import az.ideanest.project.application.CampaignCollections;
import az.ideanest.project.application.CollectingCampaign;
import az.ideanest.shared.outbox.Outbox;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Settles a payment made on the provider's page — IDN-EXT-01 (#39).
 *
 * <p>On {@code CHARGE_SUCCEEDED}, in the webhook's transaction and in this order: a
 * {@code SUCCEEDED} charge row, the ledger posting (escrow to the creator, as a collection at close
 * posted it, and the provider's fee out of escrow: {@link ProviderFees}), the pledge collected and counted towards its campaign, and {@code pledge.collected}.
 * On {@code CHARGE_FAILED}, a {@code FAILED} row and nothing else: the draft keeps its places until
 * its hold ends, and the backer may try again.
 *
 * <p><strong>Exactly once, twice over.</strong> A redelivered event is refused by the webhook
 * table before this runs; a different delivery about the same payment finds its settled row here
 * and does nothing — and V41's settled index would refuse a second one anyway.
 *
 * <p>A delivery about a charge this handler did not open — a stored-card collection, or an unknown
 * transaction — is recorded as handled with a note saying so, and moves nothing.
 *
 * <p><strong>A raise is paid on the same page (#171).</strong> The charge row, the ledger posting and
 * the order are the same; what differs is what the money is for, and the pending row's idempotency key
 * says which — a raise derives its key from itself. A paid raise is handed to
 * {@link PledgeRaiseService#recordPaid}, which applies it and counts the difference, or records it as
 * owing the charge back when it can no longer be applied; a failed one to
 * {@link PledgeRaiseService#recordFailed}, which gives its held places back. {@code pledge.collected}
 * is not recorded for a raise: the pledge was collected once, and the raise announces itself as
 * {@code pledge.edited}.
 *
 * <p><strong>The provider's amount is checked, not trusted and not ignored (#587).</strong> The money
 * credited is the pending row's, as always — but when the provider says how much was paid, and in what
 * currency, it must say the same as the page was opened for. A different figure is a provider fault or
 * an order that is not what the platform thinks it is; it is recorded {@code FAILED} with
 * {@code amount_mismatch}, collects nothing, and is logged at ERROR and counted
 * ({@link HostedChargeMetrics#amountMismatch}) for a person to settle with the provider.
 *
 * <p><strong>A second payment for one pledge is returned (#587).</strong> Two pages opened for one draft
 * can both be paid. The first collects the pledge; the second is posted like any payment — the money did
 * arrive — and recorded in {@code duplicate_charges}, which the campaign-refunds job reads to return it in
 * full as {@code DUPLICATE_CHARGE}, and which keeps it out of every payout. Logged at ERROR and counted
 * ({@link HostedChargeMetrics#duplicate}), because it means a page was opened that should not have been.
 */
@Component
public class HostedChargeEvents implements PaymentEventHandler {

    private static final Logger log = LoggerFactory.getLogger(HostedChargeEvents.class);

    private final PaymentTransactionRepository transactions;
    private final CampaignCollections campaigns;
    private final Ledger ledger;
    private final PledgePayments pledges;
    private final PledgeRaiseService raises;
    private final Outbox outbox;
    private final ProviderFees providerFees;
    private final DuplicateChargeRepository duplicates;
    private final HostedChargeMetrics metrics;
    private final Clock clock;

    public HostedChargeEvents(
            PaymentTransactionRepository transactions,
            CampaignCollections campaigns,
            Ledger ledger,
            PledgePayments pledges,
            PledgeRaiseService raises,
            Outbox outbox,
            ProviderFees providerFees,
            DuplicateChargeRepository duplicates,
            HostedChargeMetrics metrics,
            Clock clock) {
        this.transactions = transactions;
        this.campaigns = campaigns;
        this.ledger = ledger;
        this.pledges = pledges;
        this.raises = raises;
        this.outbox = outbox;
        this.providerFees = providerFees;
        this.duplicates = duplicates;
        this.metrics = metrics;
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
        boolean raise = raises.isRaiseCharge(pending.getIdempotencyKey());

        if (event.type() == PaymentEventType.CHARGE_FAILED) {
            fail(pending, raise, "payment_failed", "The provider reported the payment failed.", event.rawBody(), now);
            log.info("Payment {} for pledge {} failed.", reference, pending.getPledgeId());
            return Optional.of("payment " + reference + " failed");
        }
        if (event.amount() != null && !event.amount().equals(pending.getAmount())) {
            fail(pending,
                    raise,
                    "amount_mismatch",
                    "The provider reported %s paid for a page opened for %s.".formatted(event.amount(), pending.getAmount()),
                    event.rawBody(),
                    now);
            metrics.amountMismatch();
            log.error(
                    "Payment {} for pledge {} was reported paid as {}, and the page was opened for {}: recorded failed"
                            + " and nothing collected. Settle it with {} by hand.",
                    reference,
                    pending.getPledgeId(),
                    event.amount(),
                    pending.getAmount(),
                    pending.getProvider());
            return Optional.of("payment " + reference + " reported a different amount; recorded failed");
        }

        PaymentTransaction settled = transactions.save(PaymentTransaction.charge(
                pending.getPledgeId(),
                pending.getProjectId(),
                pending.getAmount(),
                pending.getProvider(),
                new ChargeResult(ProviderOutcome.APPROVED, reference, null, null, event.rawBody()),
                1,
                pending.getIdempotencyKey(),
                // #436: the terms of the page the backer was sent to pay on, recorded when it was opened —
                // not the setting at the moment the provider's answer arrives.
                pending.isProviderFeeWithheldOnRefund()));

        CollectingCampaign campaign = campaigns
                .describe(pending.getProjectId())
                .orElseThrow(() -> new IllegalStateException(
                        "Payment " + reference + " names campaign " + pending.getProjectId() + ", which is gone"));
        ledger.post(providerFees.chargePosting(
                settled.getId(),
                campaign.projectId(),
                LedgerAccount.creator(campaign.creatorId()),
                pending.getProvider(),
                pending.getAmount()));

        if (raise) {
            RaiseSettlement settlement = raises.recordPaid(pending.getIdempotencyKey(), now);
            log.info(
                    "Payment {} settled raise {} of pledge {}: {} (transaction {}).",
                    reference,
                    settlement.raiseId(),
                    pending.getPledgeId(),
                    settlement.outcome(),
                    settled.getId());
            return Optional.of(switch (settlement.outcome()) {
                case APPLIED -> "pledge " + pending.getPledgeId() + " raised";
                // The money is in and posted, and the raise could not take it: the campaign-refunds job
                // returns the charge (RAISE_NOT_APPLIED).
                case UNAPPLIED -> "payment " + reference + " succeeded for a raise that can no longer be applied";
                case ALREADY_SETTLED -> "raise for payment " + reference + " is already settled";
                case UNKNOWN -> "no raise is paid for by " + reference;
            });
        }

        Optional<PaidPledge> paid = pledges.recordPaid(pending.getPledgeId(), now);
        if (paid.isEmpty()) {
            if (paidBefore(pending.getPledgeId(), settled.getId())) {
                // #587: a second payment for a pledge already paid for. Posted, because the money did arrive;
                // recorded, so the campaign-refunds job returns it and no payout counts it.
                duplicates.record(settled.getId(), pending.getPledgeId(), now);
                metrics.duplicate();
                log.error(
                        "Payment {} paid for pledge {} a second time (transaction {}); it is returned as"
                                + " DUPLICATE_CHARGE by campaign-refunds.",
                        reference,
                        pending.getPledgeId(),
                        settled.getId());
                return Optional.of("payment " + reference + " paid for pledge " + pending.getPledgeId()
                        + " a second time; it is refunded");
            }
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

    /** A {@code FAILED} row for the page, and a raise's held places given back. Nothing else moves. */
    private void fail(PaymentTransaction pending, boolean raise, String code, String message, String raw, Instant now) {
        transactions.save(PaymentTransaction.charge(
                pending.getPledgeId(),
                pending.getProjectId(),
                pending.getAmount(),
                pending.getProvider(),
                new ChargeResult(ProviderOutcome.DECLINED, pending.getProviderTransactionId(), code, message, raw),
                1,
                pending.getIdempotencyKey(),
                pending.isProviderFeeWithheldOnRefund()));
        if (raise) {
            raises.recordFailed(pending.getIdempotencyKey(), now);
        }
    }

    /**
     * Whether the pledge was paid for by a charge other than this one — not a raise, which is a payment of
     * its own on a pledge already collected, but the draft's payment itself.
     */
    private boolean paidBefore(UUID pledgeId, UUID thisCharge) {
        return transactions.settledChargesOf(pledgeId).stream()
                .anyMatch(charge -> !charge.getId().equals(thisCharge) && !raises.isRaiseCharge(charge.getIdempotencyKey()));
    }
}
