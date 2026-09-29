package az.ideanest.payment.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.Posting;
import az.ideanest.payment.domain.Dispute;
import az.ideanest.payment.domain.DisputeEvidence;
import az.ideanest.payment.domain.DisputeState;
import az.ideanest.payment.domain.EvidenceKind;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.infrastructure.DisputeEvidenceRepository;
import az.ideanest.payment.infrastructure.DisputeRepository;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.payment.infrastructure.RefundRepository;
import az.ideanest.pledge.application.PledgeRefunds;
import az.ideanest.project.application.CampaignCollections;
import az.ideanest.user.application.UserDirectory;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.money.Money;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Chargebacks — §4.11's AD-07, issues #68 and #308.
 *
 * <h2>Intake is idempotent because the provider is not</h2>
 *
 * <p>V43 establishes that a webhook is delivered more than once by design. {@link #notified}
 * therefore finds the existing case rather than opening a second, and V54's unique index on
 * {@code (provider, provider_dispute_id)} is what holds when two deliveries arrive at the
 * same moment. A duplicate case is worse than a missing one: two deadlines, two people
 * assembling evidence, and two answers sent to a network that asked once.
 *
 * <p>It also <strong>reopens a resolved case</strong> when the provider raises it again,
 * which is the cycle {@code DisputeState} describes and the reason nothing here asserts
 * that a dispute only moves forward.
 *
 * <h2>The money moves when the case is lost, not when it is opened</h2>
 *
 * <p>A notification is not a movement — the network has taken nothing yet, and a posting at
 * intake would put the platform's books out by every dispute it goes on to win. The ledger
 * is written on {@link DisputeState#LOST} and on {@link DisputeState#CONCEDED}, which are
 * the two outcomes where the money is actually gone.
 *
 * <p><strong>The fee is posted separately from the amount.</strong> They come off different
 * accounts because they are different facts: the disputed amount is a backer's money going
 * back, and the fee is the platform's cost of being asked. Netting them would hide the
 * second inside the first, and the second is the number that makes contesting worthwhile.
 *
 * <p><strong>A loss is also a refund row (#175).</strong> Every read that decides what of a charge
 * can still be refunded sums {@code refunds}; a loss recorded only as a transaction left the money
 * refundable, and a failed campaign or a member of staff paid the backer a second time.
 */
@Service
public class DisputeService {

    private static final Logger log = LoggerFactory.getLogger(DisputeService.class);

    private static final int PAGE_SIZE = 50;

    private final DisputeRepository disputes;
    private final DisputeEvidenceRepository evidence;
    private final PaymentTransactionRepository transactions;
    private final Ledger ledger;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;
    private final CampaignCollections campaigns;
    private final CreatorDebts creatorDebts;
    private final UserDirectory users;
    private final RefundRepository refunds;
    private final PledgeRefunds pledges;

    public DisputeService(
            DisputeRepository disputes,
            DisputeEvidenceRepository evidence,
            PaymentTransactionRepository transactions,
            Ledger ledger,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock,
            CampaignCollections campaigns,
            CreatorDebts creatorDebts,
            UserDirectory users,
            RefundRepository refunds,
            PledgeRefunds pledges) {
        this.disputes = disputes;
        this.evidence = evidence;
        this.transactions = transactions;
        this.ledger = ledger;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
        this.campaigns = campaigns;
        this.creatorDebts = creatorDebts;
        this.users = users;
        this.refunds = refunds;
        this.pledges = pledges;
    }

    /**
     * A provider has raised a dispute.
     *
     * <p>Called from the webhook path and not from a controller a person can reach. There
     * is no staff capability check here for that reason: the caller is the platform
     * itself, and requiring one would mean the webhook handler had to hold a staff
     * identity.
     */
    @Transactional
    public Dispute notified(
            ProviderName provider,
            String providerDisputeId,
            UUID chargeTransactionId,
            Money amount,
            Money fee,
            String reasonCode,
            Instant evidenceDueAt) {

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Optional<Dispute> existing = disputes.byProviderCase(provider, providerDisputeId);

        if (existing.isPresent()) {
            Dispute open = existing.get();
            if (open.state().isResolved()) {
                // A second presentment. The case is not new and is not finished either.
                open.reopened(now);
                log.info("Dispute {} reopened by {}", open.id(), provider);
            }
            return open;
        }

        PaymentTransaction charge = transactions
                .findById(chargeTransactionId)
                .orElseThrow(() -> new UnknownDisputeChargeException(chargeTransactionId));

        Dispute opened = disputes.save(Dispute.notified(
                chargeTransactionId,
                charge.getPledgeId(),
                charge.getProjectId(),
                provider,
                providerDisputeId,
                amount,
                fee,
                reasonCode,
                evidenceDueAt,
                now));

        log.info("Dispute {} opened by {} on charge {}", opened.id(), provider, chargeTransactionId);
        return opened;
    }

    /** AD-07's queue: unresolved, soonest deadline first. */
    @Transactional(readOnly = true)
    public List<Dispute> queue(UUID staffId, int page) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        return disputes.queue(PageRequest.of(Math.max(page, 0), PAGE_SIZE));
    }

    /** Every dispute, optionally narrowed to one state. */
    @Transactional(readOnly = true)
    public List<Dispute> list(UUID staffId, DisputeState state, int page) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        PageRequest request = PageRequest.of(Math.max(page, 0), PAGE_SIZE);

        return state == null ? disputes.page(request) : disputes.pageByState(state, request);
    }

    /** One case with its evidence. */
    @Transactional(readOnly = true)
    public DisputeCase inspect(UUID staffId, UUID disputeId) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        Dispute dispute = disputes.findById(disputeId).orElseThrow(() -> new DisputeNotFoundException(disputeId));

        return new DisputeCase(dispute, evidence.forDispute(disputeId));
    }

    /**
     * Adds a piece of evidence.
     *
     * <p>Assembled rather than sent: the piece has no {@code submittedAt} until
     * {@link #submit} sends the case. That separation is what lets a case be built over
     * several days by several people, which is how a representment is actually written.
     */
    @Transactional
    public DisputeEvidence addEvidence(
            UUID staffId, UUID disputeId, EvidenceKind kind, String description, UUID mediaId) {

        staff.requireCapability(staffId, StaffCapability.MANAGE_DISPUTES);
        Dispute dispute = disputes.findById(disputeId).orElseThrow(() -> new DisputeNotFoundException(disputeId));

        DisputeEvidence added =
                evidence.save(new DisputeEvidence(dispute.id(), kind, description, mediaId, staffId));

        audit.record(
                AuditAction.DISPUTE_HANDLED,
                dispute.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "evidenceAdded; kind=" + kind);

        return added;
    }

    /**
     * Sends everything assembled so far to the network.
     *
     * <p>The provider call is deliberately not made here. §9.3's interface has no evidence
     * submission on it — no adapter can send one — so what this does is mark the case as
     * answered and record who answered it, and the documents are sent through the
     * provider's own console until an adapter method exists. That is a real gap and it is
     * named rather than hidden: a method that pretended to submit would leave a case
     * marked {@code UNDER_REVIEW} that nobody had actually answered, and the deadline
     * would pass with the screen saying it was handled.
     *
     * @throws NothingToSubmitException when every piece has already been sent
     */
    @Transactional
    public Dispute submit(UUID staffId, UUID disputeId) {
        staff.requireCapability(staffId, StaffCapability.MANAGE_DISPUTES);
        Dispute dispute = disputes.findById(disputeId).orElseThrow(() -> new DisputeNotFoundException(disputeId));

        List<DisputeEvidence> unsent = evidence.unsentFor(disputeId);
        if (unsent.isEmpty()) {
            throw new NothingToSubmitException(disputeId);
        }

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        unsent.forEach(piece -> piece.submitted(null, now));
        dispute.submitted(staffId, now);

        audit.record(
                AuditAction.DISPUTE_HANDLED,
                dispute.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "evidenceSubmitted; pieces=" + unsent.size());

        log.info("Dispute {} answered with {} pieces by {}", disputeId, unsent.size(), staffId);
        return dispute;
    }

    /**
     * Records how it ended.
     *
     * <p>The ledger is written only for the two outcomes where money is gone. A won
     * dispute posts nothing, because nothing moved — the charge stood.
     *
     * @param outcome {@code WON}, {@code LOST} or {@code CONCEDED}
     * @throws IllegalArgumentException for a state that is not an outcome
     */
    @Transactional
    public Dispute resolve(UUID staffId, UUID disputeId, DisputeState outcome) {
        staff.requireCapability(staffId, StaffCapability.MANAGE_DISPUTES);
        Dispute dispute = disputes.findById(disputeId).orElseThrow(() -> new DisputeNotFoundException(disputeId));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        dispute.resolved(outcome, staffId, now);

        // A case resolved against the platform twice (LOST, then CONCEDED; or lost again after a reopening)
        // moved the money once: the second resolution posts nothing and recovers nothing (#175's review).
        if (outcome != DisputeState.WON && postLoss(dispute, staffId, now)) {
            recoverFromCreatorIfPaidOut(dispute, staffId, now);
        }

        audit.record(
                AuditAction.DISPUTE_HANDLED,
                dispute.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "resolved=%s; amount=%s; fee=%s".formatted(outcome, dispute.amount(), dispute.fee()));

        log.info("Dispute {} resolved as {} by {}", disputeId, outcome, staffId);
        return dispute;
    }

    /**
     * The money, once the case is lost.
     *
     * <p>A {@code CHARGEBACK} transaction row and one posting. The disputed amount comes
     * out of escrow into {@code refunds} — it is a backer's money going back, and which
     * account it lands in is the same answer as for a refund because it is the same
     * movement seen from the other side. The fee is a separate line against
     * {@code psp_fee}, balanced against escrow, because the provider takes it from the
     * platform's balance and not from the backer's.
     *
     * <p><strong>And a {@code refunds} row (#175)</strong>, reason {@code CHARGEBACK}, already
     * {@code SUCCEEDED}, against the disputed charge and pointing at the transaction above. The refund
     * paths — the staff overdraft check, the per-charge remainder, the campaign-refunds sweep — and the
     * payout's refunded figure all ask {@code refunds} what has gone back, and this is how they learn
     * the network took it; nothing is sent. Under the pledge's row lock, like every refund, so a refund
     * being recorded at the same moment either counts this or is counted by it. When it leaves nothing
     * on the pledge, the pledge is {@code CHARGEBACK} and leaves its campaign's totals.
     *
     * <p><strong>Once per case.</strong> The loss is keyed on the dispute ({@code dispute-{id}} for the
     * transaction, {@code chargeback-{id}} for the refund row), and a case resolved against the platform
     * a second time finds its loss already posted and writes nothing — before, the transaction's unique
     * key refused the second resolution with a 500. A loss posted before V84 without its refund row gets
     * one then.
     *
     * @return whether the loss was posted now, rather than found posted by an earlier resolution
     */
    private boolean postLoss(Dispute dispute, UUID staffId, Instant now) {
        pledges.lock(dispute.pledgeId());
        Optional<PaymentTransaction> earlier = transactions.findByIdempotencyKey(lossKey(dispute));
        if (earlier.isPresent()) {
            log.info("Dispute {} was already lost; its loss is not posted twice.", dispute.id());
            recordChargeback(dispute, staffId, earlier.get(), now);
            return false;
        }

        PaymentTransaction recorded = transactions.save(PaymentTransaction.refund(
                dispute.pledgeId(),
                dispute.projectId(),
                dispute.amount(),
                dispute.provider(),
                new RefundResult(ProviderOutcome.APPROVED, dispute.providerDisputeId(), null, null, null),
                lossKey(dispute)));

        Posting.Builder posting = Posting.of(recorded.getId(), dispute.projectId())
                .debit(LedgerAccount.REFUNDS, dispute.amount())
                .credit(LedgerAccount.ESCROW, dispute.amount());

        if (dispute.fee().isPositive()) {
            posting.debit(LedgerAccount.PSP_FEE, dispute.fee()).credit(LedgerAccount.ESCROW, dispute.fee());
        }

        ledger.post(posting.build());
        recordChargeback(dispute, staffId, recorded, now);
        return true;
    }

    private static String lossKey(Dispute dispute) {
        return "dispute-" + dispute.id();
    }

    /**
     * The loss's {@code refunds} row, unless the case already has one, and the pledge's state after it.
     *
     * <p>{@code full_refund} when it took everything its charge had left, the way every part of a staff
     * refund of the rest carries it: the console then does not call a chargeback of a whole charge partial.
     */
    private void recordChargeback(Dispute dispute, UUID staffId, PaymentTransaction loss, Instant now) {
        String key = "chargeback-" + dispute.id();
        if (refunds.byIdempotencyKey(key).isPresent()) {
            return;
        }
        String currency = dispute.amount().currency();
        boolean tookTheRest = transactions
                .findById(dispute.chargeTransactionId())
                .map(charge -> !charge.getAmount()
                        .minus(Money.of(refunds.refundedAgainstCharge(charge.getId()), currency))
                        .isGreaterThan(dispute.amount()))
                .orElse(false);
        refunds.save(Refund.chargeback(
                dispute.pledgeId(),
                dispute.projectId(),
                dispute.chargeTransactionId(),
                dispute.amount(),
                tookTheRest,
                "The card network took this charge back: dispute %s (%s case %s) was resolved %s."
                        .formatted(dispute.id(), dispute.provider(), dispute.providerDisputeId(), dispute.state()),
                staffId,
                key,
                loss.getId(),
                now));
        refunds.flush();

        Money collected = Money.of(transactions.collectedOn(dispute.pledgeId()), currency);
        Money returned = Money.of(refunds.succeededAgainst(dispute.pledgeId()), currency);
        if (collected.isPositive() && !collected.isGreaterThan(returned)) {
            pledges.recordChargedBack(dispute.pledgeId());
        }
    }

    /**
     * One case and the argument assembled against it.
     *
     * @param evidence oldest first, because an argument is read in the order it was built
     */
    public record DisputeCase(Dispute dispute, List<DisputeEvidence> evidence) {
    }

    /**
     * IDN-EXT-01 (#43), §9.8: a chargeback lost after the creator was paid is the creator's to repay.
     *
     * <p>The platform has already returned the money above; the creator kept it. So the amount and its fee
     * become the creator's debt, withheld from their future payouts, and their account is suspended until
     * it is repaid — by the member of staff who resolved the dispute, because a suspension has an author
     * (V40). Before the payout nothing of this happens: the loss reduces the payout instead.
     */
    private void recoverFromCreatorIfPaidOut(Dispute dispute, UUID staffId, Instant now) {
        if (!transactions.hasPaidOut(dispute.projectId())) {
            return;
        }
        UUID creatorId = campaigns
                .describe(dispute.projectId())
                .orElseThrow(() -> new IllegalStateException("Dispute " + dispute.id() + " names a campaign that is gone"))
                .creatorId();
        Money owed = dispute.amount().plus(dispute.fee());
        creatorDebts.record(creatorId, dispute.projectId(), dispute.id(), owed, now);
        if (creatorId.equals(staffId)) {
            log.warn("Dispute {} was resolved by its own creator; the account is not suspended by itself.", dispute.id());
            return;
        }
        users.suspend(
                creatorId,
                staffId,
                "A chargeback of %s on your campaign was lost after your payout. The account is blocked until it is repaid."
                        .formatted(owed));
        log.info("Creator {} suspended until {} is repaid (dispute {}).", creatorId, owed, dispute.id());
    }
}
