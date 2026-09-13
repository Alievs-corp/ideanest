package az.ideanest.payout.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.fee.application.FeeBreakdown;
import az.ideanest.fee.application.FeeSchedules;
import az.ideanest.payment.application.CampaignFunds;
import az.ideanest.payment.application.NoPayoutProviderException;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payout.PayoutProperties;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.domain.PayoutApproval;
import az.ideanest.payout.domain.PayoutState;
import az.ideanest.payout.infrastructure.PayoutApprovalRepository;
import az.ideanest.payout.infrastructure.PayoutRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.compliance.CreatorStandings;
import az.ideanest.shared.compliance.DestinationStanding;
import az.ideanest.shared.compliance.PayoutDestinations;
import az.ideanest.shared.compliance.VerificationStanding;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.project.ProjectSummaries;
import az.ideanest.shared.project.ProjectSummary;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a creator is owed, and the two signatures before it leaves — §9, §4.11's AD-05,
 * issues #69 and #306.
 *
 * <h2>Four steps, and each one is somebody's decision</h2>
 *
 * <ol>
 *   <li>{@link #calculate} freezes the figure. The campaign has closed, the collections
 *       are summed, the fees are priced against the schedule in force, and the hold
 *       begins.
 *   <li>{@link #queue} shows it, and moves it to {@code PENDING_APPROVAL} when the hold
 *       runs out.
 *   <li>{@link #approve} takes a signature. Above the configured threshold it takes two,
 *       from two different accounts.
 *   <li>{@link #send} instructs the provider.
 * </ol>
 *
 * <h2>The figures are frozen and never recomputed</h2>
 *
 * <p>V55's header has the argument. A payout is derivable from collections, refunds and a
 * fee schedule, and all three move — so recomputing on read produces a different number
 * from the one two people approved, and the approval becomes an approval of nothing in
 * particular. A change afterwards produces a <em>new</em> payout.
 *
 * <p>The corollary is that a refund issued between calculation and sending is not
 * reflected, which would be a real hole if the hold did not exist. {@link #send} therefore
 * re-reads the campaign's funds and refuses if the net has moved — the payout is cancelled
 * and recalculated rather than sent at a figure that is no longer true.
 *
 * <h2>Dual approval is two rows, and they cannot be the same person</h2>
 *
 * <p>V55 makes {@code (payout_id, approver_id)} the primary key, so "two different people"
 * is a constraint rather than a check somebody has to remember. {@code APPROVE_PAYOUT} is
 * held by {@code ADMINISTRATOR} alone and deliberately not by {@code FINANCE} — a role
 * conferring both issuing and approving would make the second signature a formality
 * whenever the finance team is one person.
 */
@Service
public class PayoutService {

    private static final Logger log = LoggerFactory.getLogger(PayoutService.class);

    private static final int PAGE_SIZE = 50;

    private final PayoutRepository payouts;
    private final PayoutApprovalRepository approvals;
    private final PayoutGateway gateway;
    private final FeeSchedules fees;
    private final ProjectSummaries projects;
    private final PlatformStaff staff;
    private final CreatorStandings creators;
    private final PayoutDestinations destinations;
    private final AuditLog audit;
    private final PayoutProperties properties;
    private final Clock clock;

    public PayoutService(
            PayoutRepository payouts,
            PayoutApprovalRepository approvals,
            PayoutGateway gateway,
            FeeSchedules fees,
            ProjectSummaries projects,
            PlatformStaff staff,
            CreatorStandings creators,
            PayoutDestinations destinations,
            AuditLog audit,
            PayoutProperties properties,
            Clock clock) {
        this.payouts = payouts;
        this.approvals = approvals;
        this.gateway = gateway;
        this.fees = fees;
        this.projects = projects;
        this.staff = staff;
        this.creators = creators;
        this.destinations = destinations;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Works out what a campaign owes its creator, and starts the hold.
     *
     * <p><strong>Refuses if one is already in flight.</strong> V55's partial unique index
     * says the same thing and would refuse it anyway; checking first turns a constraint
     * violation into a sentence. Two payouts in flight for one campaign is how a creator
     * gets paid twice for the same collections.
     *
     * @throws PayoutAlreadyInFlightException when the campaign has one
     * @throws NothingToPayException when the campaign has collected nothing, or has
     *     refunded everything it collected
     */
    @Transactional
    public Payout calculate(UUID staffId, UUID projectId) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);

        payouts.inFlightFor(projectId).ifPresent(existing -> {
            throw new PayoutAlreadyInFlightException(projectId, existing.id());
        });

        ProjectSummary campaign = projects
                .summaryOf(projectId)
                .orElseThrow(() -> new UnknownPayoutCampaignException(projectId));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        CampaignFunds funds = gateway.fundsOf(projectId, properties.currency());
        Money payable = funds.net();

        if (!payable.isPositive()) {
            throw new NothingToPayException(projectId);
        }

        // Priced against the schedule in force now, and the schedule's identifier is kept
        // on the row so the arithmetic can be re-derived years later.
        FeeBreakdown breakdown = fees.priceOf(funds.collected(), now, projectId);

        // The fees come off the gross and the refunds come off what is left. Doing it the
        // other way round would charge the platform's fee on money that went back to a
        // backer, which is the trade §9.7 leaves open and this is the reading that does not
        // take a fee on a refund.
        Money net = breakdown.net().minus(funds.refunded());
        if (!net.isPositive()) {
            throw new NothingToPayException(projectId);
        }

        short required = approvalsRequiredFor(net);

        Payout calculated = payouts.save(Payout.calculated(
                projectId,
                campaign.creatorId(),
                funds.collected(),
                breakdown.platformFee(),
                breakdown.processingFee(),
                funds.refunded(),
                net,
                breakdown.scheduleId(),
                now.plus(properties.hold()),
                required,
                "payout-" + projectId + "-" + now.toEpochMilli()));

        audit.record(
                AuditAction.PAYOUT_CALCULATED,
                calculated.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "project=%s; gross=%s; fees=%s; refunded=%s; net=%s; approvals=%d"
                        .formatted(
                                projectId,
                                funds.collected(),
                                breakdown.totalFees(),
                                funds.refunded(),
                                net,
                                required));

        log.info("Payout {} calculated for campaign {}: net {}", calculated.id(), projectId, net);
        return calculated;
    }

    /**
     * How many signatures this payout needs.
     *
     * <p><strong>A payout in another currency takes the higher count.</strong> §21.2 gives
     * nothing to convert with, so the configured threshold does not apply — and the safe
     * branch when a rule cannot be evaluated is the stricter one. The alternative, treating
     * an uncomparable amount as below the threshold, would make every foreign-currency
     * payout the one that needs no second opinion.
     */
    /** Package-visible for {@link WithdrawalPayouts}, which prices a withdrawal by the same rule. */
    short approvalsRequiredFor(Money net) {
        if (!net.currency().equals(properties.currency())) {
            return properties.approvalsAboveThreshold();
        }
        return net.amount().compareTo(properties.dualApprovalThreshold()) > 0
                ? properties.approvalsAboveThreshold()
                : (short) 1;
    }

    /**
     * The queue: everything still on its way, oldest first.
     *
     * <p>Moves anything whose hold has expired to {@code PENDING_APPROVAL} as it lists it.
     * {@code Payout.payable} has the argument for why that is here rather than in a
     * scheduled job: a job would be a second thing to go wrong before anybody could be
     * paid, and the state is derivable from the row and the clock.
     */
    @Transactional
    public List<Payout> queue(UUID staffId, int page) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);

        // #431: §6.3's fourteen-day hold is where a verification fits, so the sweep that
        // ends the hold is the first of the two places the gate goes. A payout whose
        // creator is not verified stays CALCULATED -- it does not fail and it does not
        // cancel, it waits -- and the creator is asked for what is missing.
        for (Payout held : payouts.nowPayable(clock.instant())) {
            if (releasedByStanding(held)) {
                held.payable();
            }
        }

        return payouts.queue(PageRequest.of(Math.max(page, 0), PAGE_SIZE));
    }

    /**
     * Where this payout's creator stands with identity verification.
     *
     * <p>Read live rather than stored on the payout. A column would be stale the moment a
     * reviewer approved a document, and a finance operator looking at a payout that said
     * "unverified" about a creator verified an hour ago would either wait for nothing or
     * override something that did not need overriding.
     */
    @Transactional(readOnly = true)
    public VerificationStanding standingOf(Payout payout) {
        return creators.of(payout.creatorId());
    }

    /**
     * The standing of every creator on a page of payouts, one entry per creator.
     *
     * <p>Fifty payouts on a queue page are usually a handful of creators, and asking once per
     * row would be the N+1 that makes an operator's screen slow on exactly the day it matters.
     * With {@code ideanest.verification.required} off each answer is a constant and no query
     * is made at all.
     */
    @Transactional(readOnly = true)
    public Map<UUID, VerificationStanding> standingsOf(List<Payout> page) {
        return page.stream()
                .map(Payout::creatorId)
                .distinct()
                .collect(Collectors.toMap(creatorId -> creatorId, creators::of));
    }

    /**
     * Where this payout's creator stands with a payout destination — part of issue #432.
     *
     * <p>{@link #standingOf}'s sibling, read live for the same reason: a column would be stale
     * the moment a reviewer confirmed an account.
     *
     * <p>Drawn on AD-05 beside the verification standing rather than folded into it. The two
     * hold a payout for different reasons and are resolved by different people — an identity
     * queue and a destination panel, both COMPLIANCE's but not the same work — and an operator
     * shown one "held" flag cannot tell which of the two to chase.
     */
    @Transactional(readOnly = true)
    public DestinationStanding destinationStandingOf(Payout payout) {
        return destinations.standingOf(payout.creatorId());
    }

    /** The destination standing of every creator on a page. {@link #standingsOf}'s shape. */
    @Transactional(readOnly = true)
    public Map<UUID, DestinationStanding> destinationStandingsOf(List<Payout> page) {
        return page.stream()
                .map(Payout::creatorId)
                .distinct()
                .collect(Collectors.toMap(creatorId -> creatorId, destinations::standingOf));
    }

    /**
     * The token to send to, or the reason there is not one.
     *
     * <p>Re-read at send even though {@link #approve} already checked, because the two happen
     * at different times and the answer moves in between: a reviewer withdraws a verification,
     * an override expires by the clock rather than by a job, or the creator files a different
     * account — which resets the verification, which is the case this re-read exists for.
     *
     * <p>Both refusals are audited independently. This method throws, so the transaction rolls
     * back, and a record written with {@code record} would roll back with it — while "somebody
     * tried to send a payout to an unverified destination" is precisely the thing an
     * investigation goes looking for.
     */
    private String destinationOf(UUID staffId, Payout payout) {
        UUID payoutId = payout.id();

        DestinationStanding standing = destinations.standingOf(payout.creatorId());
        if (!standing.releasesPayout()) {
            audit.recordIndependently(
                    AuditAction.PAYOUT_SENT,
                    payoutId,
                    AuditActor.moderator(staffId),
                    AuditOutcome.REFUSED,
                    "destinationNotVerified; creator=%s; standing=%s".formatted(payout.creatorId(), standing));
            throw new PayoutDestinationNotVerifiedException(payoutId, payout.creatorId(), standing);
        }

        // Empty means no adapter is configured, which is every environment until #433 lands.
        // `gateway.send` answers that with the same exception a moment later; asking first
        // costs a field read and keeps the refusal below from blaming a provider mismatch
        // for a provider that is not there at all.
        String provider = gateway.sendingProvider().orElseThrow(NoPayoutProviderException::new);

        return destinations.referenceFor(payout.creatorId(), provider).orElseThrow(() -> {
            audit.recordIndependently(
                    AuditAction.PAYOUT_SENT,
                    payoutId,
                    AuditActor.moderator(staffId),
                    AuditOutcome.REFUSED,
                    "destinationProviderMismatch; creator=%s; sendingThrough=%s"
                            .formatted(payout.creatorId(), provider));
            return new PayoutDestinationProviderMismatchException(payoutId, payout.creatorId(), provider);
        });
    }

    /**
     * Whether the creator's standing lets this payout move — and, when it does not, asking
     * the creator for what is missing.
     *
     * <p>The request is raised here, at the moment the hold bites, rather than at submission.
     * #431's first reason: "A campaign that never reaches its goal collects nothing and pays
     * out nothing. Gating submission would send every creator through document review to find
     * out whether their idea funds -- most of them for nothing."
     */
    private boolean releasedByStanding(Payout payout) {
        VerificationStanding standing = creators.of(payout.creatorId());
        if (standing.releasesPayout()) {
            return true;
        }
        log.info("Payout {} stays in hold: creator {} stands at {}", payout.id(), payout.creatorId(), standing);
        creators.requestIfNeeded(payout.creatorId());
        return false;
    }

    /** Everything, newest first, optionally narrowed to one state. */
    @Transactional(readOnly = true)
    public List<Payout> list(UUID staffId, PayoutState state, int page) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        PageRequest request = PageRequest.of(Math.max(page, 0), PAGE_SIZE);

        return state == null ? payouts.page(request) : payouts.pageByState(state, request);
    }

    /** One payout and who has signed it. */
    @Transactional(readOnly = true)
    public PayoutFile inspect(UUID staffId, UUID payoutId) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        Payout payout = payouts.findById(payoutId).orElseThrow(() -> new PayoutNotFoundException(payoutId));

        return new PayoutFile(payout, approvals.forPayout(payoutId));
    }

    /**
     * Signs off a payout.
     *
     * <p><strong>Only once the hold has expired.</strong> Approving during the hold would
     * let a payout be signed before the refunds and chargebacks it is meant to wait for
     * have landed, which is the whole purpose of the hold — the signature would be on a
     * figure nobody could yet know was right.
     *
     * <p>Signing twice is not an error and is not a second signature: V55's primary key
     * makes it a no-op, and the response says how many are still needed.
     *
     * @throws PayoutNotApprovableException when the payout is not waiting for signatures
     */
    @Transactional
    public PayoutFile approve(UUID staffId, UUID payoutId, String note) {
        staff.requireCapability(staffId, StaffCapability.APPROVE_PAYOUT);

        Payout payout = payouts.findAndLock(payoutId).orElseThrow(() -> new PayoutNotFoundException(payoutId));

        // #431: the second of the two places the gate goes. An operator may approve a
        // payout the sweep has not reached, and a gate that lived only in the sweep would
        // depend on which of the two got there first.
        VerificationStanding standing = creators.of(payout.creatorId());
        if (!standing.releasesPayout()) {
            creators.requestIfNeeded(payout.creatorId());
            audit.recordIndependently(
                    AuditAction.PAYOUT_APPROVED,
                    payoutId,
                    AuditActor.moderator(staffId),
                    AuditOutcome.REFUSED,
                    "creatorNotVerified; creator=%s; standing=%s".formatted(payout.creatorId(), standing));
            throw new CreatorNotVerifiedException(payoutId, payout.creatorId(), standing);
        }

        // #432: the second gate, and the one that decides *where* rather than *who*. It is
        // here as well as in `send` for the reason the verification gate is: an approval is a
        // signature on an instruction, and a signature given before anybody had established
        // where the money would go is a signature on a blank line. §4.11 wanted two people to
        // agree to a movement; agreeing to an amount and discovering the destination
        // afterwards is what this whole issue exists to end.
        DestinationStanding destination = destinations.standingOf(payout.creatorId());
        if (!destination.releasesPayout()) {
            audit.recordIndependently(
                    AuditAction.PAYOUT_APPROVED,
                    payoutId,
                    AuditActor.moderator(staffId),
                    AuditOutcome.REFUSED,
                    "destinationNotVerified; creator=%s; standing=%s".formatted(payout.creatorId(), destination));
            throw new PayoutDestinationNotVerifiedException(payoutId, payout.creatorId(), destination);
        }

        if (payout.state() == PayoutState.CALCULATED && payout.isPayableAt(clock.instant())) {
            payout.payable();
        }
        if (payout.state() != PayoutState.PENDING_APPROVAL) {
            throw new PayoutNotApprovableException(payoutId, payout.state());
        }

        int written = approvals.approveIfAbsent(payoutId, staffId, note);
        long signatures = approvals.countFor(payoutId);

        if (signatures >= payout.approvalsRequired()) {
            payout.approved();
        }

        audit.record(
                AuditAction.PAYOUT_APPROVED,
                payoutId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "new=%s; signatures=%d/%d".formatted(written == 1, signatures, payout.approvalsRequired()));

        log.info("Payout {} approved by {} ({}/{})", payoutId, staffId, signatures, payout.approvalsRequired());
        return new PayoutFile(payout, approvals.forPayout(payoutId));
    }

    /** Withdraws a signature, before the payout has been sent. */
    @Transactional
    public PayoutFile withdrawApproval(UUID staffId, UUID payoutId) {
        staff.requireCapability(staffId, StaffCapability.APPROVE_PAYOUT);

        Payout payout = payouts.findAndLock(payoutId).orElseThrow(() -> new PayoutNotFoundException(payoutId));
        if (!payout.state().isInFlight()) {
            throw new PayoutNotApprovableException(payoutId, payout.state());
        }

        int removed = approvals.withdraw(payoutId, staffId);
        long signatures = approvals.countFor(payoutId);

        // Back to waiting, if the withdrawal took it below the bar. Without this a payout
        // could be approved, un-approved, and still sent — which is the whole rule defeated
        // by a button.
        //
        // This called `payable()` until #398, and `payable()` only transitions from
        // CALCULATED — so from APPROVED it returned silently and the guard did nothing.
        // `backToPendingApproval()` asserts the state it was handed instead of ignoring it.
        if (payout.state() == PayoutState.APPROVED && signatures < payout.approvalsRequired()) {
            payout.backToPendingApproval();
        }

        audit.record(
                AuditAction.PAYOUT_APPROVED,
                payoutId,
                AuditActor.moderator(staffId),
                AuditOutcome.REFUSED,
                "withdrawn=%s; signatures=%d/%d".formatted(removed == 1, signatures, payout.approvalsRequired()));

        return new PayoutFile(payout, approvals.forPayout(payoutId));
    }

    /**
     * Sends the money.
     *
     * <p><strong>The figures are re-checked against the campaign's funds first.</strong>
     * A refund issued between calculation and sending would otherwise be paid out anyway —
     * the figures are frozen, which is right for the approval and wrong for the
     * instruction. When the net has moved, the payout is refused rather than adjusted: a
     * different amount is a different decision, and the signatures on file were given for
     * this one.
     *
     * <p><strong>And the signatures are counted rather than assumed.</strong> See #398:
     * {@code state} is a summary of rows in {@code payout_approvals}, and a summary can be
     * wrong. The instruction that moves money reads the rows.
     *
     * <p><strong>And the destination is read, not accepted.</strong> Until #432 this method
     * took a {@code String destinationReference} that a member of staff typed into the console
     * at the moment of sending. Nothing verified it, no creator supplied it, and a typo was
     * money sent to a stranger — after two people had approved a payout to somebody whose bank
     * details neither of them had seen, because there were none to see. The parameter is gone
     * and cannot come back: there is no argument on this method that decides where money goes.
     *
     * @throws PayoutNotSendableException when it has not been approved, or the figures have
     *     moved underneath it
     * @throws PayoutSignaturesShortException when the row says approved and the signatures
     *     on file do not reach {@code approvalsRequired}
     * @throws PayoutDestinationNotVerifiedException when the creator's destination stopped
     *     releasing payouts between the approval and now — a reviewer withdrew it, an override
     *     expired, or the creator replaced the account, which resets its verification
     * @throws PayoutDestinationProviderMismatchException when the destination on file was
     *     issued by a provider this deployment does not send through
     */
    @Transactional
    public Payout send(UUID staffId, UUID payoutId) {
        staff.requireCapability(staffId, StaffCapability.APPROVE_PAYOUT);

        Payout payout = payouts.findAndLock(payoutId).orElseThrow(() -> new PayoutNotFoundException(payoutId));
        if (payout.state() != PayoutState.APPROVED) {
            throw new PayoutNotSendableException(payoutId, payout.state());
        }

        // The signatures are counted here as well as in `approve` — issue #398.
        //
        // `state` is a cache of a fact that lives in `payout_approvals`, and the money is
        // gated on the fact. A state-only guard cannot see a row that says APPROVED while
        // the table holds fewer signatures than the rule requires, which is a state #398
        // could produce and which anything writing that column by hand could produce again.
        // Counting costs one query on a path that is taken once per payout by a human.
        long signatures = approvals.countFor(payoutId);
        if (signatures < payout.approvalsRequired()) {
            // `recordIndependently`, which is what AuditLog documents for a refusal: this
            // method throws, the transaction rolls back, and a record written with `record`
            // would roll back with it. An attempt to send a payout that is short of
            // signatures is exactly the thing somebody would later go looking for.
            audit.recordIndependently(
                    AuditAction.PAYOUT_SENT,
                    payoutId,
                    AuditActor.moderator(staffId),
                    AuditOutcome.REFUSED,
                    "signaturesShort; signatures=%d/%d".formatted(signatures, payout.approvalsRequired()));

            throw new PayoutSignaturesShortException(payoutId, signatures, payout.approvalsRequired());
        }

        CampaignFunds funds = gateway.fundsOf(payout.projectId(), payout.currency());
        if (!funds.collected().equals(payout.gross()) || !funds.refunded().equals(payout.refunded())) {
            payout.cancelled();
            audit.record(
                    AuditAction.PAYOUT_SENT,
                    payoutId,
                    AuditActor.moderator(staffId),
                    AuditOutcome.REFUSED,
                    "figuresMoved; gross=%s->%s; refunded=%s->%s"
                            .formatted(payout.gross(), funds.collected(), payout.refunded(), funds.refunded()));

            throw new PayoutNotSendableException(payoutId, payout.state());
        }

        String destinationReference = destinationOf(staffId, payout);

        PayoutGateway.Sent sent = gateway.send(
                payoutId,
                payout.projectId(),
                payout.creatorId(),
                payout.net(),
                destinationReference,
                payout.idempotencyKey());

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (sent.moved()) {
            payout.paid(sent.transactionId(), now);
        } else {
            payout.failed(sent.failureCode(), sent.failureMessage(), now);
        }

        audit.record(
                AuditAction.PAYOUT_SENT,
                payoutId,
                AuditActor.moderator(staffId),
                sent.moved() ? AuditOutcome.SUCCEEDED : AuditOutcome.REFUSED,
                "amount=%s; transaction=%s; failure=%s"
                        .formatted(payout.net(), sent.transactionId(), sent.failureCode()));

        log.info("Payout {} send attempted by {}: moved={}", payoutId, staffId, sent.moved());
        return payout;
    }

    /** Withdraws a payout before it is sent. */
    @Transactional
    public Payout cancel(UUID staffId, UUID payoutId) {
        staff.requireCapability(staffId, StaffCapability.APPROVE_PAYOUT);

        Payout payout = payouts.findAndLock(payoutId).orElseThrow(() -> new PayoutNotFoundException(payoutId));
        if (!payout.state().isInFlight()) {
            throw new PayoutNotSendableException(payoutId, payout.state());
        }

        payout.cancelled();

        audit.record(
                AuditAction.PAYOUT_SENT,
                payoutId,
                AuditActor.moderator(staffId),
                AuditOutcome.REFUSED,
                "cancelled before sending");

        return payout;
    }

    /** One payout with its signatures. */
    public record PayoutFile(Payout payout, List<PayoutApproval> approvals) {

        /** How many more signatures it needs. Zero once it is approved. */
        public long stillNeeded() {
            return Math.max(0, payout.approvalsRequired() - approvals.size());
        }
    }

    /** The in-flight payout for a campaign, if it has one. Used by the console's detail. */
    @Transactional(readOnly = true)
    public Optional<Payout> inFlightFor(UUID staffId, UUID projectId) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        return payouts.inFlightFor(projectId);
    }
}
